"""标准资料库的只读查询：资料目录、条目检索、条目详情（含引用解析与出处）。

引用解析在读取时按本库目录计算，不写回：
- 原文写明年份：同标准号同年份恰有一条 → explicit；没有 → unresolved（其他年份另列，不等价）。
- 原文未写年份：只有一条 → catalog（目录定位，不是原文指定）；多条 → candidates；没有 → unresolved。
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from hdip_api.core.errors import NotFound
from hdip_api.models import SourceDocument, SourcePackage, StandardEntry, StandardReference
from hdip_api.schemas.standards import (
    CodeRowBody,
    DataElementBody,
    DocumentRef,
    IncomingReference,
    PackageOut,
    Provenance,
    ReferenceOut,
    ReferenceTarget,
    StandardCodeRow,
    StandardDocumentDetail,
    StandardDocumentRow,
    StandardEntryDetail,
    StandardEntryRow,
    ValueDomainBody,
)
from hdip_api.services.standards_import import search_text


def _doc_ref(d: SourceDocument) -> DocumentRef:
    return DocumentRef(
        id=d.id,
        standard_no=d.standard_no,
        standard_year=d.standard_year,
        reader_version=d.reader_version,
    )


def _row(e: StandardEntry, d: SourceDocument) -> StandardEntryRow:
    return StandardEntryRow(
        id=e.id,
        entry_type=e.entry_type,
        identifier=e.identifier,
        name=e.name,
        document=_doc_ref(d),
        parent_id=e.parent_id,
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


def _doc_row(d: SourceDocument, p: SourcePackage, counts: dict[str, int]) -> dict:
    return {
        "id": d.id,
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
    }


def list_documents(session: Session) -> list[StandardDocumentRow]:
    counts = _counts(session)
    rows = session.execute(
        select(SourceDocument, SourcePackage)
        .join(SourcePackage, SourcePackage.id == SourceDocument.package_id)
        .order_by(SourceDocument.standard_no, SourceDocument.standard_year, SourceDocument.id)
    ).all()
    return [StandardDocumentRow(**_doc_row(d, p, counts.get(d.id, {}))) for d, p in rows]


def get_document(session: Session, doc_id: int) -> StandardDocumentDetail:
    hit = session.execute(
        select(SourceDocument, SourcePackage)
        .join(SourcePackage, SourcePackage.id == SourceDocument.package_id)
        .where(SourceDocument.id == doc_id)
    ).first()
    if hit is None:
        raise NotFound("找不到这份标准资料")
    d, p = hit
    return StandardDocumentDetail(
        **_doc_row(d, p, _counts(session).get(d.id, {})),
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
    )


def search_entries(
    session: Session,
    q: str | None,
    entry_type: str | None,
    document_id: int | None,
    limit: int,
) -> list[StandardEntryRow]:
    stmt = select(StandardEntry, SourceDocument).join(
        SourceDocument, SourceDocument.id == StandardEntry.document_id
    )
    if entry_type:
        stmt = stmt.where(StandardEntry.entry_type == entry_type)
    if document_id:
        stmt = stmt.where(StandardEntry.document_id == document_id)
    if q and (needle := search_text(q)):
        like = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(
            or_(
                StandardEntry.search_text.like(like),
                func.lower(StandardEntry.identifier) == needle,
            )
        )
    stmt = stmt.order_by(
        SourceDocument.standard_no,
        SourceDocument.standard_year,
        StandardEntry.entry_type,
        StandardEntry.seq,
    ).limit(limit)
    return [_row(e, d) for e, d in session.execute(stmt)]


def _norm_std(s: str) -> str:
    return "".join(s.split()).upper()


def _targets(
    session: Session, ref: StandardReference
) -> list[tuple[StandardEntry, SourceDocument]]:
    if not ref.target_identifier:
        return []
    rows = session.execute(
        select(StandardEntry, SourceDocument)
        .join(SourceDocument, SourceDocument.id == StandardEntry.document_id)
        .where(
            StandardEntry.entry_type == "value_domain",
            StandardEntry.identifier == ref.target_identifier,
        )
        .order_by(SourceDocument.standard_year, SourceDocument.id)
    ).all()
    want = _norm_std(ref.target_standard)
    return [(e, d) for e, d in rows if _norm_std(d.standard_no) == want]


def _target(e: StandardEntry, d: SourceDocument) -> ReferenceTarget:
    return ReferenceTarget(
        entry_id=e.id, identifier=e.identifier, name=e.name, document=_doc_ref(d)
    )


def resolve(session: Session, ref: StandardReference) -> ReferenceOut:
    hits = _targets(session, ref)
    other: list[tuple[StandardEntry, SourceDocument]] = []
    if ref.target_year:
        same = [(e, d) for e, d in hits if d.standard_year == ref.target_year]
        other = [(e, d) for e, d in hits if d.standard_year != ref.target_year]
        hits = same
        resolution = "explicit" if len(hits) == 1 else "candidates" if hits else "unresolved"
    else:
        resolution = "catalog" if len(hits) == 1 else "candidates" if hits else "unresolved"
    return ReferenceOut(
        field=ref.field,
        ref_kind=ref.ref_kind,
        raw_text=ref.raw_text,
        target_standard=ref.target_standard,
        target_year=ref.target_year,
        target_identifier=ref.target_identifier,
        target_label=ref.target_label,
        resolution=resolution,
        targets=[_target(e, d) for e, d in hits],
        other_versions=[_target(e, d) for e, d in other],
    )


def _incoming(session: Session, e: StandardEntry, d: SourceDocument) -> list[IncomingReference]:
    if e.entry_type != "value_domain" or not e.identifier:
        return []
    src, src_doc = aliased(StandardEntry), aliased(SourceDocument)
    rows = session.execute(
        select(StandardReference, src, src_doc)
        .join(src, src.id == StandardReference.from_entry_id)
        .join(src_doc, src_doc.id == src.document_id)
        .where(StandardReference.target_identifier == e.identifier)
        .order_by(src_doc.standard_no, src.seq)
    ).all()
    out = []
    for ref, se, sd in rows:
        r = resolve(session, ref)
        if any(t.entry_id == e.id for t in r.targets):
            out.append(
                IncomingReference(
                    entry=_row(se, sd), raw_text=ref.raw_text, resolution=r.resolution
                )
            )
    return out


def get_entry(session: Session, entry_id: int) -> StandardEntryDetail:
    hit = session.execute(
        select(StandardEntry, SourceDocument)
        .join(SourceDocument, SourceDocument.id == StandardEntry.document_id)
        .where(StandardEntry.id == entry_id)
    ).first()
    if hit is None:
        raise NotFound("找不到这个标准条目")
    e, d = hit
    detail = StandardEntryDetail(
        id=e.id,
        entry_type=e.entry_type,
        source_key=e.source_key,
        identifier=e.identifier,
        name=e.name,
        seq=e.seq,
        document=_doc_ref(d),
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
        parent = session.get(StandardEntry, e.parent_id)
        detail.parent = _row(parent, d)
    detail.references = [
        resolve(session, r)
        for r in session.scalars(
            select(StandardReference)
            .where(StandardReference.from_entry_id == e.id)
            .order_by(StandardReference.id)
        )
    ]
    detail.referenced_by = _incoming(session, e, d)
    return detail
