"""把原件层生成的目录登记进标准目录（迁移 0025，docs/标准资料库-目录与原文实施计划.md 第 4 节）。

读 HDIP_STANDARDS_DIR/catalog/ 下的 editions.csv（一条目录 / 版次记录）与 files.csv
（一个归档文件），二者由 scripts/originals_build.py 生成。规则：
- 新标准 → 身份 + 第 1 版；目录字段变了 → 追加一版并写明改了哪些字段；没变 → 不写。重复执行不增行。
- CSV 里少了已登记的标准或文件 → 拒绝（库里不删）；已登记的文件信息变了 → 拒绝。
- 文件须在 originals/ 下、存在，大小与摘要和 CSV 一致；只算摘要，不解析、不执行。
- 任何一行有问题就整体失败，报“文件:行号 列名：原因”，一次列出全部问题。
"""

import csv
import hashlib
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.models import StandardEdition, StandardEditionVersion, StandardFile

STATUS = {"现行": "CURRENT", "即将实施": "CURRENT", "废止": "ABOLISHED", "": None}
ROLE = {
    "正文": "TEXT",
    "合订": "BOUND",
    "修改单": "ERRATA",
    "原页图": "PAGE_IMAGE",
    "原格式": "ORIGINAL_FORMAT",
}
MEDIA = {
    ".pdf": "application/pdf",
    ".gif": "image/gif",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
NUMBER = re.compile(r"^(GB|GB/T|WS|WS/T) \d+(\.\d+)*$")
RELATED = "_相关官方资料"

# 目录字段 → 中文名（change_note 用），顺序即比较顺序
FIELDS = {
    "title": "名称",
    "catalog_code": "官网写法",
    "catalog_category": "官网分类",
    "status": "状态",
    "issued_on": "发布日期",
    "effective_on": "实施日期",
    "verified_on": "核实日期",
    "basis_url": "核实依据地址",
    "basis_note": "核实依据",
    "online_url": "在线阅读",
    "difference": "差异类别",
    "file_identity": "文件内标识",
    "note": "备注",
}
FILE_FIELDS = ("edition_id", "role", "source", "identity_check", "page_image", "bytes", "sha256")


class CatalogFailure(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


@dataclass
class CatalogResult:
    editions_added: int = 0
    versions_added: int = 0
    files_added: int = 0
    unchanged: int = 0
    skipped_related: int = 0
    changes: list[str] = field(default_factory=list)


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _rows(path: Path) -> list[tuple[int, dict[str, str]]]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [
            (i, {k: (v or "").strip() for k, v in r.items()})
            for i, r in enumerate(csv.DictReader(f), 2)
        ]


def _folder(number: str, year: str) -> str:
    series, num = number.split(" ", 1)
    s = series.replace("/", "-")
    return f"{s}/{s}-{num}_{year}"


def import_catalog(
    session: Session, standards_dir: Path, *, dry_run: bool = False
) -> CatalogResult:
    root = standards_dir.resolve()
    cat = root / "catalog"
    problems: list[str] = []
    res = CatalogResult()

    def bad(src: str, line: int, col: str, why: str) -> None:
        problems.append(f"{src}:{line} {col}：{why}")

    def day(src: str, line: int, col: str, v: str) -> date | None:
        if not v:
            return None
        try:
            return date.fromisoformat(v)
        except ValueError:
            bad(src, line, col, f"日期写法应为 YYYY-MM-DD，现为“{v}”")
            return None

    # ------------------------------------------------------------ 目录
    wanted: dict[tuple[str, str], dict] = {}
    folders: dict[str, tuple[str, str]] = {}
    for line, r in _rows(cat / "editions.csv"):
        src = "editions.csv"
        no, year = r.get("编号", ""), r.get("年份", "")
        if not NUMBER.match(no):
            bad(src, line, "编号", f"应为“WS/T 363.3”这样的写法，现为“{no}”")
            continue
        if not re.fullmatch(r"\d{4}", year):
            bad(src, line, "年份", f"应为四位年份，现为“{year}”")
            continue
        if (no, year) in wanted:
            bad(src, line, "编号", f"{no}—{year} 重复")
            continue
        if not r.get("名称"):
            bad(src, line, "名称", "不能为空")
        if r.get("官网状态", "") not in STATUS:
            bad(src, line, "官网状态", f"只认 现行 / 即将实施 / 废止，现为“{r['官网状态']}”")
            continue
        status = STATUS[r.get("官网状态", "")]
        official = bool(r.get("官网详情"))
        v = {
            "title": r.get("名称", ""),
            "catalog_code": r.get("标准号") if official else None,
            "catalog_category": r.get("官网分类") or None,
            "status": status,
            "issued_on": day(src, line, "批准日期", r.get("批准日期", "")),
            "effective_on": day(src, line, "实施日期", r.get("实施日期", "")),
            "verified_on": day(src, line, "核实日期", r.get("核实日期", "")),
            "basis_url": r.get("官网详情") or None,
            "basis_note": r.get("核实依据") or None,
            "online_url": r.get("在线阅读") or None,
            "difference": r.get("差异类别") or None,
            "file_identity": r.get("文件内标识") or None,
            "note": r.get("备注") or None,
        }
        if status and not v["verified_on"]:
            bad(src, line, "核实日期", "有官网状态时必填")
        if status and not (v["basis_url"] or v["basis_note"]):
            bad(src, line, "官网详情", "有官网状态时须写核实依据")
        wanted[(no, year)] = v
        folders[_folder(no, year)] = (no, year)

    existing = {
        (e.standard_no, e.standard_year): e for e in session.scalars(select(StandardEdition))
    }
    for k in existing.keys() - wanted.keys():
        problems.append(f"editions.csv 少了已登记的标准 {k[0]}—{k[1]}：库里不删，请恢复该行")

    # ------------------------------------------------------------ 文件
    files_wanted: dict[str, dict] = {}
    for line, r in _rows(cat / "files.csv"):
        src = "files.csv"
        d, name = r.get("目录", ""), r.get("文件名", "")
        if d.split("/", 1)[0] == RELATED:
            res.skipped_related += 1
            continue
        key = folders.get(d.removesuffix("/原页图"))
        if key is None:
            bad(src, line, "目录", f"“{d}”没有对应的目录记录")
            continue
        if r.get("角色") not in ROLE:
            bad(src, line, "角色", f"不认识“{r.get('角色')}”")
            continue
        path = (root / "originals" / d / name).resolve()
        if not path.is_relative_to(root / "originals"):
            bad(src, line, "文件名", "路径逃出资料目录 originals/")
            continue
        media = MEDIA.get(path.suffix.lower())
        if media is None:
            bad(src, line, "文件名", f"不收 {path.suffix} 文件")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", r.get("sha256", "")):
            bad(src, line, "sha256", "应为 64 位小写十六进制")
            continue
        if not path.is_file():
            bad(src, line, "文件名", f"文件不在资料目录：originals/{d}/{name}")
            continue
        size = path.stat().st_size
        if str(size) != r.get("字节"):
            bad(src, line, "字节", f"本地文件 {size} 字节，与 CSV 的 {r.get('字节')} 不一致")
            continue
        if _sha(path) != r["sha256"]:
            bad(src, line, "sha256", "本地文件摘要与 CSV 不一致")
            continue
        stored = path.relative_to(root).as_posix()
        files_wanted[stored] = {
            "key": key,
            "role": ROLE[r["角色"]],
            "source": r.get("来源", ""),
            "identity_check": r.get("身份核对", ""),
            "page_image": r.get("完整性") == "单页页图",
            "stored_path": stored,
            "file_name": name,
            "media_type": media,
            "bytes": size,
            "sha256": r["sha256"],
            "note": r.get("备注") or None,
        }
    seen: dict[tuple, str] = {}
    for stored, f in files_wanted.items():
        k = (f["key"], f["sha256"])
        if k in seen:
            problems.append(f"files.csv {stored}：与 {seen[k]} 字节相同，同一标准下只登记一次")
        seen[k] = stored

    have_files = {f.stored_path: f for f in session.scalars(select(StandardFile))}
    eid_key = {e.id: k for k, e in existing.items()}
    for stored, f in have_files.items():
        w = files_wanted.get(stored)
        if w is None:
            problems.append(f"files.csv 少了已登记的文件 {stored}：库里不删，请恢复该行")
            continue
        old = {c: getattr(f, c) for c in FILE_FIELDS}
        old["edition_id"] = eid_key.get(f.edition_id)
        new = {c: (w["key"] if c == "edition_id" else w[c]) for c in FILE_FIELDS}
        diff = [c for c in FILE_FIELDS if old[c] != new[c]]
        if diff:
            problems.append(f"files.csv {stored}：已登记的文件信息不能改（{', '.join(diff)}）")

    if problems:
        raise CatalogFailure(problems)

    # ------------------------------------------------------------ 写入
    latest: dict[int, StandardEditionVersion] = {}
    for v in session.scalars(select(StandardEditionVersion).order_by(StandardEditionVersion.seq)):
        latest[v.edition_id] = v

    for (no, year), v in sorted(wanted.items()):
        e = existing.get((no, year))
        if e is None:
            res.editions_added += 1
            res.versions_added += 1
            res.changes.append(f"新增 {no}—{year}《{v['title']}》")
            if dry_run:
                continue
            e = StandardEdition(series=no.split(" ", 1)[0], standard_no=no, standard_year=year)
            session.add(e)
            session.flush()
            existing[(no, year)] = e
            session.add(StandardEditionVersion(edition_id=e.id, seq=1, change_note="首次登记", **v))
            continue
        cur = latest[e.id]
        diff = [label for col, label in FIELDS.items() if getattr(cur, col) != v[col]]
        if not diff:
            res.unchanged += 1
            continue
        res.versions_added += 1
        res.changes.append(f"{no}—{year} 改：{'、'.join(diff)}")
        if not dry_run:
            session.add(
                StandardEditionVersion(
                    edition_id=e.id, seq=cur.seq + 1, change_note=f"改：{'、'.join(diff)}", **v
                )
            )
    if not dry_run:
        session.flush()
    for stored, f in sorted(files_wanted.items()):
        if stored in have_files:
            continue
        res.files_added += 1
        if dry_run:
            continue
        e = existing[f["key"]]
        cols = {k: f[k] for k in f if k != "key"}
        session.add(StandardFile(edition_id=e.id, **cols))
    if not dry_run:
        session.flush()
    return res
