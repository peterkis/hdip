"""只读查询。MVP 数据量小（几十个主体/院区），按对象取全量版本后在内存里挑选，代码直白。
数据量上来后再换成按日期过滤的 SQL。"""

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, NotFound
from hdip_api.models import (
    AppUser,
    Campus,
    CampusVersion,
    ChangeRequest,
    Institution,
    InstitutionVersion,
    OperatorRelation,
)
from hdip_api.schemas.items import KIND_LABELS
from hdip_api.schemas.read import (
    CampusDetail,
    CampusRow,
    CampusVersionOut,
    ChangeRequestOut,
    ChangeRequestSummary,
    InstitutionDetail,
    InstitutionRow,
    InstitutionVersionOut,
    ItemOutcome,
    Permissions,
    PrimaryOperator,
    RelationOut,
    UserRef,
)
from hdip_api.services import workflow
from hdip_api.services.apply import dry_run


def covers(valid_from: date, valid_to: date | None, day: date) -> bool:
    return valid_from <= day and (valid_to is None or valid_to >= day)


def _users(s: Session) -> dict[int, UserRef]:
    return {
        u.id: UserRef(id=u.id, username=u.username, display_name=u.display_name)
        for u in s.scalars(select(AppUser))
    }


def _pick(versions: list, day: date):
    """返回 (当天有效版本或最早的计划版本, 是否尚未生效, 之后是否还有版本)。"""
    ordered = sorted(versions, key=lambda v: v.version_no)
    for v in ordered:
        if covers(v.valid_from, v.valid_to, day):
            return v, False, v is not ordered[-1]
    future = [v for v in ordered if v.valid_from > day]
    if future:
        return future[0], True, len(future) > 1
    return None, False, False


def _versions_by(s: Session, model, fk_name: str) -> dict[int, list]:
    grouped: dict[int, list] = defaultdict(list)
    for v in s.scalars(select(model)):
        grouped[getattr(v, fk_name)].append(v)
    return grouped


def _inst_version_out(v: InstitutionVersion, users) -> InstitutionVersionOut:
    return InstitutionVersionOut.model_validate({**_cols(v), "recorded_by": users[v.recorded_by]})


def _campus_version_out(v: CampusVersion, users) -> CampusVersionOut:
    return CampusVersionOut.model_validate({**_cols(v), "recorded_by": users[v.recorded_by]})


def _cols(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns}


# ------------------------------------------------------------------ 主体
def list_institutions(s: Session, as_of: date) -> list[InstitutionRow]:
    users = _users(s)
    versions = _versions_by(s, InstitutionVersion, "institution_id")
    rows = []
    for inst in s.scalars(select(Institution).order_by(Institution.code)):
        v, future, later = _pick(versions[inst.id], as_of)
        if v is None:
            continue
        rows.append(
            InstitutionRow(
                id=inst.id,
                code=inst.code,
                version=_inst_version_out(v, users),
                not_yet_effective=future,
                has_later_versions=later,
            )
        )
    return rows


def get_institution(s: Session, institution_id: int, as_of: date) -> InstitutionDetail:
    inst = s.get(Institution, institution_id)
    if inst is None:
        raise NotFound("主体不存在")
    users = _users(s)
    versions = sorted(
        s.scalars(select(InstitutionVersion).where(InstitutionVersion.institution_id == inst.id)),
        key=lambda v: -v.version_no,
    )
    return InstitutionDetail(
        id=inst.id,
        code=inst.code,
        created_at=inst.created_at,
        created_change_id=inst.created_change_id,
        versions=[_inst_version_out(v, users) for v in versions],
        relations=list_relations(s, as_of, institution_id=inst.id, include_all=True),
    )


# ------------------------------------------------------------------ 院区
def list_campuses(s: Session, as_of: date) -> list[CampusRow]:
    users = _users(s)
    versions = _versions_by(s, CampusVersion, "campus_id")
    primaries = {
        r.campus_id: r for r in list_relations(s, as_of) if r.is_primary and r.effective_on_as_of
    }
    rows = []
    for campus in s.scalars(select(Campus).order_by(Campus.code)):
        v, future, later = _pick(versions[campus.id], as_of)
        if v is None:
            continue
        p = primaries.get(campus.id)
        rows.append(
            CampusRow(
                id=campus.id,
                code=campus.code,
                version=_campus_version_out(v, users),
                not_yet_effective=future,
                has_later_versions=later,
                primary_operator=PrimaryOperator(
                    institution_id=p.institution_id,
                    code=p.institution_code,
                    name=p.institution_name,
                )
                if p
                else None,
            )
        )
    return rows


def get_campus(s: Session, campus_id: int, as_of: date) -> CampusDetail:
    campus = s.get(Campus, campus_id)
    if campus is None:
        raise NotFound("院区不存在")
    users = _users(s)
    versions = sorted(
        s.scalars(select(CampusVersion).where(CampusVersion.campus_id == campus.id)),
        key=lambda v: -v.version_no,
    )
    return CampusDetail(
        id=campus.id,
        code=campus.code,
        created_at=campus.created_at,
        created_change_id=campus.created_change_id,
        versions=[_campus_version_out(v, users) for v in versions],
        relations=list_relations(s, as_of, campus_id=campus.id, include_all=True),
    )


# ------------------------------------------------------------------ 运营关系
def list_relations(
    s: Session,
    as_of: date,
    *,
    institution_id: int | None = None,
    campus_id: int | None = None,
    include_all: bool = False,
) -> list[RelationOut]:
    q = select(OperatorRelation).order_by(
        OperatorRelation.valid_from.desc(), OperatorRelation.id.desc()
    )
    if institution_id is not None:
        q = q.where(OperatorRelation.institution_id == institution_id)
    if campus_id is not None:
        q = q.where(OperatorRelation.campus_id == campus_id)
    inst_v = _versions_by(s, InstitutionVersion, "institution_id")
    campus_v = _versions_by(s, CampusVersion, "campus_id")
    inst_codes = {i.id: i.code for i in s.scalars(select(Institution))}
    campus_codes = {c.id: c.code for c in s.scalars(select(Campus))}

    def name_on(versions: list, day: date) -> str:
        v, _, _ = _pick(versions, day)
        return (v or max(versions, key=lambda x: x.version_no)).name

    out = []
    for r in s.scalars(q):
        effective = covers(r.valid_from, r.valid_to, as_of)
        if not include_all and not effective:
            continue
        out.append(
            RelationOut(
                id=r.id,
                institution_id=r.institution_id,
                institution_code=inst_codes[r.institution_id],
                institution_name=name_on(inst_v[r.institution_id], as_of),
                campus_id=r.campus_id,
                campus_code=campus_codes[r.campus_id],
                campus_name=name_on(campus_v[r.campus_id], as_of),
                relation_type=r.relation_type,
                is_primary=r.is_primary,
                valid_from=r.valid_from,
                valid_to=r.valid_to,
                created_change_id=r.created_change_id,
                closed_change_id=r.closed_change_id,
                effective_on_as_of=effective,
            )
        )
    return out


# ------------------------------------------------------------------ 变更申请
def _labels(cr: ChangeRequest) -> list[str]:
    return [KIND_LABELS.get(i.get("kind"), i.get("kind", "")) for i in cr.items]


def list_changes(s: Session, status: str | None) -> list[ChangeRequestSummary]:
    users = _users(s)
    q = select(ChangeRequest).order_by(ChangeRequest.id.desc())
    if status:
        q = q.where(ChangeRequest.status == status)
    return [
        ChangeRequestSummary(
            id=cr.id,
            status=cr.status,
            note=cr.note,
            item_labels=_labels(cr),
            created_by=users[cr.created_by],
            created_at=cr.created_at,
            submitted_at=cr.submitted_at,
            confirmed_at=cr.confirmed_at,
        )
        for cr in s.scalars(q)
    ]


def get_change(s: Session, change_id: int, user: AppUser) -> ChangeRequestOut:
    cr = s.get(ChangeRequest, change_id)
    if cr is None:
        raise NotFound(f"变更申请 #{change_id} 不存在")
    users = _users(s)
    items = workflow.parse_items(cr)

    outcomes, problems, problem_message = None, [], None
    if cr.status == "confirmed":
        outcomes = cr.results
    elif cr.status in ("draft", "submitted") and items:
        try:
            outcomes = dry_run(s, items, cr.id, user.id)
        except BusinessError as e:
            problems, problem_message = e.problems, e.message

    is_creator = cr.created_by == user.id
    is_maintainer = "maintainer" in user.roles
    block = workflow.confirm_block_reason(s, cr, user)

    def ref(uid: int | None) -> UserRef | None:
        return users[uid] if uid else None

    return ChangeRequestOut(
        id=cr.id,
        status=cr.status,
        note=cr.note,
        items=items,
        item_labels=_labels(cr),
        outcomes=[ItemOutcome.model_validate(o) for o in outcomes] if outcomes else None,
        problems=problems,
        problem_message=problem_message,
        copied_from_id=cr.copied_from_id,
        created_by=users[cr.created_by],
        created_at=cr.created_at,
        updated_at=cr.updated_at,
        submitted_by=ref(cr.submitted_by),
        submitted_at=cr.submitted_at,
        confirmed_by=ref(cr.confirmed_by),
        confirmed_at=cr.confirmed_at,
        returned_by=ref(cr.returned_by),
        returned_at=cr.returned_at,
        return_reason=cr.return_reason,
        cancelled_by=ref(cr.cancelled_by),
        cancelled_at=cr.cancelled_at,
        permissions=Permissions(
            can_edit=cr.status == "draft" and is_creator,
            can_submit=cr.status == "draft" and is_creator and is_maintainer and not problems,
            can_confirm=cr.status == "submitted" and block is None and not problems,
            can_return=workflow.return_block_reason(s, cr, user) is None,
            can_cancel=cr.status in ("draft", "submitted") and is_creator,
            can_copy=cr.status in ("returned", "cancelled") and is_maintainer,
            confirm_hint=block if cr.status == "submitted" else None,
        ),
    )
