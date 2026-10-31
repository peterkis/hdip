"""标准目录与原文的只读查询（迁移 0025，docs/标准资料库-目录与原文实施计划.md 第 3.4、5、6 节）。

- 目录一行 = 一项标准（标准号 + 年份），目录信息取最新一版；状态在读取时推算“即将实施”。
- 已有结构化成果在读取时挂上：处理修订按标准号 + 年份完全相同找标准，按 source_sha256 找原文文件；
  只按摘要认同一份文件，A 文件的页码不拿到 B 文件里跳。
- 原文按 id 读取：路径须仍在资料目录 originals/ 下，大小与 SHA-256 都与登记一致才给出。
"""

import hashlib
from datetime import date
from pathlib import Path

from sqlalchemy import Integer, and_, case, cast, exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from hdip_api.core.errors import NotFound
from hdip_api.models import (
    SourceDocument,
    SourcePackage,
    StandardEdition,
    StandardEditionVersion,
    StandardFile,
)
from hdip_api.schemas.standards import (
    EditionRef,
    EditionRevision,
    EditionStatus,
    EditionVersionOut,
    StandardEditionDetail,
    StandardEditionPage,
    StandardEditionRow,
    StandardFileOut,
)

TEXT_ROLES = ("TEXT", "BOUND", "ORIGINAL_FORMAT")


def _latest():
    """每项标准的最新目录版本（子查询）。"""
    return (
        select(StandardEditionVersion)
        .distinct(StandardEditionVersion.edition_id)
        .order_by(StandardEditionVersion.edition_id, StandardEditionVersion.seq.desc())
        .subquery()
    )


def _status_expr(v):
    return case(
        (v.c.status.is_(None), literal("unverified")),
        (v.c.status == "ABOLISHED", literal("abolished")),
        (v.c.effective_on > func.current_date(), literal("upcoming")),
        else_=literal("current"),
    )


def status_of(status: str | None, effective_on: date | None, today: date) -> EditionStatus:
    if status is None:
        return "unverified"
    if status == "ABOLISHED":
        return "abolished"
    return "upcoming" if effective_on and effective_on > today else "current"


# 标准号自然排序：系列、主号、分册号逐级按数字（363.2 在 363.10 之前）
def _order(e=StandardEdition):
    num = func.split_part(e.standard_no, " ", 2)
    return (
        case({"GB": 0, "GB/T": 1, "WS": 2, "WS/T": 3}, value=e.series),
        cast(func.string_to_array(num, "."), ARRAY(Integer)),
        e.standard_year,
    )


def _file_counts(session: Session, ids: list[int]) -> dict[int, dict[str, int]]:
    out: dict[int, dict[str, int]] = {i: {"text": 0, "page": 0, "other": 0} for i in ids}
    for eid, role, n in session.execute(
        select(StandardFile.edition_id, StandardFile.role, func.count())
        .where(StandardFile.edition_id.in_(ids))
        .group_by(StandardFile.edition_id, StandardFile.role)
    ):
        k = "text" if role in TEXT_ROLES else "page" if role == "PAGE_IMAGE" else "other"
        out[eid][k] += n
    return out


def _structured(session: Session, editions: list[StandardEdition]) -> dict[int, dict[str, int]]:
    """各标准当前处理修订的条目数（多份相加）。"""
    from hdip_api.services.standards import _Catalog, _counts

    if not editions:
        return {}
    cat = _Catalog(session)
    counts = _counts(session)
    by_key: dict[tuple, dict[str, int]] = {}
    for d in cat.docs.values():
        if d.id not in cat.current:
            continue
        acc = by_key.setdefault((d.standard_no, d.standard_year), {})
        for t, n in counts.get(d.id, {}).items():
            acc[t] = acc.get(t, 0) + n
    return {e.id: by_key.get((e.standard_no, e.standard_year), {}) for e in editions}


def _row(e: StandardEdition, v, files: dict[str, int], counts: dict[str, int], today: date):
    return StandardEditionRow(
        id=e.id,
        series=e.series,
        standard_no=e.standard_no,
        standard_year=e.standard_year,
        title=v.title,
        status=status_of(v.status, v.effective_on, today),
        verified_on=v.verified_on,
        issued_on=v.issued_on,
        effective_on=v.effective_on,
        catalog_category=v.catalog_category,
        difference=v.difference,
        text_files=files["text"],
        page_images=files["page"],
        other_files=files["other"],
        counts=counts,
    )


def _today(session: Session) -> date:
    return session.scalar(select(func.current_date()))


def search_editions(
    session: Session,
    *,
    q: str | None = None,
    series: str | None = None,
    status: EditionStatus | None = None,
    has_text: bool | None = None,
    structured: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> StandardEditionPage:
    v = _latest()
    stmt = select(StandardEdition, v).join(v, v.c.edition_id == StandardEdition.id)
    if q and q.strip():
        term = q.strip()
        compact = "".join(term.split()).replace("—", "-").replace("–", "-").upper()
        code = func.upper(
            func.replace(StandardEdition.standard_no, " ", "") + "-" + StandardEdition.standard_year
        )
        stmt = stmt.where(
            or_(
                v.c.title.ilike(f"%{term}%"),
                code.contains(compact, autoescape=True),
                func.upper(func.replace(v.c.catalog_code, " ", "")).contains(
                    compact, autoescape=True
                ),
            )
        )
    if series:
        stmt = stmt.where(StandardEdition.series == series)
    if status:
        stmt = stmt.where(_status_expr(v) == status)
    if has_text is not None:
        has = exists().where(
            and_(StandardFile.edition_id == StandardEdition.id, StandardFile.role.in_(TEXT_ROLES))
        )
        stmt = stmt.where(has if has_text else ~has)
    if structured is not None:
        has = exists().where(
            and_(
                SourceDocument.standard_no == StandardEdition.standard_no,
                SourceDocument.standard_year == StandardEdition.standard_year,
            )
        )
        stmt = stmt.where(has if structured else ~has)
    total = session.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = session.execute(stmt.order_by(*_order()).offset(offset).limit(limit)).all()
    editions = [r[0] for r in rows]
    files = _file_counts(session, [e.id for e in editions])
    counts = _structured(session, editions)
    today = _today(session)
    items = [_row(r[0], r, files[r[0].id], counts[r[0].id], today) for r in rows]
    return StandardEditionPage(items=items, total=total or 0, offset=offset, limit=limit)


def _version_out(v: StandardEditionVersion) -> EditionVersionOut:
    return EditionVersionOut.model_validate(v, from_attributes=True)


def _file_out(f: StandardFile) -> StandardFileOut:
    return StandardFileOut.model_validate(f, from_attributes=True)


def get_edition(session: Session, edition_id: int) -> StandardEditionDetail:
    from hdip_api.services.standards import _Catalog, _counts

    e = session.get(StandardEdition, edition_id)
    if e is None:
        raise NotFound("找不到这项标准")
    versions = list(
        session.scalars(
            select(StandardEditionVersion)
            .where(StandardEditionVersion.edition_id == e.id)
            .order_by(StandardEditionVersion.seq)
        )
    )
    files = list(
        session.scalars(
            select(StandardFile)
            .where(StandardFile.edition_id == e.id)
            .order_by(
                case(
                    {"TEXT": 0, "BOUND": 1, "ORIGINAL_FORMAT": 2, "ERRATA": 3, "PAGE_IMAGE": 4},
                    value=StandardFile.role,
                ),
                StandardFile.file_name,
            )
        )
    )
    cat = _Catalog(session)
    counts = _counts(session)
    by_sha = {f.sha256: f.id for f in files}
    revisions = []
    docs = session.execute(
        select(SourceDocument, SourcePackage)
        .join(SourcePackage, SourcePackage.id == SourceDocument.package_id)
        .where(
            SourceDocument.standard_no == e.standard_no,
            SourceDocument.standard_year == e.standard_year,
        )
    ).all()
    for d, p in docs:
        revisions.append(
            EditionRevision(
                document=cat.ref(d),
                package_file=p.file_name,
                total_records=d.total_records,
                covered_keys=d.covered_keys,
                counts=counts.get(d.id, {}),
                source_sha256=d.source_sha256,
                file_id=by_sha.get(d.source_sha256) if d.source_sha256 else None,
            )
        )
    revisions.sort(key=lambda r: (not r.document.is_current, r.document.id))
    cur = versions[-1]
    fc = {"text": 0, "page": 0, "other": 0}
    for f in files:
        k = "text" if f.role in TEXT_ROLES else "page" if f.role == "PAGE_IMAGE" else "other"
        fc[k] += 1
    row = _row(e, cur, fc, _structured(session, [e])[e.id], _today(session))
    return StandardEditionDetail(
        **row.model_dump(),
        current=_version_out(cur),
        versions=[_version_out(v) for v in versions],
        files=[_file_out(f) for f in files],
        revisions=revisions,
    )


def link_documents(
    session: Session, docs: list[SourceDocument]
) -> dict[int, tuple[EditionRef | None, int | None]]:
    """处理修订 → (所属标准, 摘要相同的原文文件 id)。"""
    keys = {(d.standard_no, d.standard_year) for d in docs if d.standard_year}
    if not keys:
        return {d.id: (None, None) for d in docs}
    v = _latest()
    hits = session.execute(
        select(StandardEdition, v.c.title)
        .join(v, v.c.edition_id == StandardEdition.id)
        .where(
            or_(
                *(
                    and_(StandardEdition.standard_no == n, StandardEdition.standard_year == y)
                    for n, y in keys
                )
            )
        )
    ).all()
    eds = {(e.standard_no, e.standard_year): (e, t) for e, t in hits}
    files: dict[tuple[int, str], int] = {
        (eid, sha): fid
        for fid, eid, sha in session.execute(
            select(StandardFile.id, StandardFile.edition_id, StandardFile.sha256).where(
                StandardFile.edition_id.in_([e.id for e, _ in eds.values()])
            )
        )
    }
    out: dict[int, tuple[EditionRef | None, int | None]] = {}
    for d in docs:
        hit = eds.get((d.standard_no, d.standard_year))
        if hit is None:
            out[d.id] = (None, None)
            continue
        e, title = hit
        ref = EditionRef(
            id=e.id, standard_no=e.standard_no, standard_year=e.standard_year, title=title
        )
        out[d.id] = (ref, files.get((e.id, d.source_sha256 or "")))
    return out


class FileUnavailable(NotFound):
    pass


def file_path(session: Session, standards_dir: Path, file_id: int) -> tuple[StandardFile, Path]:
    f = session.get(StandardFile, file_id)
    if f is None:
        raise NotFound("找不到这个原文文件")
    root = (standards_dir.resolve() / "originals").resolve()
    p = (standards_dir.resolve() / f.stored_path).resolve()
    if not p.is_relative_to(root) or not p.is_file():
        raise FileUnavailable("原文文件不在资料目录：可能已被移走，请重建原件层后再试")
    if p.stat().st_size != f.bytes:
        raise FileUnavailable("原文文件已变动：大小与登记时不同，不显示")
    # 同大小替换（误改、同盘硬链接的另一入口被改写）只有摘要看得出：只算这一份，不扫描整库，
    # 不把磁盘摘要写回库里。页面上“摘要一致的原文”与按页跳转都以此为前提
    if _sha256(p) != f.sha256:
        raise FileUnavailable("原文文件已变动：内容摘要与登记时不同，不显示")
    return f, p


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
