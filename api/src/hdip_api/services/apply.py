"""把变更项应用到业务表。

同一套代码既用于“预演”（提交前校验、确认页差异，用 SAVEPOINT 执行后回滚），
也用于“确认”（在确认事务里真正写入）。任何一项失败，整张申请都不成立。

校验分两层：这里先做能给出清楚中文提示的业务校验；最终以数据库约束为准，
数据库拒绝时把约束名翻译成中文（见 CONSTRAINT_MESSAGES）。
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, ProblemItem
from hdip_api.models import (
    Campus,
    CampusVersion,
    Institution,
    InstitutionVersion,
    OperatorRelation,
    OptionItem,
)
from hdip_api.schemas.items import (
    KIND_LABELS,
    OPERATING_STATUS_ORDER,
    CampusChangeStatus,
    CampusCreate,
    CampusRevise,
    ChangeItem,
    InstitutionCreate,
    InstitutionRevise,
    OperatorRelationClose,
    OperatorRelationCreate,
)

STATUS_LABELS = {
    "PLANNING": "筹建",
    "TRIAL_RUNNING": "试运行",
    "RUNNING": "运行",
    "SUSPENDED": "停用",
}
RELATION_LABELS = {"OPERATE": "运营", "REGISTER": "登记", "MANAGE": "管理", "CHARGE": "收费"}

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


def _json(value: Any) -> Any:
    if isinstance(value, date | datetime):
        return value.isoformat()
    return value


def version_snapshot(v: InstitutionVersion | CampusVersion) -> dict[str, Any]:
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


def _next_version(ctx: Ctx, model, fk_name: str, obj_id: int, latest, day: date, content: dict):
    """修订在 day 生效：旧版结束日 = day 前一日，新版从 day 开始（闭区间）。"""
    if latest.valid_to is not None:
        raise ItemError("当前版本已结束，不能修订")
    if day <= latest.valid_from:
        raise ItemError(
            f"生效日须晚于当前版本的开始日 {latest.valid_from.isoformat()}", "effective_date"
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
    # 第 2 步补：停用前若仍有在用服务单元依赖该院区，阻止并列出（设计文档第 5 节阻止规则）。
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
        raise ItemError(f"主体 {inst.code} 在 {item.valid_from} 尚未生效", "valid_from")
    campus_v = _version_on(s, CampusVersion, CampusVersion.campus_id, campus.id, item.valid_from)
    if campus_v is None:
        raise ItemError(f"院区 {campus.code} 在 {item.valid_from} 尚未生效", "valid_from")
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
    # 第 2 步补：若仍有在用服务单元依赖该运营关系，阻止并列出（设计文档第 5 节阻止规则）。
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


HANDLERS = {
    "institution.create": _institution_create,
    "institution.revise": _institution_revise,
    "campus.create": _campus_create,
    "campus.revise": _campus_revise,
    "campus.change_status": _campus_change_status,
    "operator_relation.create": _relation_create,
    "operator_relation.close": _relation_close,
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
    return outcomes


def dry_run(session: Session, items: list[ChangeItem], change_id: int, user_id: int) -> list[dict]:
    """在 SAVEPOINT 里执行一遍再回滚：用于提交前校验和确认页差异。"""
    savepoint = session.begin_nested()
    try:
        return apply_items(session, items, change_id, user_id)
    finally:
        savepoint.rollback()
