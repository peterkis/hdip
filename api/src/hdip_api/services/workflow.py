"""变更申请流：草稿 → 已提交 → 已确认 / 已退回；草稿和已提交可由创建人撤销。

- 提交与确认是两次独立动作，各自记录人和时间；不提供“创建即生效”的捷径。
- 提交时预演一遍，不通过不能提交；确认时在同一事务里重新校验并真正写入，不通过不能确认。
- 谁能确认由 approval_rule 决定（按 对象类型 × 动作）；一张申请含多类变更时须同时满足。
"""

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, Forbidden, NotFound
from hdip_api.core.permissions import (
    CHANGE_CREATE,
    PERSON_CHANGE,
    can_see_items,
    require_permission,
)
from hdip_api.models import ApprovalRule, AppUser, ChangeRequest
from hdip_api.schemas.items import ITEMS_ADAPTER, ChangeItem, dump_items
from hdip_api.services.apply import apply_items, dry_run

ROLE_LABELS = {"maintainer": "维护人", "confirmer": "确认人", "viewer": "只读"}
STATUS_LABELS = {
    "draft": "草稿",
    "submitted": "已提交",
    "confirmed": "已确认",
    "returned": "已退回",
    "cancelled": "已撤销",
}


def parse_items(cr: ChangeRequest) -> list[ChangeItem]:
    return ITEMS_ADAPTER.validate_python(cr.items)


def _now(s: Session):
    return s.scalar(select(func.localtimestamp()))


def visible(cr: ChangeRequest, user: AppUser) -> bool:
    """含人员变更项的申请对没有“查看人员”权限的人整张隐藏（按号打开也说不存在）。"""
    return can_see_items(user, (i.get("kind", "") for i in cr.items))


def get_for_update(s: Session, change_id: int, user: AppUser | None = None) -> ChangeRequest:
    cr = s.get(ChangeRequest, change_id, with_for_update=True)
    if cr is None or (user is not None and not visible(cr, user)):
        raise NotFound(f"变更申请 #{change_id} 不存在")
    return cr


def _require_item_permissions(user: AppUser, items: list[dict]) -> None:
    """人员变更项另需“维护人员”权限（以后可只给部分维护人）。"""
    if any(i.get("kind", "").startswith("person.") for i in items):
        require_permission(user, PERSON_CHANGE)


def _require_status(cr: ChangeRequest, *statuses: str) -> None:
    if cr.status not in statuses:
        raise BusinessError(f"当前状态为“{STATUS_LABELS[cr.status]}”，不能执行此操作", 409)


def _require_creator(cr: ChangeRequest, user: AppUser) -> None:
    if cr.created_by != user.id:
        raise Forbidden("只有创建人可以执行此操作")


# ------------------------------------------------------------------ 确认权限
def _rules_for(s: Session, cr: ChangeRequest) -> list[tuple[str, ApprovalRule | None]]:
    kinds = sorted({i["kind"] for i in cr.items})
    rules = {f"{r.object_type}.{r.action}": r for r in s.scalars(select(ApprovalRule)).all()}
    return [(kind, rules.get(kind)) for kind in kinds]


def confirm_block_reason(s: Session, cr: ChangeRequest, user: AppUser) -> str | None:
    """返回 None 表示该用户可以确认；否则返回原因。"""
    if cr.status != "submitted":
        return "只有已提交的申请可以确认"
    for _kind, rule in _rules_for(s, cr):
        role = rule.confirmer_role if rule else "confirmer"
        if role not in user.roles:
            return f"需要{ROLE_LABELS[role]}角色才能确认"
        allow_self = rule.allow_self_confirm if rule else True
        if not allow_self and cr.submitted_by == user.id:
            return "该类变更不允许提交人自己确认，请由其他确认人确认"
    return None


def return_block_reason(s: Session, cr: ChangeRequest, user: AppUser) -> str | None:
    """退回与确认看同一份 approval_rule：有权确认该类变更的角色才能退回（不受自确认开关限制）。"""
    if cr.status != "submitted":
        return "只有已提交的申请可以退回"
    for _kind, rule in _rules_for(s, cr):
        role = rule.confirmer_role if rule else "confirmer"
        if role not in user.roles:
            return f"需要{ROLE_LABELS[role]}角色才能退回"
    return None


# ------------------------------------------------------------------ 新建代码的持有
def created_codes(items: list[dict]) -> list[str]:
    """一张申请里要新建的院区、部门、服务单元、人员代码（含拆分 / 合并的后继）。"""
    out: list[str] = []
    for i in items:
        k = i.get("kind")
        if k in ("campus.create", "department.create", "service_unit.create", "person.create"):
            out.append(i["code"])
        elif k == "service_unit.split":
            out += [x["code"] for x in i.get("successors", [])]
        elif k == "service_unit.merge":
            out.append(i["successor"]["code"])
    return out


def _check_code_holders(s: Session, items: list[dict], self_id: int | None) -> None:
    """同一个预留代码同时只能由一张进行中的申请（草稿 / 已提交）用来新建，避免并行重复办理。"""
    mine = set(created_codes(items))
    if not mine:
        return
    others = s.scalars(
        select(ChangeRequest).where(
            ChangeRequest.status.in_(("draft", "submitted")),
            *([ChangeRequest.id != self_id] if self_id else []),
        )
    )
    for other in others:
        clash = sorted(mine & set(created_codes(other.items)))
        if clash:
            raise BusinessError(
                f"代码 {'、'.join(clash)} 已在申请 #{other.id}"
                f"（{STATUS_LABELS[other.status]}）里用于新建。"
                f"同一个代码同时只能由一张进行中的申请使用：请到申请 #{other.id} 继续处理。"
            )


# ------------------------------------------------------------------ 动作
def create_draft(
    s: Session, user: AppUser, items: list[ChangeItem], note: str | None
) -> ChangeRequest:
    require_permission(user, CHANGE_CREATE)
    dumped = dump_items(items)
    _require_item_permissions(user, dumped)
    _check_code_holders(s, dumped, None)
    cr = ChangeRequest(items=dumped, note=_clean(note), created_by=user.id)
    s.add(cr)
    s.flush()
    return cr


def update_draft(
    s: Session, user: AppUser, change_id: int, items: list[ChangeItem], note: str | None
) -> ChangeRequest:
    cr = get_for_update(s, change_id, user)
    _require_status(cr, "draft")
    _require_creator(cr, user)
    # 组织变更是一个整体：含组织变更事件的草稿，不能只留下它的部分变更项（会拆散原子变更）
    had_reorg = any(i.get("kind") == "department.reorganize" for i in cr.items)
    if had_reorg and not any(i.kind == "department.reorganize" for i in items):
        raise BusinessError(
            "这张草稿是一次部门组织变更，不能去掉组织变更事件而保留其他变更项。"
            "请回到组织变更向导调整；不再需要时，撤销整张草稿。"
        )
    dumped = dump_items(items)
    _require_item_permissions(user, dumped)
    _check_code_holders(s, dumped, cr.id)
    cr.items = dumped
    cr.note = _clean(note)
    cr.updated_at = _now(s)
    s.flush()
    return cr


def submit(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    cr = get_for_update(s, change_id, user)
    _require_status(cr, "draft")
    _require_creator(cr, user)
    require_permission(user, CHANGE_CREATE)
    _require_item_permissions(user, cr.items)
    dry_run(s, parse_items(cr), cr.id, user.id)  # 不通过即抛错
    now = _now(s)
    cr.status, cr.submitted_by, cr.submitted_at, cr.updated_at = "submitted", user.id, now, now
    s.flush()
    return cr


# 所有确认串行执行：两张申请（如“撤销部门”与“把人调入该部门”）各自通过最终检查、合起来却不成立，
# 靠这把事务级咨询锁避免。确认是低频动作，代价可忽略
CONFIRM_LOCK = 0x48444950  # "HDIP"


def confirm(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    s.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": CONFIRM_LOCK})
    cr = get_for_update(s, change_id, user)
    _require_status(cr, "submitted")
    reason = confirm_block_reason(s, cr, user)
    if reason:
        raise Forbidden(reason)
    savepoint = s.begin_nested()
    try:
        outcomes = apply_items(s, parse_items(cr), cr.id, user.id)
    except BusinessError:
        savepoint.rollback()
        raise
    savepoint.commit()
    now = _now(s)
    cr.status, cr.confirmed_by, cr.confirmed_at, cr.updated_at = "confirmed", user.id, now, now
    cr.results = outcomes
    s.flush()
    return cr


def return_request(s: Session, user: AppUser, change_id: int, reason: str) -> ChangeRequest:
    cr = get_for_update(s, change_id, user)
    _require_status(cr, "submitted")
    reason_blocked = return_block_reason(s, cr, user)
    if reason_blocked:
        raise Forbidden(reason_blocked)
    reason = (reason or "").strip()
    if not reason:
        raise BusinessError("退回必须写原因")
    now = _now(s)
    cr.status, cr.returned_by, cr.returned_at, cr.return_reason = "returned", user.id, now, reason
    cr.updated_at = now
    s.flush()
    return cr


def cancel(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    cr = get_for_update(s, change_id, user)
    _require_status(cr, "draft", "submitted")
    _require_creator(cr, user)
    now = _now(s)
    cr.status, cr.cancelled_by, cr.cancelled_at, cr.updated_at = "cancelled", user.id, now, now
    s.flush()
    return cr


def copy_as_draft(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    require_permission(user, CHANGE_CREATE)
    src = s.get(ChangeRequest, change_id)
    if src is None or not visible(src, user):
        raise NotFound(f"变更申请 #{change_id} 不存在")
    _require_status(src, "returned", "cancelled")
    _require_item_permissions(user, src.items)
    # 退回 / 撤销后复制 = 继续办理原拟建对象，沿用其预留代码；已有一份进行中的副本时拒绝
    _check_code_holders(s, src.items, None)
    cr = ChangeRequest(items=src.items, note=src.note, created_by=user.id, copied_from_id=src.id)
    s.add(cr)
    s.flush()
    return cr


def _clean(note: str | None) -> str | None:
    note = (note or "").strip()
    return note or None
