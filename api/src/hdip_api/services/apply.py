"""把变更项应用到业务表。

同一套代码既用于“预演”（提交前校验、确认页差异，用 SAVEPOINT 执行后回滚），
也用于“确认”（在确认事务里真正写入）。任何一项失败，整张申请都不成立。

校验分两层：这里先做能给出清楚中文提示的业务校验；最终以数据库约束为准，
数据库拒绝时把约束名翻译成中文（见 CONSTRAINT_MESSAGES）。
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, ProblemItem
from hdip_api.models import (
    Campus,
    CampusVersion,
    ClassificationCode,
    ClassificationScheme,
    CodeNamespace,
    Department,
    DepartmentAlias,
    DepartmentChangeEvent,
    DepartmentChangeParticipant,
    DepartmentClassification,
    DepartmentHierarchy,
    DepartmentInstitution,
    DepartmentRelation,
    DepartmentVersion,
    ExternalCode,
    ExternalCodeAssignment,
    Institution,
    InstitutionVersion,
    OperatorRelation,
    OptionItem,
    OrgView,
    ServiceUnit,
    ServiceUnitClassification,
    ServiceUnitLineage,
    ServiceUnitVersion,
    SourceSystem,
)
from hdip_api.schemas.items import (
    KIND_LABELS,
    OPERATING_STATUS_ORDER,
    REORG_LABELS,
    CampusChangeStatus,
    CampusCreate,
    CampusRevise,
    ChangeItem,
    DepartmentAffiliate,
    DepartmentAliasAdd,
    DepartmentAliasClose,
    DepartmentChangeLifecycle,
    DepartmentChangeStatus,
    DepartmentClassificationClose,
    DepartmentClassify,
    DepartmentCreate,
    DepartmentRelationClose,
    DepartmentRelationCreate,
    DepartmentRename,
    DepartmentReorganize,
    DepartmentRevise,
    DepartmentSetParent,
    ExternalCodeAssign,
    ExternalCodeAssignmentClose,
    ExternalCodeRegister,
    InstitutionCreate,
    InstitutionRevise,
    OperatorRelationClose,
    OperatorRelationCreate,
    ServiceUnitChangeDepartment,
    ServiceUnitChangeStatus,
    ServiceUnitClassificationClose,
    ServiceUnitClassify,
    ServiceUnitCreate,
    ServiceUnitFields,
    ServiceUnitMerge,
    ServiceUnitRebind,
    ServiceUnitRetire,
    ServiceUnitRevise,
    ServiceUnitSplit,
)

STATUS_LABELS = {
    "PLANNING": "筹建",
    "TRIAL_RUNNING": "试运行",
    "RUNNING": "运行",
    "SUSPENDED": "停用",
}
RELATION_LABELS = {"OPERATE": "运营", "REGISTER": "登记", "MANAGE": "管理", "CHARGE": "收费"}
UNIT_STATUS_LABELS = {"ACTIVE": "在用", "SUSPENDED": "暂停"}
LIFECYCLE_LABELS = {
    "PREPARING": "筹备",
    "ACTIVE": "正式履职",
    "SUSPENDED": "暂停履职",
    "REVOKED": "撤销",
    "SUPERSEDED": "被替代",
}
# 组织生命周期的合法变化：筹备 → 正式履职 ⇄ 暂停履职 → 撤销；被替代只由将来的部门拆并产生
LIFECYCLE_NEXT = {
    "PREPARING": {"ACTIVE", "REVOKED"},
    "ACTIVE": {"SUSPENDED", "REVOKED"},
    "SUSPENDED": {"ACTIVE", "REVOKED"},
}
LIFECYCLE_TERMINAL = {"REVOKED", "SUPERSEDED"}

CONSTRAINT_MESSAGES: dict[str, str] = {
    "institution_code_uniq": "主体代码已被使用（含已退出对象），代码永不复用",
    "campus_code_uniq": "院区代码已被使用（含已停用院区），代码永不复用",
    "institution_code_check": "代码只能包含字母、数字、点、下划线、短横线，且以字母或数字开头",
    "campus_code_check": "代码只能包含字母、数字、点、下划线、短横线，且以字母或数字开头",
    "institution_version_no_overlap": "与该主体已有版本的期间重叠",
    "campus_version_no_overlap": "与该院区已有版本的期间重叠",
    "institution_version_license_check": "许可证有效期止不能早于起",
    "operator_relation_primary_excl": "该院区在这段期间已有主要运营方，须先关闭原主要运营关系",
    "operator_relation_dup_excl": "该主体与该院区在这段期间已有同类型关系",
    "operator_relation_primary_operate_check": "只有“运营”类型的关系可以作为主要运营方",
    "operator_relation_period_check": "结束日不能早于开始日",
    "hdip_history_immutable": "历史记录不可修改",
    "department_code_uniq": "部门代码已被使用（含已撤销部门），代码永不复用",
    "department_version_no_overlap": "与该部门已有版本的期间重叠",
    "department_version_temporary_check": "经批准的临时部门必须填期限；常设部门不填期限",
    "department_version_name_check": "部门名称不能为空",
    "campus_version_public_name_check": "对外名称不能是空白；不需要时不填",
    "department_alias_dup_excl": "该部门在这段期间已有相同的别名",
    "department_classification_exclusive_excl": "该部门在这段期间已有主分类，同一时点只能有一个",
    "department_classification_dup_excl": "该部门在这段期间已有相同的分类",
    "department_classification_code_fk": "分类代码不在该方案中",
    "department_institution_primary_excl": "该部门在这段期间已有主归属主体",
    "department_hierarchy_single_parent_excl": "该部门在这段期间已有直接上级，同一时点只能有一个",
    "department_hierarchy_self_check": "部门不能以自己为上级",
    "department_relation_dup_excl": "这段期间已有相同的部门关系",
    "department_relation_target_check": "院区管理须指明院区；专业管理、协作须指明另一个部门",
    "department_code_check": "代码只能包含字母、数字、点、下划线、短横线，且以字母或数字开头",
    "service_unit_code_uniq": "服务单元代码已被使用（含已退出单元），代码永不复用",
    "service_unit_code_check": "代码只能包含字母、数字、点、下划线、短横线，且以字母或数字开头",
    "service_unit_type_check": "单元类型不在既有码值范围内",
    "service_unit_version_no_overlap": "与该服务单元已有版本的期间重叠",
    "service_unit_lineage_pair_uniq": "这两个单元之间已有演变关系",
    "service_unit_lineage_self_check": "前身与后继不能是同一个单元",
    "service_unit_classification_exclusive_excl": (
        "该服务单元在这段期间已有该方案的分类，同一时点只能有一个"
    ),
    "service_unit_classification_dup_excl": "该服务单元在这段期间已有相同的分类",
    "service_unit_classification_code_fk": "分类代码不在该方案中",
    "external_code_uniq": "该字典里已登记过这个代码",
    "external_code_assignment_single_excl": (
        "该代码在这段期间、同一院区条件下已有解释，同一时点只能有一个"
    ),
    "external_code_assignment_target_check": "解释须指向且只指向一个对象",
    "external_code_assignment_period_check": "结束日不能早于开始日",
}


class ItemError(Exception):
    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.field = field


@dataclass
class Ctx:
    session: Session
    change_id: int
    user_id: int
    index: int = 0
    # 应用完全部变更项后统一校验服务单元的依赖（见 _check_units）：
    # 本申请新写的单元版本 id → 项序号；本申请影响到的院区 id → 项序号
    new_unit_versions: dict[int, int] = field(default_factory=dict)
    touched_campuses: dict[int, int] = field(default_factory=dict)
    # 生命周期变为非“正式履职”的部门 id → 项序号（依赖它的单元要重新校验）
    touched_departments: dict[int, int] = field(default_factory=dict)
    # 调整过上下级的组织视图 id → 项序号（检查成环）
    touched_views: dict[int, int] = field(default_factory=dict)
    # 被撤销 / 被替代的部门 id → (项序号, 生效日)（检查是否还有下级部门）
    ended_departments: dict[int, tuple[int, date]] = field(default_factory=dict)
    # 新增过解释的源记录 id → 项序号（检查院区条件是否一致）
    touched_codes: dict[int, int] = field(default_factory=dict)


def _json(value: Any) -> Any:
    if isinstance(value, date | datetime):
        return value.isoformat()
    return value


def version_snapshot(v: InstitutionVersion | CampusVersion | DepartmentVersion) -> dict[str, Any]:
    keys = ("version_no", "valid_from", "valid_to", *v.CONTENT)
    return {k: _json(getattr(v, k)) for k in keys}


def relation_snapshot(r: OperatorRelation) -> dict[str, Any]:
    keys = ("id", "relation_type", "is_primary", "valid_from", "valid_to")
    return {k: _json(getattr(r, k)) for k in keys}


# ------------------------------------------------------------------ 查找
def _institution(s: Session, code: str) -> Institution:
    obj = s.scalar(select(Institution).where(Institution.code == code))
    if obj is None:
        raise ItemError(f"主体代码 {code} 不存在", "code")
    return obj


def _campus(s: Session, code: str) -> Campus:
    obj = s.scalar(select(Campus).where(Campus.code == code))
    if obj is None:
        raise ItemError(f"院区代码 {code} 不存在", "code")
    return obj


def _latest(s: Session, model, fk, obj_id: int):
    return s.scalar(
        select(model)
        .where(fk == obj_id)
        .order_by(model.version_no.desc())
        .limit(1)
        .with_for_update()
    )


def _version_on(s: Session, model, fk, obj_id: int, day: date):
    return s.scalar(
        select(model).where(
            fk == obj_id,
            model.valid_from <= day,
            (model.valid_to.is_(None)) | (model.valid_to >= day),
        )
    )


def _check_option(s: Session, category: str, code: str | None, field: str) -> None:
    if code is None:
        return
    ok = s.scalar(
        select(OptionItem.id).where(
            OptionItem.category == category, OptionItem.code == code, OptionItem.is_active
        )
    )
    if ok is None:
        raise ItemError(f"选项 {code} 不在可选范围内", field)


def is_void(v) -> bool:
    """生效前已被更正的版本：期间为空（结束日 = 开始日前一日），从未生效。"""
    return v.valid_to is not None and v.valid_to < v.valid_from


def _next_version(ctx: Ctx, model, fk_name: str, obj_id: int, latest, day: date, content: dict):
    """修订在 day 生效：旧版结束日 = day 前一日，新版从 day 开始（闭区间）。

    最新版本尚未生效（开始日晚于今天）时，可以在它的开始日当天修订 = 更正：
    旧版结束日为开始日前一日（空期间，从未生效，记录保留），新版自同一天起。
    """
    if latest.valid_to is not None:
        raise ItemError("当前版本已结束，不能修订")
    correcting = day == latest.valid_from and latest.valid_from > _today(ctx.session)
    if day < latest.valid_from or (day == latest.valid_from and not correcting):
        raise ItemError(
            f"生效日须晚于当前版本的开始日 {latest.valid_from.isoformat()}"
            "（尚未生效的版本可在开始日当天更正）",
            "effective_date",
        )
    old = {k: getattr(latest, k) for k in model.CONTENT}
    if old == content:
        raise ItemError("内容没有变化")
    latest.valid_to = day - timedelta(days=1)
    ctx.session.flush()
    new = model(
        **{fk_name: obj_id},
        version_no=latest.version_no + 1,
        valid_from=day,
        valid_to=None,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        **content,
    )
    ctx.session.add(new)
    ctx.session.flush()
    return new


# ------------------------------------------------------------------ 处理各类变更
def _institution_create(ctx: Ctx, item: InstitutionCreate) -> dict:
    s = ctx.session
    if s.scalar(select(Institution.id).where(Institution.code == item.code)):
        raise ItemError(f"主体代码 {item.code} 已被使用，代码永不复用", "code")
    obj = Institution(code=item.code, created_change_id=ctx.change_id)
    s.add(obj)
    s.flush()
    v = InstitutionVersion(
        institution_id=obj.id,
        version_no=1,
        valid_from=item.valid_from,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        **item.fields.model_dump(),
    )
    s.add(v)
    s.flush()
    return {"target": f"主体 {item.code} {v.name}", "before": None, "after": version_snapshot(v)}


def _institution_revise(ctx: Ctx, item: InstitutionRevise) -> dict:
    s = ctx.session
    obj = _institution(s, item.code)
    latest = _latest(s, InstitutionVersion, InstitutionVersion.institution_id, obj.id)
    before = version_snapshot(latest)
    content = {k: getattr(latest, k) for k in InstitutionVersion.CONTENT}
    content |= item.changes.model_dump(exclude_unset=True)
    new = _next_version(
        ctx, InstitutionVersion, "institution_id", obj.id, latest, item.effective_date, content
    )
    return {
        "target": f"主体 {obj.code} {new.name}",
        "before": before,
        "after": version_snapshot(new),
    }


def _campus_create(ctx: Ctx, item: CampusCreate) -> dict:
    s = ctx.session
    if s.scalar(select(Campus.id).where(Campus.code == item.code)):
        raise ItemError(f"院区代码 {item.code} 已被使用，代码永不复用", "code")
    _check_option(s, "campus_node_role", item.fields.node_role, "fields.node_role")
    obj = Campus(code=item.code, created_change_id=ctx.change_id)
    s.add(obj)
    s.flush()
    v = CampusVersion(
        campus_id=obj.id,
        version_no=1,
        valid_from=item.valid_from,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        operating_status=item.operating_status,
        **item.fields.model_dump(),
    )
    s.add(v)
    s.flush()
    return {"target": f"院区 {item.code} {v.name}", "before": None, "after": version_snapshot(v)}


def _campus_revise(ctx: Ctx, item: CampusRevise) -> dict:
    s = ctx.session
    obj = _campus(s, item.code)
    patch = item.changes.model_dump(exclude_unset=True)
    _check_option(s, "campus_node_role", patch.get("node_role"), "changes.node_role")
    latest = _latest(s, CampusVersion, CampusVersion.campus_id, obj.id)
    before = version_snapshot(latest)
    content = {k: getattr(latest, k) for k in CampusVersion.CONTENT} | patch
    new = _next_version(
        ctx, CampusVersion, "campus_id", obj.id, latest, item.effective_date, content
    )
    return {
        "target": f"院区 {obj.code} {new.name}",
        "before": before,
        "after": version_snapshot(new),
    }


def _campus_change_status(ctx: Ctx, item: CampusChangeStatus) -> dict:
    s = ctx.session
    obj = _campus(s, item.code)
    latest = _latest(s, CampusVersion, CampusVersion.campus_id, obj.id)
    old, new_status = latest.operating_status, item.operating_status
    if old == "SUSPENDED":
        raise ItemError("院区已停用，不能再变更运营状态", "operating_status")
    if OPERATING_STATUS_ORDER[new_status] <= OPERATING_STATUS_ORDER[old]:
        raise ItemError(
            f"运营状态只能按 筹建 → 试运行 → 运行 → 停用 推进，当前为{STATUS_LABELS[old]}",
            "operating_status",
        )
    # 停用后若仍有单元依赖该院区，由 _check_units 阻止并列出（设计文档第 5 节阻止规则）
    if new_status == "SUSPENDED":
        ctx.touched_campuses[obj.id] = ctx.index
    before = version_snapshot(latest)
    content = {k: getattr(latest, k) for k in CampusVersion.CONTENT}
    content["operating_status"] = new_status
    new = _next_version(
        ctx, CampusVersion, "campus_id", obj.id, latest, item.effective_date, content
    )
    return {
        "target": f"院区 {obj.code} {new.name}",
        "before": before,
        "after": version_snapshot(new),
    }


def _relation_create(ctx: Ctx, item: OperatorRelationCreate) -> dict:
    s = ctx.session
    try:
        inst = _institution(s, item.institution_code)
    except ItemError as e:
        raise ItemError(e.message, "institution_code") from None
    try:
        campus = _campus(s, item.campus_code)
    except ItemError as e:
        raise ItemError(e.message, "campus_code") from None
    if item.is_primary and item.relation_type != "OPERATE":
        raise ItemError("只有“运营”类型的关系可以作为主要运营方", "is_primary")
    if item.valid_to is not None and item.valid_to < item.valid_from:
        raise ItemError("结束日不能早于开始日", "valid_to")

    inst_v = _version_on(
        s, InstitutionVersion, InstitutionVersion.institution_id, inst.id, item.valid_from
    )
    if inst_v is None:
        raise ItemError(
            _not_started(s, InstitutionVersion, "institution_id", inst, "主体", "关系"),
            "valid_from",
        )
    campus_v = _version_on(s, CampusVersion, CampusVersion.campus_id, campus.id, item.valid_from)
    if campus_v is None:
        raise ItemError(
            _not_started(s, CampusVersion, "campus_id", campus, "院区", "关系"), "valid_from"
        )
    if campus_v.operating_status == "SUSPENDED":
        raise ItemError(f"院区 {campus.code} 在 {item.valid_from} 已停用", "valid_from")

    rel = OperatorRelation(
        institution_id=inst.id,
        campus_id=campus.id,
        relation_type=item.relation_type,
        is_primary=item.is_primary,
        valid_from=item.valid_from,
        valid_to=item.valid_to,
        created_change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(rel)
    s.flush()
    kind = RELATION_LABELS[item.relation_type] + ("（主要）" if item.is_primary else "")
    return {
        "target": f"{inst_v.name} —{kind}→ {campus_v.name}",
        "before": None,
        "after": relation_snapshot(rel),
    }


def _relation_close(ctx: Ctx, item: OperatorRelationClose) -> dict:
    s = ctx.session
    rel = s.get(OperatorRelation, item.relation_id, with_for_update=True)
    if rel is None:
        raise ItemError(f"运营关系 #{item.relation_id} 不存在", "relation_id")
    if rel.valid_to is not None:
        raise ItemError(f"该关系已于 {rel.valid_to.isoformat()} 结束", "relation_id")
    if item.valid_to < rel.valid_from:
        raise ItemError(f"结束日不能早于开始日 {rel.valid_from.isoformat()}", "valid_to")
    # 关闭后若仍有单元依赖该关系，由 _check_units 阻止并列出（设计文档第 5 节阻止规则）
    if rel.relation_type == "OPERATE":
        ctx.touched_campuses[rel.campus_id] = ctx.index
    before = relation_snapshot(rel)
    now = s.scalar(select(func.localtimestamp()))
    # 结束日与关闭信息须在同一次 UPDATE 里写入（hdip_guard_update 只允许写一次）
    rel.valid_to = item.valid_to
    rel.closed_change_id = ctx.change_id
    rel.closed_by = ctx.user_id
    rel.closed_at = now
    s.flush()
    inst = s.get(Institution, rel.institution_id)
    campus = s.get(Campus, rel.campus_id)
    return {
        "target": f"运营关系 #{rel.id}（{inst.code} → {campus.code}）",
        "before": before,
        "after": relation_snapshot(rel),
    }


# ------------------------------------------------------------------ 部门
def _department(s: Session, code: str, field_name: str = "code") -> Department:
    obj = s.scalar(select(Department).where(Department.code == code))
    if obj is None:
        raise ItemError(f"部门代码 {code} 不存在", field_name)
    return obj


def _today(s: Session) -> date:
    return s.scalar(select(func.current_date()))


def _dept_latest(s: Session, d: Department) -> DepartmentVersion:
    return _latest(s, DepartmentVersion, DepartmentVersion.department_id, d.id)


def _dept_label(s: Session, d: Department, day: date | None = None) -> str:
    v = None
    if day is not None:
        v = _version_on(s, DepartmentVersion, DepartmentVersion.department_id, d.id, day)
    return f"{d.code} {(v or _dept_latest(s, d)).name}"


def _dept_start(s: Session, d: Department) -> date:
    return s.scalar(
        select(func.min(DepartmentVersion.valid_from)).where(
            DepartmentVersion.department_id == d.id
        )
    )


def _require_not_terminal(v: DepartmentVersion) -> None:
    if v.lifecycle in LIFECYCLE_TERMINAL:
        raise ItemError(
            f"部门已于 {v.valid_from.isoformat()} {LIFECYCLE_LABELS[v.lifecycle]}，不能再调整"
        )


def _require_after_start(s: Session, d: Department, day: date, field_name: str) -> None:
    start = _dept_start(s, d)
    if day < start:
        raise ItemError(f"生效日不能早于部门的设立日 {start.isoformat()}", field_name)


def _department_create(ctx: Ctx, item: DepartmentCreate) -> dict:
    s = ctx.session
    if s.scalar(select(Department.id).where(Department.code == item.code)):
        raise ItemError(f"部门代码 {item.code} 已被使用，代码永不复用", "code")
    inst = None
    if item.institution_code:
        inst = _ref(s, _institution, item.institution_code, "institution_code")
    day = item.valid_from or _today(s)
    d = Department(code=item.code, created_change_id=ctx.change_id)
    s.add(d)
    s.flush()
    v = DepartmentVersion(
        department_id=d.id,
        version_no=1,
        valid_from=day,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        name=item.name,
        short_name=item.short_name,
        description=item.description,
        establishment_form=item.establishment_form,
        temporary_until=item.temporary_until,
        lifecycle=item.lifecycle,
        admin_grade=item.admin_grade,
        duties=list(item.duties),
        basis_note=item.basis_note,
    )
    s.add(v)
    if inst:
        s.add(
            DepartmentInstitution(
                department_id=d.id,
                institution_id=inst.id,
                is_primary=True,
                valid_from=day,
                change_id=ctx.change_id,
                recorded_by=ctx.user_id,
            )
        )
    s.flush()
    after = version_snapshot(v) | {"affiliation": inst.code if inst else None}
    return {"target": f"部门 {d.code} {v.name}", "before": None, "after": after}


def _department_revise(ctx: Ctx, item: DepartmentRevise) -> dict:
    s = ctx.session
    d = _department(s, item.code)
    latest = _dept_latest(s, d)
    _require_not_terminal(latest)
    before = version_snapshot(latest)
    content = {k: getattr(latest, k) for k in DepartmentVersion.CONTENT}
    content |= item.changes.model_dump(exclude_unset=True)
    if content["establishment_form"] == "STANDING":
        content["temporary_until"] = None
    elif content["temporary_until"] is None:
        raise ItemError("经批准的临时部门必须填期限", "changes.temporary_until")
    content["duties"] = list(content["duties"] or [])
    new = _next_version(
        ctx, DepartmentVersion, "department_id", d.id, latest, item.effective_date, content
    )
    return {
        "target": f"部门 {d.code} {new.name}",
        "before": before,
        "after": version_snapshot(new),
    }


def _department_change_lifecycle(ctx: Ctx, item: DepartmentChangeLifecycle) -> dict:
    s = ctx.session
    d = _department(s, item.code)
    latest = _dept_latest(s, d)
    _require_not_terminal(latest)
    cur, target = latest.lifecycle, item.lifecycle
    if target not in LIFECYCLE_NEXT[cur]:
        raise ItemError(
            f"当前为{LIFECYCLE_LABELS[cur]}，不能变为{LIFECYCLE_LABELS[target]}"
            "（筹备 → 正式履职 ⇄ 暂停履职 → 撤销）",
            "lifecycle",
        )
    before = version_snapshot(latest)
    content = {k: getattr(latest, k) for k in DepartmentVersion.CONTENT} | {"lifecycle": target}
    new = _next_version(
        ctx, DepartmentVersion, "department_id", d.id, latest, item.effective_date, content
    )
    if target != "ACTIVE":
        # 依赖它的服务单元由 _check_units 统一校验，仍有依赖则阻止并列出
        ctx.touched_departments[d.id] = ctx.index
    after = version_snapshot(new)
    if target in LIFECYCLE_TERMINAL:
        ended = _end_department_links(ctx, d, item.effective_date)
        ctx.ended_departments[d.id] = (ctx.index, item.effective_date)
        if ended:
            after["ended_links"] = "、".join(ended)
    return {"target": f"部门 {d.code} {new.name}", "before": before, "after": after}


def _close_open(ctx: Ctx, row, day: date, what: str) -> None:
    """结束一条带期间的行（分类赋值、主体归属）：止于 day 前一日，记下关闭它的申请。"""
    if day <= row.valid_from:
        raise ItemError(
            f"生效日须晚于当前{what}的开始日 {row.valid_from.isoformat()}", "effective_date"
        )
    row.valid_to = day - timedelta(days=1)
    row.closed_change_id = ctx.change_id
    ctx.session.flush()


def classification_snapshot(
    s: Session, c: DepartmentClassification | ServiceUnitClassification | None
) -> dict | None:
    if c is None:
        return None
    name = s.scalar(
        select(ClassificationCode.name).where(
            ClassificationCode.scheme_id == c.scheme_id, ClassificationCode.code == c.code
        )
    )
    return {
        "class_code": c.code,
        "class_name": name,
        "valid_from": _json(c.valid_from),
        "valid_to": _json(c.valid_to),
    }


def _scheme_for(s: Session, scheme_code: str, class_code: str | None, owner: str):
    """取分类方案并校验代码；owner 为 department / unit，方案须写明用在该对象上的含义。"""
    scheme = s.scalar(
        select(ClassificationScheme).where(
            ClassificationScheme.code == scheme_code, ClassificationScheme.is_active
        )
    )
    if scheme is None:
        raise ItemError(f"分类方案 {scheme_code} 不存在或已停用", "scheme_code")
    meaning = scheme.meaning_for_department if owner == "department" else scheme.meaning_for_unit
    if not meaning:
        what = "部门" if owner == "department" else "服务单元"
        raise ItemError(f"“{scheme.name}”不适用于{what}", "scheme_code")
    if class_code is not None:
        ok = s.scalar(
            select(ClassificationCode.id).where(
                ClassificationCode.scheme_id == scheme.id,
                ClassificationCode.code == class_code,
                ClassificationCode.is_active,
            )
        )
        if ok is None:
            raise ItemError(f"分类代码 {class_code} 不在“{scheme.name}”中或已停用", "class_code")
    return scheme


def _reclassify(ctx: Ctx, model, owner_col: str, owner_id: int, scheme, class_code, day: date):
    """单选方案：结束当前赋值再新建；多选方案只新增（class_code 为空表示只结束单选方案的赋值）。"""
    s = ctx.session
    current = None
    if scheme.is_exclusive:
        current = s.scalar(
            select(model)
            .where(
                getattr(model, owner_col) == owner_id,
                model.scheme_id == scheme.id,
                model.valid_to.is_(None),
            )
            .order_by(model.valid_from.desc())
            .limit(1)
            .with_for_update()
        )
    if current is not None and current.code == class_code:
        raise ItemError("分类没有变化", "class_code")
    if current is None and class_code is None:
        raise ItemError("当前没有分类，无需结束", "class_code")
    before = classification_snapshot(s, current)
    if current is not None:
        _close_open(ctx, current, day, "分类")
    new = None
    if class_code is not None:
        new = model(
            **{owner_col: owner_id},
            scheme_id=scheme.id,
            is_exclusive=scheme.is_exclusive,
            code=class_code,
            valid_from=day,
            change_id=ctx.change_id,
            recorded_by=ctx.user_id,
        )
        s.add(new)
        s.flush()
    return before, classification_snapshot(s, new) or {"class_code": None}


def _department_classify(ctx: Ctx, item: DepartmentClassify) -> dict:
    s = ctx.session
    d = _department(s, item.code)
    _require_not_terminal(_dept_latest(s, d))
    _require_after_start(s, d, item.effective_date, "effective_date")
    scheme = _scheme_for(s, item.scheme_code, item.class_code, "department")
    before, after = _reclassify(
        ctx,
        DepartmentClassification,
        "department_id",
        d.id,
        scheme,
        item.class_code,
        item.effective_date,
    )
    return {
        "target": f"部门 {_dept_label(s, d, item.effective_date)} · {scheme.name}",
        "before": before,
        "after": after,
    }


def _department_affiliate(ctx: Ctx, item: DepartmentAffiliate) -> dict:
    s = ctx.session
    d = _department(s, item.code)
    _require_not_terminal(_dept_latest(s, d))
    _require_after_start(s, d, item.effective_date, "effective_date")
    inst = _ref(s, _institution, item.institution_code, "institution_code")
    current = s.scalar(
        select(DepartmentInstitution)
        .where(
            DepartmentInstitution.department_id == d.id,
            DepartmentInstitution.is_primary,
            DepartmentInstitution.valid_to.is_(None),
        )
        .with_for_update()
    )
    if current is not None and current.institution_id == inst.id:
        raise ItemError("主体归属没有变化", "institution_code")

    def snap(r: DepartmentInstitution | None) -> dict | None:
        if r is None:
            return None
        return {
            "affiliation": s.get(Institution, r.institution_id).code,
            "valid_from": _json(r.valid_from),
            "valid_to": _json(r.valid_to),
        }

    before = snap(current)
    if current is not None:
        _close_open(ctx, current, item.effective_date, "主体归属")
    new = DepartmentInstitution(
        department_id=d.id,
        institution_id=inst.id,
        is_primary=True,
        valid_from=item.effective_date,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(new)
    s.flush()
    return {"target": f"部门 {_dept_label(s, d)} · 主体归属", "before": before, "after": snap(new)}


def _department_alias_add(ctx: Ctx, item: DepartmentAliasAdd) -> dict:
    s = ctx.session
    d = _department(s, item.code)
    a = DepartmentAlias(
        department_id=d.id,
        kind=item.alias_kind,
        value=item.value,
        valid_from=item.valid_from or _today(s),
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(a)
    s.flush()
    after = {"alias_kind": a.kind, "value": a.value, "valid_from": _json(a.valid_from)}
    return {"target": f"部门 {_dept_label(s, d)} · 别名", "before": None, "after": after}


def _department_alias_close(ctx: Ctx, item: DepartmentAliasClose) -> dict:
    s = ctx.session
    a = s.get(DepartmentAlias, item.alias_id, with_for_update=True)
    if a is None:
        raise ItemError(f"别名 #{item.alias_id} 不存在", "alias_id")
    if a.valid_to is not None:
        raise ItemError(f"该别名已于 {a.valid_to.isoformat()} 停用", "alias_id")
    if item.valid_to < a.valid_from:
        raise ItemError(f"停用日不能早于开始日 {a.valid_from.isoformat()}", "valid_to")
    before = {"value": a.value, "valid_to": None}
    a.valid_to = item.valid_to
    a.closed_change_id = ctx.change_id
    s.flush()
    d = s.get(Department, a.department_id)
    return {
        "target": f"部门 {_dept_label(s, d)} · 别名",
        "before": before,
        "after": {"value": a.value, "valid_to": _json(a.valid_to)},
    }


def _department_legacy(ctx: Ctx, item: DepartmentRename | DepartmentChangeStatus) -> dict:
    replacement = "修订部门属性" if item.kind == "department.rename" else "变更部门生命周期"
    raise ItemError(f"这是部门有版本之前的旧变更类型，请改用“{replacement}”")


# ------------------------------------------------------------------ 行政隶属与管理关系（D2）
RELATION_LABELS_DEPT = {
    "PROFESSIONAL_MGMT": "专业管理",
    "COLLABORATION": "协作",
    "CAMPUS_MGMT": "院区管理",
}


def _org_view(s: Session, code: str) -> OrgView:
    v = s.scalar(select(OrgView).where(OrgView.code == code))
    if v is None:
        raise ItemError(f"组织视图 {code} 不存在", "view_code")
    if v.status != "ACTIVE":
        raise ItemError(f"“{v.name}”尚未启用（占位），不能维护", "view_code")
    return v


def _usable_department(s: Session, code: str, field_name: str) -> Department:
    d = _department(s, code, field_name)
    latest = _dept_latest(s, d)
    if latest.lifecycle in LIFECYCLE_TERMINAL:
        raise ItemError(
            f"部门 {d.code} {latest.name} 已{LIFECYCLE_LABELS[latest.lifecycle]}", field_name
        )
    return d


def _parent_snapshot(s: Session, e: DepartmentHierarchy | None) -> dict | None:
    if e is None:
        return {"parent": None}
    p = s.get(Department, e.parent_department_id)
    return {
        "parent": _dept_label(s, p, e.valid_from),
        "valid_from": _json(e.valid_from),
        "valid_to": _json(e.valid_to),
    }


def _department_set_parent(ctx: Ctx, item: DepartmentSetParent) -> dict:
    s = ctx.session
    d = _usable_department(s, item.code, "code")
    view = _org_view(s, item.view_code)
    _require_after_start(s, d, item.effective_date, "effective_date")
    parent = None
    if item.parent_code is not None:
        parent = _usable_department(s, item.parent_code, "parent_code")
        if parent.id == d.id:
            raise ItemError("部门不能以自己为上级", "parent_code")
        _require_after_start(s, parent, item.effective_date, "effective_date")
    current = s.scalar(
        select(DepartmentHierarchy)
        .where(
            DepartmentHierarchy.view_id == view.id,
            DepartmentHierarchy.child_department_id == d.id,
            DepartmentHierarchy.valid_to.is_(None),
        )
        .with_for_update()
    )
    if current is None and parent is None:
        raise ItemError(f"在“{view.name}”中已是一级部门（无上级）", "parent_code")
    if current is not None and parent is not None and current.parent_department_id == parent.id:
        raise ItemError("上级没有变化", "parent_code")
    before = _parent_snapshot(s, current)
    if current is not None:
        _close_open(ctx, current, item.effective_date, "隶属")
    new = None
    if parent is not None:
        new = DepartmentHierarchy(
            view_id=view.id,
            parent_department_id=parent.id,
            child_department_id=d.id,
            valid_from=item.effective_date,
            change_id=ctx.change_id,
            recorded_by=ctx.user_id,
        )
        s.add(new)
        s.flush()
    # 成环在全部变更项应用后统一检查（_check_org）
    ctx.touched_views[view.id] = ctx.index
    after = (
        _parent_snapshot(s, new)
        if new
        else {"parent": None, "valid_from": _json(item.effective_date)}
    )
    return {"target": f"部门 {_dept_label(s, d)} · {view.name}", "before": before, "after": after}


def _relation_snapshot(s: Session, r: DepartmentRelation) -> dict:
    to = s.get(Department, r.to_department_id) if r.to_department_id else None
    campus = s.get(Campus, r.campus_id) if r.campus_id else None
    return {
        "relation_kind": r.kind,
        "from_department": _dept_label(s, s.get(Department, r.from_department_id)),
        "to_department": _dept_label(s, to) if to else None,
        "campus": campus.code if campus else None,
        "scope": r.scope,
        "valid_from": _json(r.valid_from),
        "valid_to": _json(r.valid_to),
    }


def _department_relation_create(ctx: Ctx, item: DepartmentRelationCreate) -> dict:
    s = ctx.session
    frm = _usable_department(s, item.from_code, "from_code")
    _require_after_start(s, frm, item.valid_from, "valid_from")
    to = None
    if item.to_code is not None:
        to = _usable_department(s, item.to_code, "to_code")
        _require_after_start(s, to, item.valid_from, "valid_from")
    campus = _ref(s, _campus, item.campus_code, "campus_code") if item.campus_code else None
    r = DepartmentRelation(
        kind=item.relation_kind,
        from_department_id=frm.id,
        to_department_id=to.id if to else None,
        campus_id=campus.id if campus else None,
        scope=item.scope,
        valid_from=item.valid_from,
        valid_to=item.valid_to,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(r)
    s.flush()
    return {
        "target": f"{RELATION_LABELS_DEPT[r.kind]}：{_dept_label(s, frm)}",
        "before": None,
        "after": _relation_snapshot(s, r),
    }


def _department_relation_close(ctx: Ctx, item: DepartmentRelationClose) -> dict:
    s = ctx.session
    r = s.get(DepartmentRelation, item.relation_id, with_for_update=True)
    if r is None:
        raise ItemError(f"部门关系 #{item.relation_id} 不存在", "relation_id")
    if r.valid_to is not None:
        raise ItemError(f"该关系已于 {r.valid_to.isoformat()} 结束", "relation_id")
    if item.valid_to < r.valid_from:
        raise ItemError(f"结束日不能早于开始日 {r.valid_from.isoformat()}", "valid_to")
    before = _relation_snapshot(s, r)
    r.valid_to = item.valid_to
    r.closed_change_id = ctx.change_id
    s.flush()
    return {
        "target": f"{RELATION_LABELS_DEPT[r.kind]}：{before['from_department']}",
        "before": before,
        "after": _relation_snapshot(s, r),
    }


def _end_department_links(ctx: Ctx, d: Department, day: date) -> list[str]:
    """部门撤销时：结束它自己的上级边与它参与的管理关系（止于 day 前一日），返回说明。

    它的下级部门不自动处置，由 _check_org 阻止并列出。
    """
    s = ctx.session
    last = day - timedelta(days=1)
    ended: list[str] = []
    rows = [
        *s.scalars(
            select(DepartmentHierarchy).where(
                DepartmentHierarchy.child_department_id == d.id,
                DepartmentHierarchy.valid_to.is_(None),
            )
        ),
        *s.scalars(
            select(DepartmentRelation).where(
                (DepartmentRelation.from_department_id == d.id)
                | (DepartmentRelation.to_department_id == d.id),
                DepartmentRelation.valid_to.is_(None),
            )
        ),
    ]
    for r in rows:
        if r.valid_from > last:
            raise ItemError(
                f"该部门有一条自 {r.valid_from.isoformat()} 起的隶属或关系，晚于撤销日，请先调整",
                "effective_date",
            )
        r.valid_to = last
        r.closed_change_id = ctx.change_id
        if isinstance(r, DepartmentHierarchy):
            ended.append("行政隶属")
            ctx.touched_views[r.view_id] = ctx.index
        else:
            ended.append(RELATION_LABELS_DEPT[r.kind])
    s.flush()
    return ended


# ------------------------------------------------------------------ 部门组织变更
def _end_department_attachments(ctx: Ctx, d: Department, day: date) -> list[str]:
    """部门退出时：它的分类赋值、别名、主体归属止于 day 前一日（历史保留）。

    结果部门的分类不自动继承，在承接清单里逐个确认。
    """
    s = ctx.session
    last = day - timedelta(days=1)
    ended: list[str] = []
    for model, what in (
        (DepartmentClassification, "分类"),
        (DepartmentAlias, "别名"),
        (DepartmentInstitution, "主体归属"),
    ):
        rows = s.scalars(
            select(model).where(
                model.department_id == d.id,
                (model.valid_to.is_(None)) | (model.valid_to >= day),
            )
        ).all()
        for r in rows:
            if r.valid_from > last:
                raise ItemError(
                    f"该部门有一条自 {r.valid_from.isoformat()} 起的{what}，晚于退出日，请先调整",
                    "effective_date",
                )
            r.valid_to = last
            r.closed_change_id = ctx.change_id
        if rows:
            ended.append(what)
    s.flush()
    return ended


def _department_reorganize(ctx: Ctx, item: DepartmentReorganize) -> dict:
    s = ctx.session
    day = item.effective_date
    last = day - timedelta(days=1)
    exits = item.event_type != "SPLIT_OFF"
    new_results = item.event_type != "ABSORB"

    sources: list[tuple[Department, DepartmentVersion]] = []
    for i, p in enumerate(item.sources):
        d = _department(s, p.code, f"sources.{i}.code")
        latest = _dept_latest(s, d)
        _require_not_terminal(latest)
        on_last = _version_on(s, DepartmentVersion, DepartmentVersion.department_id, d.id, last)
        if on_last is None or on_last.lifecycle not in ("ACTIVE", "SUSPENDED"):
            raise ItemError(
                f"原部门 {d.code} 在 {last.isoformat()} 须为正式履职或暂停履职", f"sources.{i}.code"
            )
        # 存续的原部门可在同一申请里于生效日改名；退出的原部门不能在生效日及以后另有版本
        if exits and latest.valid_from >= day:
            raise ItemError(
                f"原部门 {d.code} 自 {latest.valid_from.isoformat()} 起另有版本，"
                "请把组织变更的生效日放在其后",
                "effective_date",
            )
        sources.append((d, latest))

    results: list[Department] = []
    for i, p in enumerate(item.results):
        d = _department(s, p.code, f"results.{i}.code")
        if new_results:
            first = s.scalars(
                select(DepartmentVersion)
                .where(DepartmentVersion.department_id == d.id)
                .order_by(DepartmentVersion.version_no)
            ).first()
            if d.created_change_id != ctx.change_id or first.valid_from != day:
                raise ItemError(
                    f"新设部门 {d.code} 须在本申请里新建，开始日为 {day.isoformat()}",
                    f"results.{i}.code",
                )
            if first.lifecycle != "ACTIVE":
                raise ItemError(f"新设部门 {d.code} 须为正式履职", f"results.{i}.code")
        else:
            v = _version_on(s, DepartmentVersion, DepartmentVersion.department_id, d.id, day)
            if v is None or v.lifecycle != "ACTIVE":
                raise ItemError(
                    f"承接部门 {d.code} 在 {day.isoformat()} 须为正式履职", f"results.{i}.code"
                )
        results.append(d)

    before = {"departments": [version_snapshot(v) | {"code": d.code} for d, v in sources]}
    ended_notes: list[str] = []
    if exits:
        for d, latest in sources:
            content = {k: getattr(latest, k) for k in DepartmentVersion.CONTENT}
            content |= {"lifecycle": "SUPERSEDED"}
            _next_version(ctx, DepartmentVersion, "department_id", d.id, latest, day, content)
            # 依赖它的单元、下级部门、外部编码解释在全部变更项应用后统一校验
            ctx.touched_departments[d.id] = ctx.index
            ctx.ended_departments[d.id] = (ctx.index, day)
            ended = _end_department_links(ctx, d, day) + _end_department_attachments(ctx, d, day)
            if ended:
                ended_notes.append(f"{d.code}：{'、'.join(dict.fromkeys(ended))}")

    event = DepartmentChangeEvent(
        event_type=item.event_type,
        effective_date=day,
        basis_note=item.basis_note,
        scope_note=item.scope_note,
        other_matters=item.other_matters,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(event)
    s.flush()
    rows = [
        (d, "SOURCE", "EXITS" if exits else "CONTINUES", p.scope_note)
        for (d, _), p in zip(sources, item.sources, strict=True)
    ]
    if not exits:  # 分设：原部门既是原部门，也是存续的结果部门
        rows.append((sources[0][0], "RESULT", "CONTINUES", item.sources[0].scope_note))
    rows += [
        (d, "RESULT", "NEW" if new_results else "CONTINUES", p.scope_note)
        for d, p in zip(results, item.results, strict=True)
    ]
    participants = []
    for d, role, outcome, note in rows:
        s.add(
            DepartmentChangeParticipant(
                event_id=event.id, department_id=d.id, role=role, outcome=outcome, scope_note=note
            )
        )
        participants.append(
            {
                "code": d.code,
                "name": _dept_latest(s, d).name if outcome != "EXITS" else _dept_label(s, d, last),
                "role": role,
                "outcome": outcome,
                "scope_note": note,
            }
        )
    s.flush()
    names = lambda ds: "、".join(d.code for d in ds)  # noqa: E731
    return {
        "target": f"{REORG_LABELS[item.event_type]}："
        f"{names([d for d, _ in sources])} → {names(results)}",
        "before": before,
        "after": {
            "event_id": event.id,
            "event_type": item.event_type,
            "effective_date": day.isoformat(),
            "basis_note": item.basis_note,
            "scope_note": item.scope_note,
            "other_matters": item.other_matters,
            "participants": participants,
            "ended_links": "；".join(ended_notes) or None,
        },
    }


def _check_ended_codes(ctx: Ctx) -> list[ProblemItem]:
    """退出（撤销 / 被替代）的部门在退出日及以后不能还有外部编码解释指向它。

    历史解释保留；须在同一张申请里结束（最后有效日 = 退出日前一日）。外部系统确实把代码重新分配给
    新部门时，另新增一条解释并写明依据，不能直接改指向。
    """
    s = ctx.session
    problems: list[ProblemItem] = []
    for dept_id, (index, day) in ctx.ended_departments.items():
        rows = s.execute(
            select(ExternalCode.code, ExternalCode.source_name)
            .join(
                ExternalCodeAssignment, ExternalCodeAssignment.external_code_id == ExternalCode.id
            )
            .where(
                ExternalCodeAssignment.department_id == dept_id,
                (ExternalCodeAssignment.valid_to.is_(None))
                | (ExternalCodeAssignment.valid_to >= day),
            )
        ).all()
        if rows:
            d = s.get(Department, dept_id)
            listed = "、".join(f"{c}（{n}）" for c, n in rows[:5]) + ("等" if len(rows) > 5 else "")
            problems.append(
                ProblemItem(
                    message=f"部门 {d.code} 自 {day.isoformat()} 起退出，"
                    f"仍有 {len(rows)} 条外部编码解释指向它：{listed}。"
                    "请在本申请里结束这些解释（历史仍指向原部门）",
                    item_index=index,
                )
            )
    return problems


def _check_org(ctx: Ctx) -> list[ProblemItem]:
    """全部变更项应用后：被调整的视图不得成环；被撤销 / 被替代的部门不得还有下级部门。"""
    s = ctx.session
    problems: list[ProblemItem] = []
    for view_id, index in ctx.touched_views.items():
        cycle = _find_cycle(s, view_id)
        if cycle:
            day, names = cycle
            view = s.get(OrgView, view_id)
            problems.append(
                ProblemItem(
                    message=f"“{view.name}”自 {day.isoformat()} 起形成循环隶属："
                    + " → ".join(names)
                    + "，同一视图里上下级不能成环",
                    item_index=index,
                )
            )
    for dept_id, (index, day) in ctx.ended_departments.items():
        children = s.execute(
            select(DepartmentHierarchy.child_department_id)
            .where(
                DepartmentHierarchy.parent_department_id == dept_id,
                (DepartmentHierarchy.valid_to.is_(None)) | (DepartmentHierarchy.valid_to >= day),
            )
            .distinct()
        ).scalars()
        names = [_dept_label(s, s.get(Department, c), day) for c in children]
        if names:
            problems.append(
                ProblemItem(
                    message="仍有下级部门，须先调整它们的行政隶属：" + "、".join(names),
                    item_index=index,
                )
            )
    return problems


def _find_cycle(s: Session, view_id: int) -> tuple[date, list[str]] | None:
    """在每个边界日期检查当天的上下级是否成环；返回最早的成环日期与环上的部门。"""
    edges = s.scalars(
        select(DepartmentHierarchy).where(DepartmentHierarchy.view_id == view_id)
    ).all()
    days = sorted(
        {e.valid_from for e in edges}
        | {e.valid_to + timedelta(days=1) for e in edges if e.valid_to}
    )
    for day in days:
        parent = {
            e.child_department_id: e.parent_department_id
            for e in edges
            if e.valid_from <= day and (e.valid_to is None or e.valid_to >= day)
        }
        for start in parent:
            seen: list[int] = []
            node: int | None = start
            while node is not None and node not in seen:
                seen.append(node)
                node = parent.get(node)
            if node is not None:
                loop = seen[seen.index(node) :] + [node]
                return day, [_dept_label(s, s.get(Department, n), day) for n in loop]
    return None


# ------------------------------------------------------------------ 服务单元
def _unit(s: Session, code: str) -> ServiceUnit:
    obj = s.scalar(select(ServiceUnit).where(ServiceUnit.code == code))
    if obj is None:
        raise ItemError(f"服务单元代码 {code} 不存在", "code")
    return obj


def _active_department(s: Session, code: str, field_name: str) -> Department:
    """选用部门：须存在且未撤销；“单元期间内部门须为正式履职”由 _check_units 统一校验。"""
    d = _department(s, code, field_name)
    latest = _dept_latest(s, d)
    if latest.lifecycle in LIFECYCLE_TERMINAL:
        raise ItemError(
            f"部门 {d.code} {latest.name} 已{LIFECYCLE_LABELS[latest.lifecycle]}，不能被选用",
            field_name,
        )
    return d


def _ref(s: Session, finder, code: str, field_name: str):
    try:
        return finder(s, code)
    except ItemError as e:
        raise ItemError(e.message, field_name) from None


def unit_snapshot(s: Session, v: ServiceUnitVersion) -> dict[str, Any]:
    dept = s.get(Department, v.department_id)
    dept_v = _version_on(
        s, DepartmentVersion, DepartmentVersion.department_id, dept.id, v.valid_from
    ) or _dept_latest(s, dept)
    campus = s.get(Campus, v.campus_id)
    inst = s.get(Institution, v.institution_id)
    campus_v = _version_on(s, CampusVersion, CampusVersion.campus_id, campus.id, v.valid_from)
    inst_v = _version_on(
        s, InstitutionVersion, InstitutionVersion.institution_id, inst.id, v.valid_from
    )
    unit = s.get(ServiceUnit, v.service_unit_id)
    return {
        "version_no": v.version_no,
        "valid_from": _json(v.valid_from),
        "valid_to": _json(v.valid_to),
        "code": unit.code,
        "unit_type": unit.unit_type,
        "name": v.name,
        "department": f"{dept.code} {dept_v.name}",
        "campus": f"{campus.code} {campus_v.name if campus_v else ''}".strip(),
        "institution": f"{inst.code} {inst_v.name if inst_v else ''}".strip(),
        "status": v.status,
        "phone": v.phone,
        "scope_note": v.scope_note,
    }


def _new_unit(
    ctx: Ctx,
    code: str,
    unit_type: str,
    valid_from: date,
    f: ServiceUnitFields,
    prefix: str = "",
) -> ServiceUnitVersion:
    """新建单元身份与第 1 版（新建、拆分/合并的后继共用）。prefix 用于指出出错字段的位置。"""
    s = ctx.session
    if s.scalar(select(ServiceUnit.id).where(ServiceUnit.code == code)):
        raise ItemError(
            f"服务单元代码 {code} 已被使用（含已退出单元），代码永不复用", f"{prefix}code"
        )
    dept = _active_department(s, f.department_code, f"{prefix}fields.department_code")
    campus = _ref(s, _campus, f.campus_code, f"{prefix}fields.campus_code")
    inst = _ref(s, _institution, f.institution_code, f"{prefix}fields.institution_code")
    unit = ServiceUnit(code=code, unit_type=unit_type, created_change_id=ctx.change_id)
    s.add(unit)
    s.flush()
    v = ServiceUnitVersion(
        service_unit_id=unit.id,
        version_no=1,
        valid_from=valid_from,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        name=f.name,
        department_id=dept.id,
        campus_id=campus.id,
        institution_id=inst.id,
        status="ACTIVE",
        phone=f.phone,
        scope_note=f.scope_note,
    )
    s.add(v)
    s.flush()
    ctx.new_unit_versions[v.id] = ctx.index
    return v


def _unit_create(ctx: Ctx, item: ServiceUnitCreate) -> dict:
    v = _new_unit(ctx, item.code, item.unit_type, item.valid_from, item.fields)
    return {
        "target": f"服务单元 {item.code} {v.name}",
        "before": None,
        "after": unit_snapshot(ctx.session, v),
    }


def _unit_next(ctx: Ctx, code: str, day: date, patch: dict) -> dict:
    """服务单元各类调整的共同部分：在 day 生效一个新版本。"""
    s = ctx.session
    unit = _unit(s, code)
    latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
    if latest.valid_to is not None:
        raise ItemError(f"服务单元已于 {latest.valid_to.isoformat()} 后永久退出，不能再调整")
    before = unit_snapshot(s, latest)
    content = {k: getattr(latest, k) for k in ServiceUnitVersion.CONTENT} | patch
    new = _next_version(ctx, ServiceUnitVersion, "service_unit_id", unit.id, latest, day, content)
    ctx.new_unit_versions[new.id] = ctx.index
    return {
        "target": f"服务单元 {unit.code} {new.name}",
        "before": before,
        "after": unit_snapshot(s, new),
    }


def _unit_revise(ctx: Ctx, item: ServiceUnitRevise) -> dict:
    patch = item.changes.model_dump(exclude_unset=True)
    return _unit_next(ctx, item.code, item.effective_date, patch)


def _unit_rebind(ctx: Ctx, item: ServiceUnitRebind) -> dict:
    s = ctx.session
    patch: dict[str, Any] = {}
    if item.campus_code is not None:
        patch["campus_id"] = _ref(s, _campus, item.campus_code, "campus_code").id
    if item.institution_code is not None:
        inst = _ref(s, _institution, item.institution_code, "institution_code")
        patch["institution_id"] = inst.id
    return _unit_next(ctx, item.code, item.effective_date, patch)


def _unit_change_department(ctx: Ctx, item: ServiceUnitChangeDepartment) -> dict:
    dept = _active_department(ctx.session, item.department_code, "department_code")
    return _unit_next(ctx, item.code, item.effective_date, {"department_id": dept.id})


def _unit_change_status(ctx: Ctx, item: ServiceUnitChangeStatus) -> dict:
    s = ctx.session
    unit = _unit(s, item.code)
    latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
    if latest.status == item.status and latest.valid_to is None:
        raise ItemError(f"服务单元已是{UNIT_STATUS_LABELS[item.status]}", "status")
    return _unit_next(ctx, item.code, item.effective_date, {"status": item.status})


def _end_unit(
    ctx: Ctx, code: str, last_day: date, code_field: str, day_field: str
) -> tuple[ServiceUnit, ServiceUnitVersion, dict]:
    """让单元在 last_day 之后永久退出（退出、拆分/合并的前身共用）。

    返回单元、最新版本与退出前快照。
    """
    s = ctx.session
    unit = _ref(s, _unit, code, code_field)
    latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
    if latest.valid_to is not None:
        raise ItemError(
            f"服务单元 {code} 已于 {latest.valid_to.isoformat()} 后永久退出", code_field
        )
    if last_day < latest.valid_from:
        raise ItemError(
            f"服务单元 {code} 的最后有效日不能早于其当前版本的开始日 "
            f"{latest.valid_from.isoformat()}",
            day_field,
        )
    before = unit_snapshot(s, latest)
    latest.valid_to = last_day
    s.flush()
    return unit, latest, before


def _unit_retire(ctx: Ctx, item: ServiceUnitRetire) -> dict:
    unit, latest, before = _end_unit(ctx, item.code, item.valid_to, "code", "valid_to")
    return {
        "target": f"服务单元 {unit.code} {latest.name}",
        "before": before,
        "after": unit_snapshot(ctx.session, latest),
    }


# ------------------------------------------------------------------ 拆分与合并
def _lineage(ctx: Ctx, kind: str, pred_id: int, succ_id: int, day: date) -> None:
    ctx.session.add(
        ServiceUnitLineage(
            predecessor_id=pred_id,
            successor_id=succ_id,
            lineage_type=kind,
            effective_date=day,
            change_id=ctx.change_id,
            recorded_by=ctx.user_id,
        )
    )
    ctx.session.flush()


def _evolve(
    ctx: Ctx, kind: str, pred_codes: list[str], successors: list, day: date, paths: dict
) -> dict:
    """前身全部在 day 前一日退出，后继全部自 day 起，两两写演变关系。

    后继是新身份、新代码，不继承前身的版本历史，也不自动迁移任何引用（设计文档第 5 节）。
    """
    s = ctx.session
    last_day = day - timedelta(days=1)
    preds = []
    for i, code in enumerate(pred_codes):
        unit = _ref(s, _unit, code, paths["pred"](i))
        latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
        if latest.valid_to is None and day <= latest.valid_from:
            raise ItemError(
                f"生效日须晚于前身 {code} 当前版本的开始日 {latest.valid_from.isoformat()}",
                "effective_date",
            )
        unit, _, before = _end_unit(ctx, code, last_day, paths["pred"](i), "effective_date")
        preds.append((unit, before))
    succs = []
    for i, spec in enumerate(successors):
        v = _new_unit(ctx, spec.code, spec.unit_type, day, spec.fields, paths["succ"](i))
        succs.append((spec.code, v))
    for unit, _ in preds:
        for _, v in succs:
            _lineage(ctx, kind, unit.id, v.service_unit_id, day)
    pred_label = "、".join(f"{u.code} {b['name']}" for u, b in preds)
    succ_label = "、".join(f"{code} {v.name}" for code, v in succs)
    return {
        "target": f"{pred_label} → {succ_label}",
        "before": {"predecessors": [b for _, b in preds]},
        "after": {
            "effective_date": day.isoformat(),
            "successors": [unit_snapshot(s, v) for _, v in succs],
        },
    }


def _unit_split(ctx: Ctx, item: ServiceUnitSplit) -> dict:
    return _evolve(
        ctx,
        "SPLIT",
        [item.code],
        item.successors,
        item.effective_date,
        {"pred": lambda i: "code", "succ": lambda i: f"successors.{i}."},
    )


def _unit_merge(ctx: Ctx, item: ServiceUnitMerge) -> dict:
    return _evolve(
        ctx,
        "MERGE",
        item.codes,
        [item.successor],
        item.effective_date,
        {"pred": lambda i: f"codes.{i}", "succ": lambda i: "successor."},
    )


# ------------------------------------------------------------------ 服务单元分类与外部标识（D3）
def _unit_classify(ctx: Ctx, item: ServiceUnitClassify) -> dict:
    s = ctx.session
    unit = _unit(s, item.code)
    latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
    if latest.valid_to is not None:
        raise ItemError(f"服务单元已于 {latest.valid_to.isoformat()} 后永久退出，不能再调整")
    start = _unit_start(s, unit)
    if item.effective_date < start:
        raise ItemError(f"生效日不能早于单元的开始日 {start.isoformat()}", "effective_date")
    scheme = _scheme_for(s, item.scheme_code, item.class_code, "unit")
    before, after = _reclassify(
        ctx,
        ServiceUnitClassification,
        "service_unit_id",
        unit.id,
        scheme,
        item.class_code,
        item.effective_date,
    )
    return {
        "target": f"服务单元 {unit.code} {latest.name} · {scheme.name}",
        "before": before,
        "after": after,
    }


def _classification_close(
    ctx: Ctx, item: DepartmentClassificationClose | ServiceUnitClassificationClose
) -> dict:
    s = ctx.session
    is_dept = item.kind == "department.classification_close"
    model = DepartmentClassification if is_dept else ServiceUnitClassification
    c = s.get(model, item.classification_id, with_for_update=True)
    if c is None:
        raise ItemError(f"分类赋值 #{item.classification_id} 不存在", "classification_id")
    if c.valid_to is not None:
        raise ItemError(f"该分类已于 {c.valid_to.isoformat()} 结束", "classification_id")
    if item.valid_to < c.valid_from:
        raise ItemError(f"最后有效日不能早于开始日 {c.valid_from.isoformat()}", "valid_to")
    before = classification_snapshot(s, c)
    c.valid_to = item.valid_to
    c.closed_change_id = ctx.change_id
    s.flush()
    scheme = s.get(ClassificationScheme, c.scheme_id)
    if is_dept:
        owner = f"部门 {_dept_label(s, s.get(Department, c.department_id))}"
    else:
        unit = s.get(ServiceUnit, c.service_unit_id)
        latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
        owner = f"服务单元 {unit.code} {latest.name}"
    return {
        "target": f"{owner} · {scheme.name}",
        "before": before,
        "after": classification_snapshot(s, c),
    }


def _unit_start(s: Session, unit: ServiceUnit) -> date:
    return s.scalar(
        select(func.min(ServiceUnitVersion.valid_from)).where(
            ServiceUnitVersion.service_unit_id == unit.id
        )
    )


UNMODELED_LABELS = {
    "NURSING_UNIT": "护理单元",
    "WARD": "病区",
    "LOCATION": "地点",
    "STAT_GROUP": "统计分组",
    "COMPOSITE": "旧系统复合记录",
    "OTHER": "其他",
}


def _namespace(s: Session, system_code: str, namespace_code: str) -> CodeNamespace:
    row = s.execute(
        select(CodeNamespace, SourceSystem)
        .join(SourceSystem, SourceSystem.id == CodeNamespace.source_system_id)
        .where(SourceSystem.code == system_code, CodeNamespace.code == namespace_code)
    ).first()
    if row is None:
        raise ItemError(f"字典 {system_code}/{namespace_code} 不存在", "namespace_code")
    ns, system = row
    if not (ns.is_active and system.is_active):
        raise ItemError(f"字典 {system_code}/{namespace_code} 已停用", "namespace_code")
    return ns


def _external_code(s: Session, item) -> ExternalCode:
    ns = _namespace(s, item.system_code, item.namespace_code)
    ec = s.scalar(
        select(ExternalCode).where(
            ExternalCode.namespace_id == ns.id, ExternalCode.code == item.external_code
        )
    )
    if ec is None:
        raise ItemError(
            f"{item.system_code}/{item.namespace_code} 里尚未登记代码 {item.external_code}",
            "external_code",
        )
    return ec


def _ext_label(s: Session, ec: ExternalCode) -> str:
    ns = s.get(CodeNamespace, ec.namespace_id)
    system = s.get(SourceSystem, ns.source_system_id)
    name = f" {ec.source_name}" if ec.source_name else ""
    return f"外部代码 {system.code}/{ns.code} {ec.code}{name}"


def assignment_target_label(s: Session, a: ExternalCodeAssignment) -> str:
    if a.target_type == "department":
        return f"部门 {_dept_label(s, s.get(Department, a.department_id), a.valid_from)}"
    if a.target_type == "service_unit":
        unit = s.get(ServiceUnit, a.service_unit_id)
        v = _version_on(
            s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id, a.valid_from
        ) or _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
        return f"服务单元 {unit.code} {v.name}"
    return f"对象未建模（{UNMODELED_LABELS[a.unmodeled_type]}）"


def _assignment_snapshot(s: Session, a: ExternalCodeAssignment) -> dict:
    campus = s.get(Campus, a.campus_id) if a.campus_id else None
    return {
        "assignment_id": a.id,
        "target": assignment_target_label(s, a),
        "campus": campus.code if campus else None,
        "valid_from": _json(a.valid_from),
        "valid_to": _json(a.valid_to),
        "evidence_note": a.evidence_note,
    }


def _external_code_register(ctx: Ctx, item: ExternalCodeRegister) -> dict:
    s = ctx.session
    ns = _namespace(s, item.system_code, item.namespace_code)
    exists = s.scalar(
        select(ExternalCode.id).where(
            ExternalCode.namespace_id == ns.id, ExternalCode.code == item.external_code
        )
    )
    if exists:
        raise ItemError(
            f"{item.system_code}/{item.namespace_code} 里已登记过代码 {item.external_code}",
            "external_code",
        )
    ec = ExternalCode(
        namespace_id=ns.id,
        code=item.external_code,
        source_name=item.source_name,
        semantic_note=item.semantic_note,
        created_change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(ec)
    s.flush()
    after = {"source_name": ec.source_name, "semantic_note": ec.semantic_note}
    return {"target": _ext_label(s, ec), "before": None, "after": after}


def _external_code_assign(ctx: Ctx, item: ExternalCodeAssign) -> dict:
    s = ctx.session
    ec = _external_code(s, item)
    a = ExternalCodeAssignment(
        external_code_id=ec.id,
        target_type=item.target_type,
        unmodeled_type=item.unmodeled_type,
        evidence_note=item.evidence_note,
        valid_from=item.valid_from,
        valid_to=item.valid_to,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    if item.target_type == "department":
        d = _department(s, item.department_code, "department_code")
        start = _dept_start(s, d)
        if item.valid_from < start:
            raise ItemError(f"开始日不能早于部门的设立日 {start.isoformat()}", "valid_from")
        exit_day = s.scalar(
            select(func.min(DepartmentVersion.valid_from)).where(
                DepartmentVersion.department_id == d.id,
                DepartmentVersion.lifecycle.in_(LIFECYCLE_TERMINAL),
            )
        )
        if exit_day and (item.valid_to is None or item.valid_to >= exit_day):
            raise ItemError(
                f"部门 {d.code} 自 {exit_day.isoformat()} 起已退出，解释须在此前结束", "valid_to"
            )
        a.department_id = d.id
    elif item.target_type == "service_unit":
        unit = _ref(s, _unit, item.service_unit_code, "service_unit_code")
        start = _unit_start(s, unit)
        if item.valid_from < start:
            raise ItemError(f"开始日不能早于单元的开始日 {start.isoformat()}", "valid_from")
        latest = _latest(s, ServiceUnitVersion, ServiceUnitVersion.service_unit_id, unit.id)
        if latest.valid_to is not None and (
            item.valid_to is None or item.valid_to > latest.valid_to
        ):
            raise ItemError(
                f"单元已于 {latest.valid_to.isoformat()} 后永久退出，解释须在此前结束", "valid_to"
            )
        a.service_unit_id = unit.id
    if item.campus_code is not None:
        a.campus_id = _ref(s, _campus, item.campus_code, "campus_code").id
    s.add(a)
    s.flush()
    ctx.touched_codes[ec.id] = ctx.index
    return {"target": _ext_label(s, ec), "before": None, "after": _assignment_snapshot(s, a)}


def _external_code_assignment_close(ctx: Ctx, item: ExternalCodeAssignmentClose) -> dict:
    s = ctx.session
    a = s.get(ExternalCodeAssignment, item.assignment_id, with_for_update=True)
    if a is None:
        raise ItemError(f"解释 #{item.assignment_id} 不存在", "assignment_id")
    if a.valid_to is not None:
        raise ItemError(f"该解释已于 {a.valid_to.isoformat()} 结束", "assignment_id")
    if item.valid_to < a.valid_from:
        raise ItemError(f"结束日不能早于开始日 {a.valid_from.isoformat()}", "valid_to")
    before = _assignment_snapshot(s, a)
    a.valid_to = item.valid_to
    a.closed_change_id = ctx.change_id
    s.flush()
    ec = s.get(ExternalCode, a.external_code_id)
    return {"target": _ext_label(s, ec), "before": before, "after": _assignment_snapshot(s, a)}


def _check_codes(ctx: Ctx) -> list[ProblemItem]:
    """同一源记录在重叠期间的解释，要么都带院区条件，要么都不带（否则某院区同时有两个解释）。"""
    s = ctx.session
    problems = []
    for code_id, index in sorted(ctx.touched_codes.items(), key=lambda x: x[1]):
        rows = s.scalars(
            select(ExternalCodeAssignment).where(ExternalCodeAssignment.external_code_id == code_id)
        ).all()
        for x in rows:
            clash = next(
                (
                    y
                    for y in rows
                    if (x.campus_id is None) != (y.campus_id is None)
                    and (x.valid_to is None or y.valid_from <= x.valid_to)
                    and (y.valid_to is None or x.valid_from <= y.valid_to)
                ),
                None,
            )
            if clash is not None:
                start = max(x.valid_from, clash.valid_from)
                problems.append(
                    ProblemItem(
                        message=(
                            f"{_ext_label(s, s.get(ExternalCode, code_id))} 自 "
                            f"{start.isoformat()} 起同时有带院区条件和不带条件的解释；"
                            "同一时点要么都按院区区分，要么不区分"
                        ),
                        item_index=index,
                    )
                )
                break
    return problems


# ------------------------------------------------------------------ 单元依赖校验
def _uncovered_from(relations: list[OperatorRelation], start: date, end: date | None):
    """返回 [start, end] 中第一个没有被这些关系覆盖的日期；全部覆盖返回 None。"""
    cursor = start
    for r in sorted(relations, key=lambda r: r.valid_from):
        if r.valid_from > cursor:
            break
        if r.valid_to is None:
            return None
        if r.valid_to >= cursor:
            cursor = r.valid_to + timedelta(days=1)
        if end is not None and cursor > end:
            return None
    return cursor


def _not_started(s: Session, model, owner_col: str, obj, what: str, subject: str) -> str:
    """对象最早版本晚于所填开始日时的提示：说清是哪个对象、最早可以从哪天开始。

    未来生效的对象现在就能挂单元、建关系，只要开始日不早于它的开始日。
    """
    first = next(
        (
            v
            for v in s.scalars(
                select(model).where(getattr(model, owner_col) == obj.id).order_by(model.valid_from)
            )
            if not is_void(v)
        ),
        None,
    )
    if first is None:  # 同一张申请里尚未建成，按理不会走到
        return f"{what} {obj.code} 还没有版本"
    return (
        f"{what}“{first.name}”（{obj.code}）自 {first.valid_from.isoformat()} 起才有记录，"
        f"{subject}的开始日不能早于这天；现在就可以登记，到日自动生效"
    )


def unit_version_problem(s: Session, v: ServiceUnitVersion) -> str | None:
    """单元版本须满足：院区在整个期间存在且非停用；运营主体与该院区有覆盖整个期间的“运营”关系。"""
    campus = s.get(Campus, v.campus_id)
    inst = s.get(Institution, v.institution_id)

    def overlaps(x) -> bool:
        return (
            not is_void(x)
            and (v.valid_to is None or x.valid_from <= v.valid_to)
            and (x.valid_to is None or x.valid_to >= v.valid_from)
        )

    campus_versions = s.scalars(
        select(CampusVersion).where(CampusVersion.campus_id == campus.id)
    ).all()
    if not any(cv.valid_from <= v.valid_from for cv in campus_versions):
        return _not_started(s, CampusVersion, "campus_id", campus, "院区", "单元")
    for cv in sorted(campus_versions, key=lambda x: x.valid_from):
        if cv.operating_status == "SUSPENDED" and overlaps(cv):
            return f"院区 {campus.code} 自 {cv.valid_from.isoformat()} 起停用"
    relations = s.scalars(
        select(OperatorRelation).where(
            OperatorRelation.institution_id == inst.id,
            OperatorRelation.campus_id == campus.id,
            OperatorRelation.relation_type == "OPERATE",
        )
    ).all()
    gap = _uncovered_from(list(relations), v.valid_from, v.valid_to)
    if gap is not None:
        return f"主体 {inst.code} 与院区 {campus.code} 自 {gap.isoformat()} 起没有“运营”关系"
    # 所属部门在单元整个期间内须为“正式履职”
    dept = s.get(Department, v.department_id)
    dept_versions = sorted(
        s.scalars(select(DepartmentVersion).where(DepartmentVersion.department_id == dept.id)),
        key=lambda x: x.valid_from,
    )
    if not any(dv.valid_from <= v.valid_from for dv in dept_versions):
        return _not_started(s, DepartmentVersion, "department_id", dept, "部门", "单元")
    for dv in dept_versions:
        if overlaps(dv) and dv.lifecycle != "ACTIVE":
            return (
                f"部门 {dept.code} {dv.name} 自 {dv.valid_from.isoformat()} 起为"
                f"{LIFECYCLE_LABELS[dv.lifecycle]}"
            )
    return None


def _check_units(ctx: Ctx) -> list[ProblemItem]:
    """应用完全部变更项后统一校验，所以“停用院区 + 把单元改挂走”可以放在同一张申请里，不论先后。"""
    s = ctx.session
    checks: dict[int, int] = dict(ctx.new_unit_versions)
    if ctx.touched_campuses:
        rows = s.scalars(
            select(ServiceUnitVersion).where(ServiceUnitVersion.campus_id.in_(ctx.touched_campuses))
        )
        for v in rows:
            checks.setdefault(v.id, ctx.touched_campuses[v.campus_id])
    if ctx.touched_departments:
        rows = s.scalars(
            select(ServiceUnitVersion).where(
                ServiceUnitVersion.department_id.in_(ctx.touched_departments)
            )
        )
        for v in rows:
            checks.setdefault(v.id, ctx.touched_departments[v.department_id])
    # 项序号 → (本项新写的单元版本的问题, 本项影响到的已有单元)
    blocked: dict[int, tuple[list[str], list[str]]] = {}
    for version_id, index in sorted(checks.items()):
        v = s.get(ServiceUnitVersion, version_id)
        problem = unit_version_problem(s, v)
        if problem:
            unit = s.get(ServiceUnit, v.service_unit_id)
            own, dependents = blocked.setdefault(index, ([], []))
            if version_id in ctx.new_unit_versions:
                own.append(problem)
            else:
                dependents.append(f"{unit.code} {v.name}（{problem}）")
    problems = []
    for index, (own, dependents) in sorted(blocked.items()):
        parts = list(own)
        if dependents:
            parts.append("仍有服务单元依赖，须先对这些单元重新绑定或退出：" + "；".join(dependents))
        problems.append(ProblemItem(message="；".join(parts), item_index=index))
    return problems


HANDLERS = {
    "institution.create": _institution_create,
    "institution.revise": _institution_revise,
    "campus.create": _campus_create,
    "campus.revise": _campus_revise,
    "campus.change_status": _campus_change_status,
    "operator_relation.create": _relation_create,
    "operator_relation.close": _relation_close,
    "department.create": _department_create,
    "department.revise": _department_revise,
    "department.change_lifecycle": _department_change_lifecycle,
    "department.reorganize": _department_reorganize,
    "department.classify": _department_classify,
    "department.affiliate": _department_affiliate,
    "department.alias_add": _department_alias_add,
    "department.alias_close": _department_alias_close,
    "department.set_parent": _department_set_parent,
    "department.relation_create": _department_relation_create,
    "department.relation_close": _department_relation_close,
    "department.rename": _department_legacy,
    "department.change_status": _department_legacy,
    "service_unit.create": _unit_create,
    "service_unit.revise": _unit_revise,
    "service_unit.rebind": _unit_rebind,
    "service_unit.change_department": _unit_change_department,
    "service_unit.change_status": _unit_change_status,
    "service_unit.retire": _unit_retire,
    "service_unit.split": _unit_split,
    "service_unit.merge": _unit_merge,
    "service_unit.classify": _unit_classify,
    "department.classification_close": _classification_close,
    "service_unit.classification_close": _classification_close,
    "external_code.register": _external_code_register,
    "external_code.assign": _external_code_assign,
    "external_code.assignment_close": _external_code_assignment_close,
}


def _db_message(exc: DBAPIError) -> str:
    diag = getattr(exc.orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    if name in CONSTRAINT_MESSAGES:
        return CONSTRAINT_MESSAGES[name]
    if getattr(exc.orig, "sqlstate", None) == "22000":  # daterange 上下界颠倒
        return "结束日不能早于开始日"
    primary = getattr(diag, "message_primary", None) or str(exc.orig)
    return f"数据库拒绝：{primary}"


def apply_items(
    session: Session, items: list[ChangeItem], change_id: int, user_id: int
) -> list[dict]:
    """依次应用，返回每项的前后内容。任一项失败抛 BusinessError，调用方负责回滚。"""
    if not items:
        raise BusinessError("变更申请里没有变更项")
    ctx = Ctx(session, change_id, user_id)
    outcomes: list[dict] = []
    for index, item in enumerate(items):
        label = KIND_LABELS[item.kind]
        ctx.index = index
        try:
            out = HANDLERS[item.kind](ctx, item)
        except ItemError as e:
            raise BusinessError(
                f"第 {index + 1} 项（{label}）未通过校验：{e.message}",
                problems=[ProblemItem(message=e.message, item_index=index, field=e.field)],
            ) from None
        except DBAPIError as e:
            msg = _db_message(e)
            raise BusinessError(
                f"第 {index + 1} 项（{label}）未通过校验：{msg}",
                problems=[ProblemItem(message=msg, item_index=index)],
            ) from None
        outcomes.append({"index": index, "kind": item.kind, "label": label, **out})
    problems = _check_units(ctx) + _check_org(ctx) + _check_codes(ctx) + _check_ended_codes(ctx)
    if problems:
        first = problems[0]
        label = KIND_LABELS[items[first.item_index].kind]
        raise BusinessError(
            f"第 {first.item_index + 1} 项（{label}）未通过校验：{first.message}",
            problems=problems,
        )
    return outcomes


def dry_run(session: Session, items: list[ChangeItem], change_id: int, user_id: int) -> list[dict]:
    """在 SAVEPOINT 里执行一遍再回滚：用于提交前校验和确认页差异。"""
    savepoint = session.begin_nested()
    try:
        return apply_items(session, items, change_id, user_id)
    finally:
        savepoint.rollback()
