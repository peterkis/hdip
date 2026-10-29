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
    r"\s*(?P<rest>.*)$",
    re.S,
)
# 值域编号 CVdd.dd.ddd：点两侧、前两段数字之间允许排版空白（如“CV0 5. 10. 018”）；
# 末段三位须连写，后面不能紧跟数字，免得把表名开头的数字并进编号
_CV_FULL = re.compile(r"CV\s*(\d)\s*(\d)\s*\.\s*(\d)\s*(\d)\s*\.\s*(\d{3})(?!\d)", re.S)
_CV_PREFIX = re.compile(r"CV[\d\s.]*\d|CV", re.S)
CV_ID = re.compile(r"CV\d{2}\.\d{2}\.\d{3}")


def parse_allowed_values(field_name: str, raw: str) -> tuple[str, Ref | None]:
    """允许值原文 → (原性质, 引用)。只认开头明确写出标准号的引用；其余按原文说明保留。

    值域编号只认完整的 CVdd.dd.ddd（内部排版空白归一后记为阅读定位用的编号，原文在 raw_text）；
    编号不完整时目标标识留空、不猜测补全（读取器 v2，资料基线 3.1 B1）。
    """
    if not raw.strip():
        return "empty", None
    m = _REF_RE.match(_ws(raw))
    if not m:
        return "text", None
    std = re.sub(r"\s*\.\s*", ".", m.group("std"))
    std = re.sub(r"^(WS/T|WS|GB/T|GB)\s*", r"\1 ", std)
    rest = m.group("rest")
    cv: str | None = None
    kind = "external_standard"
    if rest.startswith("CV"):
        kind = "value_domain"
        if full := _CV_FULL.match(rest):
            a, b, c, d, e = full.groups()
            cv, rest = f"CV{a}{b}.{c}{d}.{e}", rest[full.end() :]
        else:
            rest = rest[_CV_PREFIX.match(rest).end() :]
    label = rest.strip()
    return "reference", Ref(
        field=field_name,
        ref_kind=kind,
        raw_text=raw,
        target_standard=std,
        target_year=m.group("year"),
        target_identifier=cv,
        target_label=label or None,
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


def _model[M: BaseModel](model: type[M], data: dict, where: str) -> M:
    """正文、出处的模型校验；不通过时报出成员、位置与字段。"""
    try:
        return model.model_validate(data)
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(x) for x in first["loc"])
        raise ImportFailure(f"{where}：字段 {loc} 不符合要求（{first['msg']}）") from None


_KIND = {str: "文本", int: "整数", type(None): "空值", dict: "对象", list: "数组"}


class _Src:
    """一条源记录：按字段取值并检查形状。

    形状不对时报“成员#[位置]：字段 路径 应为…（原值 …）”，不跳过、不补默认值；
    缺字段与 null 照旧按“未提供”处理（资料本身允许缺项）。
    """

    def __init__(self, rec: Any, where: str, path: str = "") -> None:
        if not isinstance(rec, dict):
            what = f"字段 {path.rstrip('.')}" if path else "记录"
            raise ImportFailure(f"{where}：{what} 应为对象（原值 {rec!r:.60}）")
        self.rec, self.where, self.path = rec, where, path

    def fail(self, key: str, want: str, value: Any) -> ImportFailure:
        return ImportFailure(
            f"{self.where}：字段 {self.path}{key} 应为{want}（原值 {value!r:.60}）"
        )

    def need(self, key: str) -> str:
        """必填文本：缺字段、null、空串都算缺少。"""
        v = self.str(key)
        if not v:
            raise ImportFailure(f"{self.where}：缺少 {self.path}{key}")
        return v

    def str(self, key: str) -> str | None:
        v = self.rec.get(key)
        if v is not None and not isinstance(v, str):
            raise self.fail(key, "文本", v)
        return v

    def int(self, key: str) -> int | None:
        v = self.rec.get(key)
        if v is not None and (not isinstance(v, int) or isinstance(v, bool)):
            raise self.fail(key, "整数", v)
        return v

    def list(self, key: str, *items: type) -> list:
        """数组；给了 items 时逐项检查类型。缺字段或 null 视为空数组。"""
        v = self.rec.get(key)
        if v is None:
            return []
        if not isinstance(v, list):
            raise self.fail(key, "数组", v)
        if items:
            for n, x in enumerate(v):
                if not isinstance(x, items) or isinstance(x, bool):
                    want = "或".join(_KIND[t] for t in items)
                    raise self.fail(f"{key}[{n}]", want, x)
        return v

    def obj(self, key: str) -> "_Src":
        """嵌套对象；缺字段或 null 视为空对象。"""
        v = self.rec.get(key)
        return _Src({} if v is None else v, self.where, f"{self.path}{key}.")


# ---------------------------------------------------------------- 资料族：WS/T 363 + 364


class Ws363364Reader:
    """主题 01 包的 WS/T 363 选定正文文件与 WS/T 364 表 / 代码行（建设计划附录 A）。"""

    family = "ws363-364"
    name = "ws363-364"
    # 2：值域编号排版空白归一、不完整编号不建目标；source_issues 保留对象；raw_cells 的 null
    # 保留为空；补读 qa_evidence.source_images（资料基线 3.1 B1、D）
    version = "2"
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

        for i, raw in enumerate(self._load(self.DE_MEMBER)):
            src = _Src(raw, f"{self.DE_MEMBER}#[{i}]")
            d = doc(src.need("standard"), self.DE_MEMBER)
            d.records.append(self._data_element(src, i, len(d.records)))
            d.source_version = d.source_version or src.str("source_version")
            d.source_sha256 = d.source_sha256 or src.str("source_sha256")
            d.source_pdf = d.source_pdf or src.str("source_pdf")
            d.source_url = d.source_url or src.str("source_url")

        table_key: dict[tuple[str, str], str] = {}
        for i, raw in enumerate(self._load(self.CV_TABLES)):
            src = _Src(raw, f"{self.CV_TABLES}#[{i}]")
            label = src.need("standard_part")
            d = doc(label, self.CV_TABLES)
            r = self._value_domain(src, i, len(d.records))
            table_key[(label, r.identifier or "")] = r.source_key
            d.records.append(r)
            d.source_sha256 = d.source_sha256 or src.str("source_sha256")
            d.source_url = d.source_url or src.str("source_url")

        for i, raw in enumerate(self._load(self.CV_ROWS)):
            src = _Src(raw, f"{self.CV_ROWS}#[{i}]")
            label = src.need("standard_part")
            cv = src.need("cv_id")
            parent = table_key.get((label, cv))
            if parent is None:
                raise ImportFailure(
                    f"{src.where}：代码行所属的值域表 {label} {cv} 不在 {self.CV_TABLES}"
                )
            d = doc(label, self.CV_ROWS)
            d.records.append(self._code_row(src, i, len(d.records), parent))
            d.source_pdf = d.source_pdf or src.str("source_path")

        yield from docs.values()

    def _data_element(self, src: _Src, i: int, seq: int) -> Record:
        cells = src.obj("raw_cells")
        ident = cells.need("数据元标识符")
        allowed = cells.str("数据元允许值") or ""
        nature, ref = parse_allowed_values("数据元允许值", allowed)
        body = _model(
            DataElementBody,
            {
                "identifier": ident,
                "name": cells.need("数据元名称"),
                "definition": cells.str("定义") or "",
                "data_type": cells.str("数据元值的数据类型") or "",
                "format": cells.str("表示格式") or "",
                "allowed_values": allowed,
                "allowed_value_nature": nature,
                "version": src.str("data_element_version"),
                "section": src.str("source_section"),
            },
            src.where,
        )
        qa = src.obj("qa_evidence")
        # 新建列表合并去重：_Src.list 返回源数组本身，原地追加会改写 raw 里的 image_paths / pages
        images = list(
            dict.fromkeys(
                [
                    *(qa.list("image_paths", str) or qa.list("pages", str)),
                    *qa.list("source_images", str),
                ]
            )
        )
        source_pdf, source_url = src.str("source_pdf"), src.str("source_url")
        provenance = _model(
            Provenance,
            {
                "member": self.DE_MEMBER,
                "json_pointer": f"[{i}]",
                "pdf_pages": src.list("source_pdf_pages", int),
                "printed_pages": [str(p) for p in src.list("source_printed_pages", str, int)],
                "source_pdf": source_pdf,
                "source_url": source_url,
                "source_sha256": src.str("source_sha256"),
                "qa_status": src.str("qa_status"),
                "import_gate": src.str("automatic_import_gate"),
                "source_issues": src.list("source_issues", str, dict),
                "evidence": _evidence_images(images, self.members)
                + _source_pdf(source_pdf, source_url, self.members),
            },
            src.where,
        )
        return Record(
            entry_type="data_element",
            source_key=f"{self.DE_MEMBER}#[{i}]",
            identifier=ident,
            name=body.name,
            seq=seq,
            body=body,
            raw=src.rec,
            provenance=provenance,
            refs=[ref] if ref else [],
        )

    def _value_domain(self, src: _Src, i: int, seq: int) -> Record:
        cv = src.need("cv_id")
        body = _model(
            ValueDomainBody,
            {
                "identifier": cv,
                "name": src.need("table_name"),
                "definition": src.str("definition") or "",
                "structure": src.str("structure") or "",
                "definition_raw": src.str("definition_and_structure_raw") or "",
                "column_headers": src.list("source_column_headers", str)
                if src.rec.get("source_column_headers") is not None
                else None,
            },
            src.where,
        )
        page = src.int("source_physical_page")
        printed = src.rec.get("source_printed_page")
        if printed is not None and not isinstance(printed, str | int):
            raise src.fail("source_printed_page", "文本或整数", printed)
        source_url, qa_note = src.str("source_url"), src.str("qa_note")
        provenance = _model(
            Provenance,
            {
                "member": self.CV_TABLES,
                "json_pointer": f"[{i}]",
                "record_id": src.str("table_id"),
                "pdf_pages": [page] if page is not None else [],
                "printed_pages": [str(printed)] if printed else [],
                "source_url": source_url,
                "source_sha256": src.str("source_sha256"),
                "qa_status": src.str("qa_status"),
                "source_issues": [qa_note] if qa_note else [],
                "evidence": _source_pdf(None, source_url, self.members),
            },
            src.where,
        )
        return Record(
            entry_type="value_domain",
            source_key=f"{self.CV_TABLES}#[{i}]",
            identifier=cv,
            name=body.name,
            seq=seq,
            body=body,
            raw=src.rec,
            provenance=provenance,
        )

    def _code_row(self, src: _Src, i: int, seq: int, parent_key: str) -> Record:
        row_id = src.need("row_id")
        code = src.rec.get("code")
        if code is not None and not isinstance(code, str):
            raise ImportFailure(f"{src.where}：码值应为字符串（原值 {code!r}），不能按数字读取")
        code = src.need("code")
        body = _model(
            CodeRowBody,
            {
                "code": code,
                "name": src.str("name") or "",
                "description": src.str("description") or "",
                "hierarchy_level": src.int("hierarchy_level"),
                "parent_code": src.str("parent_code") or None,
                "raw_cells": src.list("raw_cells", str, type(None)),
            },
            src.where,
        )
        frag, row = src.int("source_fragment"), src.int("source_row")
        source_pdf, source_url = src.str("source_path"), src.str("source_url")
        image, qa_note = src.str("source_image"), src.str("qa_note")
        provenance = _model(
            Provenance,
            {
                "member": self.CV_ROWS,
                "json_pointer": f"[{i}]",
                "record_id": row_id,
                "pdf_pages": src.list("source_physical_pages", int),
                "printed_pages": [str(p) for p in src.list("source_printed_pages", str, int)],
                "table_ref": f"片段 {frag} 第 {row} 行"
                if frag is not None and row is not None
                else None,
                "source_pdf": source_pdf,
                "source_url": source_url,
                "source_sha256": src.str("source_sha256"),
                "qa_status": src.str("qa_status"),
                "source_issues": [qa_note] if qa_note else [],
                "evidence": _evidence_images([image] if image else [], self.members)
                + _source_pdf(source_pdf, source_url, self.members),
            },
            src.where,
        )
        return Record(
            entry_type="code_row",
            source_key=row_id,
            identifier=code,
            name=body.name,
            seq=seq,
            body=body,
            raw=src.rec,
            parent_key=parent_key,
            provenance=provenance,
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
