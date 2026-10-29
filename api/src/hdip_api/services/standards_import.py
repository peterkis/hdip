"""标准资料包导入：登记包 → 按资料族读取选定成员 → 写文档修订、条目与引用。

- 直接读 ZIP 成员，不解压、不执行包内任何程序。
- 同字节的包只登记一次；条目按“文档修订 + 类型 + 源记录键”复用，重复导入不增条目，
  扩大选定范围只补新记录并更新覆盖数。
- 整次导入在一个事务里：任何一条记录读不通就报出成员与位置并回滚，已有内容不变。
- 读取器改了解析结果就提高 READER_VERSION，生成新的文档修订，旧结果保留。
"""

import hashlib
import json
import re
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from hdip_api.models import SourceDocument, SourcePackage, StandardEntry, StandardReference
from hdip_api.schemas.standards import (
    CodeRowBody,
    DataElementBody,
    Evidence,
    Provenance,
    ValueDomainBody,
)


class ImportFailure(Exception):
    """导入失败：message 写清哪个成员、哪个位置、什么问题。"""


@dataclass
class Ref:
    field: str
    ref_kind: str
    raw_text: str
    target_standard: str
    target_year: str | None
    target_identifier: str | None
    target_label: str | None


@dataclass
class Record:
    entry_type: str
    source_key: str
    identifier: str | None
    name: str | None
    seq: int
    body: BaseModel
    raw: dict[str, Any]
    provenance: Provenance
    parent_key: str | None = None
    refs: list[Ref] = field(default_factory=list)


@dataclass
class Doc:
    standard_no: str
    standard_year: str | None
    members: list[str]
    source_version: str | None = None
    source_sha256: str | None = None
    source_pdf: str | None = None
    source_url: str | None = None
    records: list[Record] = field(default_factory=list)


@dataclass
class Result:
    package_id: int
    package_reused: bool
    documents: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------- 公共小工具


def _ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def search_text(*parts: str | None) -> str:
    return _ws(" ".join(p for p in parts if p)).lower()


def split_standard(label: str) -> tuple[str, str | None]:
    """“WS/T 363.3—2023” → (“WS/T 363.3”, “2023”)；原文年份，不是整理年份。"""
    m = re.match(r"^(.*?)\s*[—–-]\s*(\d{4})$", label.strip())
    return (_ws(m.group(1)), m.group(2)) if m else (_ws(label), None)


_REF_RE = re.compile(
    r"^(?P<std>(?:WS/T|WS|GB/T|GB)\s*\d+(?:\s*\.\s*\d+)*)"
    r"(?:\s*[—–-]\s*(?P<year>\d{4}))?"
    r"\s*(?P<cv>CV\d+(?:\.\d+)*)?"
    r"\s*(?P<label>.*)$",
    re.S,
)


def parse_allowed_values(field_name: str, raw: str) -> tuple[str, Ref | None]:
    """允许值原文 → (原性质, 引用)。只认开头明确写出标准号的引用；其余按原文说明保留。"""
    if not raw.strip():
        return "empty", None
    m = _REF_RE.match(_ws(raw))
    if not m:
        return "text", None
    std = re.sub(r"\s*\.\s*", ".", m.group("std"))
    std = re.sub(r"^(WS/T|WS|GB/T|GB)\s*", r"\1 ", std)
    cv = m.group("cv")
    return "reference", Ref(
        field=field_name,
        ref_kind="value_domain" if cv else "external_standard",
        raw_text=raw,
        target_standard=std,
        target_year=m.group("year"),
        target_identifier=cv,
        target_label=m.group("label") or None,
    )


def _evidence_images(paths: Iterable[str], members: set[str]) -> list[Evidence]:
    """资料里记了图证路径，不代表图真的随包提供：按包成员核对。"""
    out = []
    for p in paths:
        hit = any(m.endswith(p) for m in members)
        out.append(
            Evidence(
                kind="image",
                label=p.rsplit("/", 1)[-1],
                path=p,
                availability="in_package" if hit else "not_in_package",
            )
        )
    return out


def _source_pdf(name: str | None, url: str | None, members: set[str]) -> list[Evidence]:
    out = []
    if name:
        hit = any(m.endswith(name) for m in members)
        out.append(
            Evidence(
                kind="pdf",
                label=name.rsplit("/", 1)[-1],
                path=name,
                availability="in_package" if hit else "not_in_package",
            )
        )
    if url:
        out.append(Evidence(kind="pdf", label="官方发布原文", url=url, availability="external"))
    return out


def _body(model: type[BaseModel], data: dict, where: str) -> BaseModel:
    try:
        return model.model_validate(data)
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(x) for x in first["loc"])
        raise ImportFailure(f"{where}：字段 {loc} 不符合要求（{first['msg']}）") from None


def _need(rec: dict, key: str, where: str, *, allow_empty: bool = False) -> Any:
    if key not in rec or rec[key] is None or (not allow_empty and rec[key] == ""):
        raise ImportFailure(f"{where}：缺少 {key}")
    return rec[key]


# ---------------------------------------------------------------- 资料族：WS/T 363 + 364


class Ws363364Reader:
    """主题 01 包的 WS/T 363 选定正文文件与 WS/T 364 表 / 代码行（建设计划附录 A）。"""

    family = "ws363-364"
    name = "ws363-364"
    version = "1"
    DE_MEMBER = "p001/files/enhanced-current-official-data-elements.json"
    CV_TABLES = "p002/files/data/tables.json"
    CV_ROWS = "p002/files/data/rows.json"

    def __init__(self, zf: zipfile.ZipFile) -> None:
        self.zf = zf
        self.members = set(zf.namelist())

    def member_paths(self) -> list[str]:
        return [self.DE_MEMBER, self.CV_TABLES, self.CV_ROWS]

    def _load(self, path: str) -> list[dict]:
        if path not in self.members:
            raise ImportFailure(f"包内没有成员 {path}")
        try:
            data = json.loads(self.zf.read(path).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ImportFailure(f"{path}：不是有效的 JSON（{e}）") from None
        if not isinstance(data, list):
            raise ImportFailure(f"{path}：顶层应为数组")
        return data

    def documents(self) -> Iterator[Doc]:
        docs: dict[tuple[str, str | None], Doc] = {}

        def doc(label: str, member: str) -> Doc:
            no, year = split_standard(label)
            d = docs.get((no, year))
            if d is None:
                d = docs[(no, year)] = Doc(standard_no=no, standard_year=year, members=[])
            if member not in d.members:
                d.members.append(member)
            return d

        for i, rec in enumerate(self._load(self.DE_MEMBER)):
            where = f"{self.DE_MEMBER}#[{i}]"
            d = doc(_need(rec, "standard", where), self.DE_MEMBER)
            d.records.append(self._data_element(rec, i, where, len(d.records)))
            d.source_version = d.source_version or rec.get("source_version")
            d.source_sha256 = d.source_sha256 or rec.get("source_sha256")
            d.source_pdf = d.source_pdf or rec.get("source_pdf")
            d.source_url = d.source_url or rec.get("source_url")

        table_key: dict[tuple[str, str], str] = {}
        for i, rec in enumerate(self._load(self.CV_TABLES)):
            where = f"{self.CV_TABLES}#[{i}]"
            label = _need(rec, "standard_part", where)
            d = doc(label, self.CV_TABLES)
            r = self._value_domain(rec, i, where, len(d.records))
            table_key[(label, r.identifier or "")] = r.source_key
            d.records.append(r)
            d.source_sha256 = d.source_sha256 or rec.get("source_sha256")
            d.source_url = d.source_url or rec.get("source_url")

        for i, rec in enumerate(self._load(self.CV_ROWS)):
            where = f"{self.CV_ROWS}#[{i}]"
            label = _need(rec, "standard_part", where)
            cv = _need(rec, "cv_id", where)
            parent = table_key.get((label, cv))
            if parent is None:
                raise ImportFailure(
                    f"{where}：代码行所属的值域表 {label} {cv} 不在 {self.CV_TABLES}"
                )
            d = doc(label, self.CV_ROWS)
            d.records.append(self._code_row(rec, i, where, len(d.records), parent))
            d.source_pdf = d.source_pdf or rec.get("source_path")

        yield from docs.values()

    def _data_element(self, rec: dict, i: int, where: str, seq: int) -> Record:
        cells = _need(rec, "raw_cells", where)
        ident = _need(cells, "数据元标识符", where)
        allowed = cells.get("数据元允许值") or ""
        nature, ref = parse_allowed_values("数据元允许值", allowed)
        body = _body(
            DataElementBody,
            {
                "identifier": ident,
                "name": _need(cells, "数据元名称", where),
                "definition": cells.get("定义") or "",
                "data_type": cells.get("数据元值的数据类型") or "",
                "format": cells.get("表示格式") or "",
                "allowed_values": allowed,
                "allowed_value_nature": nature,
                "version": rec.get("data_element_version"),
                "section": rec.get("source_section"),
            },
            where,
        )
        qa = rec.get("qa_evidence") or {}
        images = list(qa.get("image_paths") or qa.get("pages") or [])
        return Record(
            entry_type="data_element",
            source_key=f"{self.DE_MEMBER}#[{i}]",
            identifier=ident,
            name=body.name,
            seq=seq,
            body=body,
            raw=rec,
            provenance=Provenance(
                member=self.DE_MEMBER,
                json_pointer=f"[{i}]",
                pdf_pages=rec.get("source_pdf_pages") or [],
                printed_pages=[str(p) for p in rec.get("source_printed_pages") or []],
                source_pdf=rec.get("source_pdf"),
                source_url=rec.get("source_url"),
                source_sha256=rec.get("source_sha256"),
                qa_status=rec.get("qa_status"),
                import_gate=rec.get("automatic_import_gate"),
                source_issues=[str(x) for x in rec.get("source_issues") or []],
                evidence=_evidence_images(images, self.members)
                + _source_pdf(rec.get("source_pdf"), rec.get("source_url"), self.members),
            ),
            refs=[ref] if ref else [],
        )

    def _value_domain(self, rec: dict, i: int, where: str, seq: int) -> Record:
        cv = _need(rec, "cv_id", where)
        body = _body(
            ValueDomainBody,
            {
                "identifier": cv,
                "name": _need(rec, "table_name", where),
                "definition": rec.get("definition") or "",
                "structure": rec.get("structure") or "",
                "definition_raw": rec.get("definition_and_structure_raw") or "",
                "column_headers": rec.get("source_column_headers"),
            },
            where,
        )
        page = rec.get("source_physical_page")
        printed = rec.get("source_printed_page")
        return Record(
            entry_type="value_domain",
            source_key=f"{self.CV_TABLES}#[{i}]",
            identifier=cv,
            name=body.name,
            seq=seq,
            body=body,
            raw=rec,
            provenance=Provenance(
                member=self.CV_TABLES,
                json_pointer=f"[{i}]",
                record_id=rec.get("table_id"),
                pdf_pages=[page] if isinstance(page, int) else [],
                printed_pages=[str(printed)] if printed else [],
                source_url=rec.get("source_url"),
                source_sha256=rec.get("source_sha256"),
                qa_status=rec.get("qa_status"),
                source_issues=[rec["qa_note"]] if rec.get("qa_note") else [],
                evidence=_source_pdf(None, rec.get("source_url"), self.members),
            ),
        )

    def _code_row(self, rec: dict, i: int, where: str, seq: int, parent_key: str) -> Record:
        row_id = _need(rec, "row_id", where)
        code = _need(rec, "code", where)
        if not isinstance(code, str):
            raise ImportFailure(f"{where}：码值应为字符串（原值 {code!r}），不能按数字读取")
        body = _body(
            CodeRowBody,
            {
                "code": code,
                "name": rec.get("name") or "",
                "description": rec.get("description") or "",
                "hierarchy_level": rec.get("hierarchy_level"),
                "parent_code": rec.get("parent_code") or None,
                "raw_cells": [str(c) for c in rec.get("raw_cells") or []],
            },
            where,
        )
        frag, row = rec.get("source_fragment"), rec.get("source_row")
        return Record(
            entry_type="code_row",
            source_key=row_id,
            identifier=code,
            name=body.name,
            seq=seq,
            body=body,
            raw=rec,
            parent_key=parent_key,
            provenance=Provenance(
                member=self.CV_ROWS,
                json_pointer=f"[{i}]",
                record_id=row_id,
                pdf_pages=rec.get("source_physical_pages") or [],
                printed_pages=[str(p) for p in rec.get("source_printed_pages") or []],
                table_ref=f"片段 {frag} 第 {row} 行"
                if frag is not None and row is not None
                else None,
                source_pdf=rec.get("source_path"),
                source_url=rec.get("source_url"),
                source_sha256=rec.get("source_sha256"),
                qa_status=rec.get("qa_status"),
                source_issues=[rec["qa_note"]] if rec.get("qa_note") else [],
                evidence=_evidence_images(
                    [rec["source_image"]] if rec.get("source_image") else [], self.members
                )
                + _source_pdf(rec.get("source_path"), rec.get("source_url"), self.members),
            ),
        )


READERS = {Ws363364Reader.family: Ws363364Reader}


# ---------------------------------------------------------------- 导入


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _selected(doc: Doc, select_ids: set[str] | None) -> list[Record]:
    """选定范围：数据元按 DE、值域按 CV；值域选中时带上它的全部代码行。"""
    if select_ids is None:
        return doc.records
    tables = {
        r.source_key
        for r in doc.records
        if r.entry_type == "value_domain" and r.identifier in select_ids
    }
    return [
        r
        for r in doc.records
        if (r.entry_type in ("data_element", "value_domain") and r.identifier in select_ids)
        or (r.entry_type == "code_row" and r.parent_key in tables)
    ]


def import_package(
    session: Session,
    zip_path: Path,
    standards_dir: Path,
    family: str,
    *,
    select_ids: set[str] | None = None,
    expected_sha256: str | None = None,
    release_id: str | None = None,
    drive_file_id: str | None = None,
    source_url: str | None = None,
) -> Result:
    """导入一个资料包；调用方负责提交或回滚事务。"""
    reader_cls = READERS.get(family)
    if reader_cls is None:
        raise ImportFailure(f"不认识的资料族 {family}（可用：{', '.join(READERS)}）")
    zip_path, standards_dir = zip_path.resolve(), standards_dir.resolve()
    if not zip_path.is_file():
        raise ImportFailure(f"找不到资料包 {zip_path}")
    try:
        stored = zip_path.relative_to(standards_dir)
    except ValueError:
        raise ImportFailure(f"资料包须放在受控目录 {standards_dir} 下") from None

    sha = _sha256(zip_path)
    if expected_sha256 and expected_sha256.lower() != sha:
        raise ImportFailure(
            f"资料包摘要与清单不一致：本地 {sha}，清单 {expected_sha256.lower()}；不登记、不导入"
        )

    pkg = session.scalar(select(SourcePackage).where(SourcePackage.sha256 == sha))
    reused = pkg is not None
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        raise ImportFailure(f"{zip_path.name} 不是有效的 ZIP") from None
    with zf:
        if pkg is None:
            pkg = SourcePackage(
                file_name=zip_path.name,
                stored_path=str(stored),
                bytes=zip_path.stat().st_size,
                sha256=sha,
                expected_sha256=expected_sha256.lower() if expected_sha256 else None,
                release_id=release_id,
                drive_file_id=drive_file_id,
                source_url=source_url,
                members=[
                    {"path": i.filename, "bytes": i.file_size, "crc32": f"{i.CRC:08x}"}
                    for i in zf.infolist()
                    if not i.is_dir()
                ],
            )
            session.add(pkg)
            session.flush()
        result = Result(package_id=pkg.id, package_reused=reused)

        reader = reader_cls(zf)
        member_sha = {
            p: {
                "path": p,
                "sha256": hashlib.sha256(zf.read(p)).hexdigest(),
                "bytes": zf.getinfo(p).file_size,
            }
            for p in reader.member_paths()
            if p in reader.members
        }
        for doc in reader.documents():
            records = _selected(doc, select_ids)
            if not records:
                continue
            result.documents.append(_write_document(session, pkg, reader, doc, records, member_sha))
    if select_ids is not None:
        found = {r["identifier"] for d in result.documents for r in d.pop("_selected_ids")}
        missing = select_ids - found
        if missing:
            raise ImportFailure(f"包内没有找到选定的标识：{', '.join(sorted(missing))}")
    else:
        for d in result.documents:
            d.pop("_selected_ids")
    return result


def _write_document(
    session: Session,
    pkg: SourcePackage,
    reader: Ws363364Reader,
    doc: Doc,
    records: list[Record],
    member_sha: dict[str, dict],
) -> dict[str, Any]:
    sd = session.scalar(
        select(SourceDocument).where(
            SourceDocument.package_id == pkg.id,
            SourceDocument.family == reader.family,
            SourceDocument.standard_no == doc.standard_no,
            SourceDocument.standard_year.is_not_distinct_from(doc.standard_year),
            SourceDocument.reader == reader.name,
            SourceDocument.reader_version == reader.version,
        )
    )
    if sd is None:
        sd = SourceDocument(
            package_id=pkg.id,
            standard_no=doc.standard_no,
            standard_year=doc.standard_year,
            family=reader.family,
            members=[member_sha[m] for m in doc.members],
            source_version=doc.source_version,
            source_sha256=doc.source_sha256,
            source_pdf=doc.source_pdf,
            source_url=doc.source_url,
            reader=reader.name,
            reader_version=reader.version,
            total_records=len(doc.records),
        )
        session.add(sd)
        session.flush()

    existing = dict(
        session.execute(
            select(
                func.concat(StandardEntry.entry_type, "|", StandardEntry.source_key),
                StandardEntry.id,
            ).where(StandardEntry.document_id == sd.id)
        ).all()
    )
    added = 0
    # 值域表先于代码行写入，代码行的父项按源记录键找
    for r in sorted(records, key=lambda r: r.entry_type == "code_row"):
        k = f"{r.entry_type}|{r.source_key}"
        if k in existing:
            continue
        parent_id = None
        if r.parent_key is not None:
            parent_id = existing.get(f"value_domain|{r.parent_key}")
            if parent_id is None:
                raise ImportFailure(
                    f"{r.provenance.member}#{r.provenance.json_pointer}：找不到所属值域表"
                )
        e = StandardEntry(
            document_id=sd.id,
            entry_type=r.entry_type,
            source_key=r.source_key,
            identifier=r.identifier,
            name=r.name,
            parent_id=parent_id,
            seq=r.seq,
            body=r.body.model_dump(mode="json"),
            raw=r.raw,
            provenance=r.provenance.model_dump(mode="json"),
            search_text=search_text(r.identifier, r.name, doc.standard_no),
        )
        session.add(e)
        session.flush()
        existing[k] = e.id
        added += 1
        for ref in r.refs:
            session.add(StandardReference(from_entry_id=e.id, **ref.__dict__))
    session.flush()
    covered = len(existing)
    if covered != sd.covered_keys:
        sd.covered_keys = covered
        sd.imported_at = func.localtimestamp()
        session.flush()
    return {
        "document_id": sd.id,
        "standard": f"{doc.standard_no}—{doc.standard_year}"
        if doc.standard_year
        else doc.standard_no,
        "reader": f"{reader.name}@{reader.version}",
        "added": added,
        "covered": covered,
        "total": sd.total_records,
        "_selected_ids": [
            {"identifier": r.identifier} for r in records if r.entry_type != "code_row"
        ],
    }
