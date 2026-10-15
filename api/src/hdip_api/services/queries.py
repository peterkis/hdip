"""只读查询。MVP 数据量小（几十个主体/院区），按对象取全量版本后在内存里挑选，代码直白。
数据量上来后再换成按日期过滤的 SQL。"""

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, NotFound
from hdip_api.core.permissions import CHANGE_CREATE, has_permission
from hdip_api.models import (
    AppUser,
    Campus,
    CampusVersion,
    ChangeRequest,
    ClassificationCode,
    ClassificationScheme,
    Department,
    DepartmentAlias,
    DepartmentClassification,
    DepartmentInstitution,
    DepartmentVersion,
    Institution,
    InstitutionVersion,
    OperatorRelation,
    OrgView,
    ServiceUnit,
    ServiceUnitLineage,
    ServiceUnitVersion,
)
from hdip_api.schemas.items import KIND_LABELS
from hdip_api.schemas.read import (
    CampusDetail,
    CampusRow,
    CampusVersionOut,
    ChangeRequestOut,
    ChangeRequestSummary,
    ClassificationCodeOut,
    ClassificationSchemeOut,
    ClassRef,
    DepartmentAffiliationOut,
    DepartmentAliasOut,
    DepartmentClassificationOut,
    DepartmentDetail,
    DepartmentRow,
    DepartmentVersionOut,
    InstitutionDetail,
    InstitutionRow,
    InstitutionVersionOut,
    ItemOutcome,
    LineageOut,
    OrgViewOut,
    Permissions,
    PrimaryOperator,
    RelationOut,
    ServiceUnitDetail,
    ServiceUnitRow,
    ServiceUnitVersionOut,
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


def _name_on(versions: list, day: date) -> str:
    """查看日期当天的名称；当天没有版本时取最早的计划版本或最新版本。"""
    v, _, _ = _pick(versions, day)
    return (v or max(versions, key=lambda x: x.version_no)).name


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
                institution_name=_name_on(inst_v[r.institution_id], as_of),
                campus_id=r.campus_id,
                campus_code=campus_codes[r.campus_id],
                campus_name=_name_on(campus_v[r.campus_id], as_of),
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


# ------------------------------------------------------------------ 服务单元
class _UnitNames:
    """一次查询里把部门、院区、主体的代码与名称备齐（数据量小，取全量）。"""

    def __init__(self, s: Session, as_of: date) -> None:
        self.as_of = as_of
        self.users = _users(s)
        self.departments = {d.id: d for d in s.scalars(select(Department))}
        self.dept_v = _versions_by(s, DepartmentVersion, "department_id")
        self.campus_codes = {c.id: c.code for c in s.scalars(select(Campus))}
        self.inst_codes = {i.id: i.code for i in s.scalars(select(Institution))}
        self.campus_v = _versions_by(s, CampusVersion, "campus_id")
        self.inst_v = _versions_by(s, InstitutionVersion, "institution_id")

    def version_out(self, v: ServiceUnitVersion) -> ServiceUnitVersionOut:
        d = self.departments[v.department_id]
        dv, _, _ = _pick(self.dept_v[d.id], self.as_of)
        dv = dv or max(self.dept_v[d.id], key=lambda x: x.version_no)
        return ServiceUnitVersionOut.model_validate(
            {
                **_cols(v),
                "recorded_by": self.users[v.recorded_by],
                "department_code": d.code,
                "department_name": dv.name,
                "department_lifecycle": dv.lifecycle,
                "campus_code": self.campus_codes[v.campus_id],
                "campus_name": _name_on(self.campus_v[v.campus_id], self.as_of),
                "institution_code": self.inst_codes[v.institution_id],
                "institution_name": _name_on(self.inst_v[v.institution_id], self.as_of),
            }
        )


def list_service_units(
    s: Session,
    as_of: date,
    *,
    campus_id: int | None = None,
    department_id: int | None = None,
    institution_id: int | None = None,
    include_future: bool = True,
) -> list[ServiceUnitRow]:
    names = _UnitNames(s, as_of)
    versions = _versions_by(s, ServiceUnitVersion, "service_unit_id")
    rows = []
    for unit in s.scalars(select(ServiceUnit).order_by(ServiceUnit.code)):
        v, future, later = _pick(versions[unit.id], as_of)
        if v is None or (future and not include_future):
            continue
        if campus_id is not None and v.campus_id != campus_id:
            continue
        if department_id is not None and v.department_id != department_id:
            continue
        if institution_id is not None and v.institution_id != institution_id:
            continue
        rows.append(
            ServiceUnitRow(
                id=unit.id,
                code=unit.code,
                unit_type=unit.unit_type,
                version=names.version_out(v),
                not_yet_effective=future,
                has_later_versions=later,
            )
        )
    return rows


def get_service_unit(s: Session, unit_id: int, as_of: date) -> ServiceUnitDetail:
    unit = s.get(ServiceUnit, unit_id)
    if unit is None:
        raise NotFound("服务单元不存在")
    names = _UnitNames(s, as_of)
    versions = sorted(
        s.scalars(select(ServiceUnitVersion).where(ServiceUnitVersion.service_unit_id == unit.id)),
        key=lambda v: -v.version_no,
    )
    return ServiceUnitDetail(
        id=unit.id,
        code=unit.code,
        unit_type=unit.unit_type,
        created_at=unit.created_at,
        created_change_id=unit.created_change_id,
        retired_after=versions[0].valid_to,
        versions=[names.version_out(v) for v in versions],
        predecessors=list_lineage(s, successor_id=unit.id),
        successors=list_lineage(s, predecessor_id=unit.id),
    )


def list_lineage(
    s: Session,
    *,
    predecessor_id: int | None = None,
    successor_id: int | None = None,
    until: date | None = None,
) -> list[LineageOut]:
    """演变关系；until 给出时只含该日及之前生效的。"""
    q = select(ServiceUnitLineage).order_by(
        ServiceUnitLineage.effective_date, ServiceUnitLineage.id
    )
    if predecessor_id is not None:
        q = q.where(ServiceUnitLineage.predecessor_id == predecessor_id)
    if successor_id is not None:
        q = q.where(ServiceUnitLineage.successor_id == successor_id)
    if until is not None:
        q = q.where(ServiceUnitLineage.effective_date <= until)
    rows = s.scalars(q).all()
    if not rows:
        return []
    codes = {u.id: u.code for u in s.scalars(select(ServiceUnit))}
    versions = _versions_by(s, ServiceUnitVersion, "service_unit_id")

    def name(unit_id: int, last: bool) -> str:
        ordered = sorted(versions[unit_id], key=lambda v: v.version_no)
        return (ordered[-1] if last else ordered[0]).name

    return [
        LineageOut(
            id=r.id,
            lineage_type=r.lineage_type,
            effective_date=r.effective_date,
            change_id=r.change_id,
            predecessor_id=r.predecessor_id,
            predecessor_code=codes[r.predecessor_id],
            predecessor_name=name(r.predecessor_id, last=True),
            successor_id=r.successor_id,
            successor_code=codes[r.successor_id],
            successor_name=name(r.successor_id, last=False),
        )
        for r in rows
    ]


# ------------------------------------------------------------------ 部门
MAIN_SCHEME = "DEPT_MAIN_CLASS"


class _ClassNames:
    """分类方案与代码的名称（配置，量小，取全量）。"""

    def __init__(self, s: Session) -> None:
        self.schemes = {x.id: x for x in s.scalars(select(ClassificationScheme))}
        self.codes = {(c.scheme_id, c.code): c.name for c in s.scalars(select(ClassificationCode))}

    def ref(self, scheme_id: int, code: str) -> ClassRef:
        sc = self.schemes[scheme_id]
        return ClassRef(
            scheme_code=sc.code, scheme_name=sc.name, code=code, name=self.codes[(scheme_id, code)]
        )


def _dept_version_out(v: DepartmentVersion, users) -> DepartmentVersionOut:
    return DepartmentVersionOut.model_validate({**_cols(v), "recorded_by": users[v.recorded_by]})


def _rows_on(rows: list, day: date):
    return [r for r in rows if covers(r.valid_from, r.valid_to, day)]


def list_departments(s: Session, as_of: date, q: str | None = None) -> list[DepartmentRow]:
    """全部部门（含尚未设立的计划部门，以 not_yet_effective 标出）。

    q：按管理编码、任一版本的名称（含曾用名）、别名模糊匹配。
    """
    users = _users(s)
    versions = _versions_by(s, DepartmentVersion, "department_id")
    names = _ClassNames(s)
    main = next((x.id for x in names.schemes.values() if x.code == MAIN_SCHEME), None)
    classes = _versions_by(s, DepartmentClassification, "department_id")
    affiliations = _versions_by(s, DepartmentInstitution, "department_id")
    aliases = _versions_by(s, DepartmentAlias, "department_id")
    inst_v = _versions_by(s, InstitutionVersion, "institution_id")
    counts: dict[int, int] = defaultdict(int)
    for row in list_service_units(s, as_of, include_future=False):
        counts[row.version.department_id] += 1
    needle = (q or "").strip().lower()

    out = []
    for d in s.scalars(select(Department).order_by(Department.code)):
        if needle and not (
            needle in d.code.lower()
            or any(needle in v.name.lower() for v in versions[d.id])
            or any(needle in a.value.lower() for a in aliases[d.id])
        ):
            continue
        v, future, later = _pick(versions[d.id], as_of)
        if v is None:
            continue
        c = next((x for x in _rows_on(classes[d.id], as_of) if x.scheme_id == main), None)
        a = next((x for x in _rows_on(affiliations[d.id], as_of) if x.is_primary), None)
        out.append(
            DepartmentRow(
                id=d.id,
                code=d.code,
                version=_dept_version_out(v, users),
                not_yet_effective=future,
                has_later_versions=later,
                main_class=names.ref(c.scheme_id, c.code) if c else None,
                institution_name=_name_on(inst_v[a.institution_id], as_of) if a else None,
                unit_count=counts[d.id],
            )
        )
    return out


def get_department(s: Session, department_id: int, as_of: date) -> DepartmentDetail:
    d = s.get(Department, department_id)
    if d is None:
        raise NotFound("部门不存在")
    users = _users(s)
    names = _ClassNames(s)
    versions = sorted(
        s.scalars(select(DepartmentVersion).where(DepartmentVersion.department_id == d.id)),
        key=lambda v: -v.version_no,
    )
    classes = s.scalars(
        select(DepartmentClassification)
        .where(DepartmentClassification.department_id == d.id)
        .order_by(DepartmentClassification.valid_from.desc())
    ).all()
    affiliations = s.scalars(
        select(DepartmentInstitution)
        .where(DepartmentInstitution.department_id == d.id)
        .order_by(DepartmentInstitution.valid_from.desc())
    ).all()
    aliases = s.scalars(
        select(DepartmentAlias)
        .where(DepartmentAlias.department_id == d.id)
        .order_by(DepartmentAlias.valid_from.desc())
    ).all()
    inst_codes = {i.id: i.code for i in s.scalars(select(Institution))}
    inst_v = _versions_by(s, InstitutionVersion, "institution_id")

    related = {d.created_change_id, *(v.change_id for v in versions)}
    for rows in (classes, affiliations, aliases):
        for r in rows:
            related.add(r.change_id)
            if r.closed_change_id:
                related.add(r.closed_change_id)
    change_ids = sorted(
        (
            cr_id
            for cr_id in related
            if s.scalar(select(ChangeRequest.status).where(ChangeRequest.id == cr_id))
            == "confirmed"
        ),
        reverse=True,
    )
    return DepartmentDetail(
        id=d.id,
        code=d.code,
        created_at=d.created_at,
        created_change_id=d.created_change_id,
        versions=[_dept_version_out(v, users) for v in versions],
        classifications=[
            DepartmentClassificationOut(
                **names.ref(c.scheme_id, c.code).model_dump(),
                id=c.id,
                valid_from=c.valid_from,
                valid_to=c.valid_to,
                change_id=c.change_id,
                closed_change_id=c.closed_change_id,
            )
            for c in classes
        ],
        affiliations=[
            DepartmentAffiliationOut(
                id=a.id,
                institution_id=a.institution_id,
                institution_code=inst_codes[a.institution_id],
                institution_name=_name_on(inst_v[a.institution_id], as_of),
                is_primary=a.is_primary,
                valid_from=a.valid_from,
                valid_to=a.valid_to,
                change_id=a.change_id,
            )
            for a in affiliations
        ],
        aliases=[
            DepartmentAliasOut(
                id=a.id,
                kind=a.kind,
                value=a.value,
                valid_from=a.valid_from,
                valid_to=a.valid_to,
                change_id=a.change_id,
            )
            for a in aliases
        ],
        units=list_service_units(s, as_of, department_id=d.id),
        change_ids=change_ids,
    )


# ------------------------------------------------------------------ 分类字典与组织视图
def list_classification_schemes(s: Session) -> list[ClassificationSchemeOut]:
    users = _users(s)
    codes: dict[int, list[ClassificationCode]] = defaultdict(list)
    for c in s.scalars(select(ClassificationCode).order_by(ClassificationCode.sort_order)):
        codes[c.scheme_id].append(c)
    return [
        ClassificationSchemeOut(
            id=sc.id,
            code=sc.code,
            name=sc.name,
            version=sc.version,
            purpose=sc.purpose,
            is_exclusive=sc.is_exclusive,
            is_active=sc.is_active,
            codes=[
                ClassificationCodeOut(
                    id=c.id,
                    code=c.code,
                    name=c.name,
                    criterion=c.criterion,
                    caution=c.caution,
                    sort_order=c.sort_order,
                    is_active=c.is_active,
                    updated_at=c.updated_at,
                    updated_by=users.get(c.updated_by) if c.updated_by else None,
                )
                for c in codes[sc.id]
            ],
        )
        for sc in s.scalars(select(ClassificationScheme).order_by(ClassificationScheme.id))
    ]


def list_org_views(s: Session) -> list[OrgViewOut]:
    return [
        OrgViewOut(code=v.code, name=v.name, purpose=v.purpose, status=v.status)
        for v in s.scalars(select(OrgView).order_by(OrgView.sort_order))
    ]


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
    is_maintainer = has_permission(user, CHANGE_CREATE)
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
