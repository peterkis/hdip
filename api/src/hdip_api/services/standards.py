"""标准资料库的只读查询：资料目录、条目检索、条目详情（含引用解析与出处）。

处理修订（docs/标准资料库-F2开发计划.md 第 2 节）：同一包、资料族、读取器、标准号、原文年份里
读取器版本（按十进制整数）最高的一份是“当前处理修订”，列表与检索默认只给它；
历史处理修订按 id 仍可打开。读取器版本是本系统的处理修订，不是标准版本。

值域引用在读取时按本库目录计算，不写回，且只在来源条目自己的处理修订范围里找（同一包、资料族、
读取器、读取器版本）：
- 先按原文标准号（含分册）+ 值域编号精确找；原文写明年份 → 只认同年份（explicit，其他年份另列、
  不等价），未写年份 → catalog（目录定位，不是原文指定）；多份 → candidates；
- 精确为 0 时，只对 WS/T 363.x—2023 数据元里写作 “WS 364.x” 的引用，按已知前缀差异回退到同分册的
  “WS/T 364.x”（match_basis = prefix_variant，仍是 catalog，不是 explicit）；名称明显不一致不回退；
- 仍找不到 → unresolved，另列阅读提示（其他分册的同编号表、其他处理修订的同标识条目），不改指。
名称比较（label_check）只作核对提示，不改变解析结果。
"""

import re
from collections import defaultdict

from sqlalchemy import Integer, case, cast, func, or_, select
from sqlalchemy.orm import Session, aliased

from hdip_api.core.errors import NotFound
from hdip_api.models import SourceDocument, SourcePackage, StandardEntry, StandardReference
from hdip_api.schemas.standards import (
    CodeRowBody,
    DataElementBody,
    DocumentRef,
    IncomingReference,
    PackageOut,
    ParentRef,
    Provenance,
    ReferenceOut,
    ReferenceTarget,
    RelatedTarget,
    StandardCodeRow,
    StandardDocumentDetail,
    StandardDocumentRow,
    StandardEntryDetail,
    StandardEntryPage,
    StandardEntryRow,
    ValueDomainBody,
)
from hdip_api.services.standards_import import _CV_FULL, CV_ID, search_text

NOTE_OTHER_PART = "引用分册中未找到该值域；本库其他分册存在同编号表，仅供参考。"
NOTE_OTHER_REVISION = "其他处理修订中存在同标识条目，不是本修订的解析结果。"


def _version(v: str) -> int:
    """读取器版本按十进制整数比较（v10 高于 v2）；不是数字的排在最低。"""
    return int(v) if v.isdigit() else -1


def series_of(standard_no: str) -> str:
    """“WS/T 363.3” → “WS/T 363”；没有分册的原样。"""
    return re.sub(r"\.\d+$", "", standard_no)


def _norm_std(s: str) -> str:
    return "".join(s.split()).upper()


class _Catalog:
    """一次请求内的文档目录：处理修订分组与当前修订。文档只有几十份，全部读进来比逐条查省事。"""

    def __init__(self, session: Session) -> None:
        self.docs: dict[int, SourceDocument] = {
            d.id: d for d in session.scalars(select(SourceDocument))
        }
        groups: dict[tuple, list[SourceDocument]] = defaultdict(list)
        for d in self.docs.values():
            groups[self.group_key(d)].append(d)
        self.groups = {
            k: sorted(v, key=lambda d: (_version(d.reader_version), d.id))
            for k, v in groups.items()
        }
        self.current = {g[-1].id for g in self.groups.values()}

    @staticmethod
    def group_key(d: SourceDocument) -> tuple:
        return (d.package_id, d.family, d.reader, d.standard_no, d.standard_year)

    @staticmethod
    def scope_key(d: SourceDocument) -> tuple:
        """引用解析范围：同一包、资料族、读取器、读取器版本。"""
        return (d.package_id, d.family, d.reader, d.reader_version)

    def ref(self, d: SourceDocument) -> DocumentRef:
        return DocumentRef(
            id=d.id,
            standard_no=d.standard_no,
            standard_year=d.standard_year,
            reader=d.reader,
            reader_version=d.reader_version,
            is_current=d.id in self.current,
        )

    def newer(self, d: SourceDocument) -> DocumentRef | None:
        if d.id in self.current:
            return None
        return self.ref(self.groups[self.group_key(d)][-1])

    def revisions(self, d: SourceDocument) -> list[DocumentRef]:
        return [self.ref(x) for x in self.groups[self.group_key(d)]]


def _row(cat: _Catalog, e: StandardEntry, parent: StandardEntry | None = None) -> StandardEntryRow:
    return StandardEntryRow(
        id=e.id,
        entry_type=e.entry_type,
        identifier=e.identifier,
        name=e.name,
        document=cat.ref(cat.docs[e.document_id]),
        parent_id=e.parent_id,
        parent=ParentRef(id=parent.id, identifier=parent.identifier, name=parent.name)
        if parent is not None
        else None,
    )


def _counts(session: Session) -> dict[int, dict[str, int]]:
    out: dict[int, dict[str, int]] = {}
    for doc_id, t, n in session.execute(
        select(StandardEntry.document_id, StandardEntry.entry_type, func.count()).group_by(
            StandardEntry.document_id, StandardEntry.entry_type
        )
    ):
        out.setdefault(doc_id, {})[t] = n
    return out


def _doc_row(cat: _Catalog, d: SourceDocument, p: SourcePackage, counts: dict[str, int]) -> dict:
    return {
        "id": d.id,
        "series": series_of(d.standard_no),
        "standard_no": d.standard_no,
        "standard_year": d.standard_year,
        "title": d.title,
        "family": d.family,
        "package_file": p.file_name,
        "reader": d.reader,
        "reader_version": d.reader_version,
        "total_records": d.total_records,
        "covered_keys": d.covered_keys,
        "counts": counts,
        "imported_at": d.imported_at,
        "is_current": d.id in cat.current,
        "newer_revision": cat.newer(d),
    }


# 标准号自然排序：系列文字、主号、分册号（363.2 在 363.10 之前）
_DOC_ORDER = (
    func.regexp_replace(SourceDocument.standard_no, r"\s*[\d.]+$", ""),
    cast(func.substring(SourceDocument.standard_no, r"(\d+)(?:\.\d+)?$"), Integer).nulls_first(),
    cast(func.substring(SourceDocument.standard_no, r"\.(\d+)$"), Integer).nulls_first(),
    SourceDocument.standard_year,
    SourceDocument.id,
)


def list_documents(session: Session, include_superseded: bool = False) -> list[StandardDocumentRow]:
    cat = _Catalog(session)
    counts = _counts(session)
    rows = session.execute(
        select(SourceDocument, SourcePackage)
        .join(SourcePackage, SourcePackage.id == SourceDocument.package_id)
        .order_by(*_DOC_ORDER)
    ).all()
    return [
        StandardDocumentRow(**_doc_row(cat, d, p, counts.get(d.id, {})))
        for d, p in rows
        if include_superseded or d.id in cat.current
    ]


def get_document(session: Session, doc_id: int) -> StandardDocumentDetail:
    hit = session.execute(
        select(SourceDocument, SourcePackage)
        .join(SourcePackage, SourcePackage.id == SourceDocument.package_id)
        .where(SourceDocument.id == doc_id)
    ).first()
    if hit is None:
        raise NotFound("找不到这份标准资料")
    d, p = hit
    cat = _Catalog(session)
    return StandardDocumentDetail(
        **_doc_row(cat, d, p, _counts(session).get(d.id, {})),
        package=PackageOut(
            id=p.id,
            file_name=p.file_name,
            stored_path=p.stored_path,
            bytes=p.bytes,
            sha256=p.sha256,
            expected_sha256=p.expected_sha256,
            sha_check="matched" if p.expected_sha256 else "not_compared",
            release_id=p.release_id,
            drive_file_id=p.drive_file_id,
            source_url=p.source_url,
            member_count=len(p.members),
            registered_at=p.registered_at,
        ),
        members=d.members,
        source_version=d.source_version,
        source_sha256=d.source_sha256,
        source_pdf=d.source_pdf,
        source_url=d.source_url,
        revisions=cat.revisions(d),
    )


def search_entries(
    session: Session,
    *,
    q: str | None = None,
    entry_type: str | None = None,
    top_level: bool = False,
    document_id: int | None = None,
    series: str | None = None,
    standard_no: str | None = None,
    standard_year: str | None = None,
    include_superseded: bool = False,
    offset: int = 0,
    limit: int = 50,
) -> StandardEntryPage:
    """筛选全部在计数与分页之前完成；排序稳定（标准号自然序 → 文档 → 类型 → 原顺序 → id）。

    指定 document_id 时就看那一份（历史处理修订也可以），不再按当前修订过滤。
    """
    cat = _Catalog(session)
    parent = aliased(StandardEntry)
    stmt = (
        select(StandardEntry, parent)
        .join(SourceDocument, SourceDocument.id == StandardEntry.document_id)
        .outerjoin(parent, parent.id == StandardEntry.parent_id)
    )
    if entry_type:
        stmt = stmt.where(StandardEntry.entry_type == entry_type)
    if top_level:
        stmt = stmt.where(StandardEntry.parent_id.is_(None))
    if document_id:
        stmt = stmt.where(StandardEntry.document_id == document_id)
    elif not include_superseded:
        stmt = stmt.where(StandardEntry.document_id.in_(cat.current or {0}))
    if series:
        stmt = stmt.where(
            or_(
                SourceDocument.standard_no == series, SourceDocument.standard_no.like(series + ".%")
            )
        )
    if standard_no:
        stmt = stmt.where(SourceDocument.standard_no == standard_no)
    if standard_year:
        stmt = stmt.where(SourceDocument.standard_year == standard_year)
    if q and (needle := search_text(q)):
        like = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(
            or_(
                StandardEntry.search_text.like(like),
                func.lower(StandardEntry.identifier) == needle,
            )
        )
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    type_order = case(
        {"data_element": 0, "value_domain": 1, "code_row": 2}, value=StandardEntry.entry_type
    )
    stmt = (
        stmt.order_by(*_DOC_ORDER, type_order, StandardEntry.seq, StandardEntry.id)
        .offset(offset)
        .limit(limit)
    )
    items = [_row(cat, e, p) for e, p in session.execute(stmt)]
    return StandardEntryPage(items=items, total=total, offset=offset, limit=limit)


# ---------------------------------------------------------------- 引用解析


def label_check(label: str | None, name: str | None) -> str | None:
    """来源引用名称与表名：去掉空白后一致 → same；只差末尾“代码”“表” → minor；其余 → different。

    不做相似度或语义判断：判断不了的一律 different（待人工核对）。
    """
    if not label or not name:
        return None
    a, b = re.sub(r"\s+", "", label), re.sub(r"\s+", "", name)
    if a == b:
        return "same"

    def stem(s: str) -> str:
        while (t := re.sub(r"(代码表|代码|表)$", "", s)) != s and t:
            s = t
        return s

    return "minor" if stem(a) == stem(b) else "different"


def _as_written(ref: StandardReference) -> tuple[str | None, bool, bool]:
    """原文的值域编号写法、是否做过空白归一、编号是否不完整。"""
    if ref.ref_kind != "value_domain":
        return None, False, False
    text = ref.raw_text
    if ref.target_identifier and CV_ID.fullmatch(ref.target_identifier):
        m = _CV_FULL.search(text)
        written = " ".join(m.group(0).split()) if m else ref.target_identifier
        return written, written != ref.target_identifier, False
    m = re.search(r"CV[\d\s.]*\d|CV", text)
    return (" ".join(m.group(0).split()) if m else ref.target_identifier), False, True


# 已核实的标准前缀书写差异：WS/T 363.x—2023 数据元把 WS/T 364.x 写作 WS 364.x
# （资料自身也记了这处差异）。只认这一种，不推广到 GB / GB/T 或其他系列
def _prefix_variant(ref: StandardReference, from_doc: SourceDocument) -> str | None:
    if not (
        from_doc.family == "ws363-364"
        and from_doc.standard_no.startswith("WS/T 363.")
        and from_doc.standard_year == "2023"
    ):
        return None
    m = re.fullmatch(r"WS 364\.(\d+)", ref.target_standard)
    return f"WS/T 364.{m.group(1)}" if m else None


def _year_split(hits, year):
    if not year:
        return hits, []
    return [h for h in hits if h[1].standard_year == year], [
        h for h in hits if h[1].standard_year != year
    ]


def _target(
    cat: _Catalog, e: StandardEntry, d: SourceDocument, label: str | None
) -> ReferenceTarget:
    return ReferenceTarget(
        entry_id=e.id,
        identifier=e.identifier,
        name=e.name,
        document=cat.ref(d),
        label_check=label_check(label, e.name),
    )


def resolve(
    session: Session, cat: _Catalog, ref: StandardReference, from_doc: SourceDocument
) -> ReferenceOut:
    written, normalized, incomplete = _as_written(ref)
    out = dict(
        field=ref.field,
        ref_kind=ref.ref_kind,
        raw_text=ref.raw_text,
        target_standard=ref.target_standard,
        target_year=ref.target_year,
        target_identifier=ref.target_identifier,
        target_label=ref.target_label,
        identifier_as_written=written,
        identifier_normalized=normalized,
        identifier_incomplete=incomplete,
    )
    if ref.ref_kind != "value_domain" or incomplete:
        # 外部规范引用本期不做跨资料族解析；不完整的编号不猜测补全
        return ReferenceOut(**out, resolution="unresolved", targets=[])

    rows = [
        (e, cat.docs[e.document_id])
        for e in session.scalars(
            select(StandardEntry)
            .where(
                StandardEntry.entry_type == "value_domain",
                StandardEntry.identifier == ref.target_identifier,
            )
            .order_by(StandardEntry.document_id, StandardEntry.id)
        )
    ]
    scope = _Catalog.scope_key(from_doc)
    in_scope = [h for h in rows if _Catalog.scope_key(h[1]) == scope]
    cited = _norm_std(ref.target_standard)
    label = ref.target_label

    exact, other_years = _year_split(
        [h for h in in_scope if _norm_std(h[1].standard_no) == cited], ref.target_year
    )
    related: list[RelatedTarget] = []
    variant = _prefix_variant(ref, from_doc)
    match_basis, note = None, None
    if exact:
        hits, match_basis = exact, "exact"
        if len(hits) > 1:
            resolution = "candidates"
        else:
            resolution = "explicit" if ref.target_year else "catalog"
    else:
        hits = []
        pv, _ = _year_split(
            [h for h in in_scope if variant and h[1].standard_no == variant], ref.target_year
        )
        if len(pv) > 1:
            hits, match_basis, resolution = pv, "prefix_variant", "candidates"
            note = f"来源写作 {ref.target_standard}；本库 {variant} 有多份同编号表，不自动选择。"
        elif pv and label_check(label, pv[0][0].name) == "different":
            resolution = "unresolved"
            related.append(
                RelatedTarget(
                    kind="prefix_variant_conflict",
                    note=f"本库 {variant} 有同编号表，但名称与来源不一致，未按前缀差异定位。",
                    target=_target(cat, *pv[0], label),
                )
            )
        elif pv:
            hits, match_basis, resolution = pv, "prefix_variant", "catalog"
            e, d = pv[0]
            where = f"{d.standard_no}—{d.standard_year}" if d.standard_year else d.standard_no
            note = f"来源写作 {ref.target_standard}；本库按已知标准前缀差异定位到 {where}。" + (
                "" if ref.target_year else "原文未写年份。"
            )
        else:
            resolution = "unresolved"

    if resolution == "unresolved":
        same_std = {cited} | ({_norm_std(variant)} if variant else set())
        shown = {r.target.entry_id for r in related}
        for e, d in in_scope:
            if _norm_std(d.standard_no) not in same_std and e.id not in shown:
                related.append(
                    RelatedTarget(
                        kind="other_part", note=NOTE_OTHER_PART, target=_target(cat, e, d, label)
                    )
                )
        for e, d in rows:
            if _Catalog.scope_key(d) != scope and _norm_std(d.standard_no) in same_std:
                related.append(
                    RelatedTarget(
                        kind="other_revision",
                        note=NOTE_OTHER_REVISION,
                        target=_target(cat, e, d, label),
                    )
                )
    return ReferenceOut(
        **out,
        resolution=resolution,
        match_basis=match_basis,
        resolution_note=note,
        targets=[_target(cat, e, d, label) for e, d in hits],
        other_versions=[_target(cat, e, d, label) for e, d in other_years],
        related=related,
    )


def _incoming(session: Session, cat: _Catalog, e: StandardEntry) -> list[IncomingReference]:
    if e.entry_type != "value_domain" or not e.identifier:
        return []
    src = aliased(StandardEntry)
    rows = session.execute(
        select(StandardReference, src)
        .join(src, src.id == StandardReference.from_entry_id)
        .where(StandardReference.target_identifier == e.identifier)
        .order_by(src.document_id, src.seq)
    ).all()
    out = []
    for ref, se in rows:
        r = resolve(session, cat, ref, cat.docs[se.document_id])
        hit = next((t for t in r.targets if t.entry_id == e.id), None)
        if hit is not None:
            out.append(
                IncomingReference(
                    entry=_row(cat, se),
                    raw_text=ref.raw_text,
                    resolution=r.resolution,
                    match_basis=r.match_basis,
                    label_check=hit.label_check,
                )
            )
    return out


def get_entry(session: Session, entry_id: int) -> StandardEntryDetail:
    e = session.get(StandardEntry, entry_id)
    if e is None:
        raise NotFound("找不到这个标准条目")
    cat = _Catalog(session)
    d = cat.docs[e.document_id]
    detail = StandardEntryDetail(
        id=e.id,
        entry_type=e.entry_type,
        source_key=e.source_key,
        identifier=e.identifier,
        name=e.name,
        seq=e.seq,
        document=cat.ref(d),
        newer_revision=cat.newer(d),
        provenance=Provenance.model_validate(e.provenance),
        raw=e.raw,
        imported_at=e.imported_at,
    )
    if e.entry_type == "data_element":
        detail.data_element = DataElementBody.model_validate(e.body)
    elif e.entry_type == "value_domain":
        detail.value_domain = ValueDomainBody.model_validate(e.body)
        detail.codes = [
            StandardCodeRow(
                id=c.id, **CodeRowBody.model_validate(c.body).model_dump(exclude={"raw_cells"})
            )
            for c in session.scalars(
                select(StandardEntry)
                .where(StandardEntry.parent_id == e.id)
                .order_by(StandardEntry.seq)
            )
        ]
    elif e.entry_type == "code_row":
        detail.code_row = CodeRowBody.model_validate(e.body)
    if e.parent_id is not None:
        detail.parent = _row(cat, session.get(StandardEntry, e.parent_id))
    detail.references = [
        resolve(session, cat, r, d)
        for r in session.scalars(
            select(StandardReference)
            .where(StandardReference.from_entry_id == e.id)
            .order_by(StandardReference.id)
        )
    ]
    detail.referenced_by = _incoming(session, cat, e)
    return detail
