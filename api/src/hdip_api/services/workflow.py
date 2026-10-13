"""变更申请流：草稿 → 已提交 → 已确认 / 已退回；草稿和已提交可由创建人撤销。

- 提交与确认是两次独立动作，各自记录人和时间；不提供“创建即生效”的捷径。
- 提交时预演一遍，不通过不能提交；确认时在同一事务里重新校验并真正写入，不通过不能确认。
- 谁能确认由 approval_rule 决定（按 对象类型 × 动作）；一张申请含多类变更时须同时满足。
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError, Forbidden, NotFound
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


def _require_role(user: AppUser, role: str) -> None:
    if role not in user.roles:
        raise Forbidden(f"需要{ROLE_LABELS[role]}角色")


def get_for_update(s: Session, change_id: int) -> ChangeRequest:
    cr = s.get(ChangeRequest, change_id, with_for_update=True)
    if cr is None:
        raise NotFound(f"变更申请 #{change_id} 不存在")
    return cr


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


# ------------------------------------------------------------------ 动作
def create_draft(
    s: Session, user: AppUser, items: list[ChangeItem], note: str | None
) -> ChangeRequest:
    _require_role(user, "maintainer")
    cr = ChangeRequest(items=dump_items(items), note=_clean(note), created_by=user.id)
    s.add(cr)
    s.flush()
    return cr


def update_draft(
    s: Session, user: AppUser, change_id: int, items: list[ChangeItem], note: str | None
) -> ChangeRequest:
    cr = get_for_update(s, change_id)
    _require_status(cr, "draft")
    _require_creator(cr, user)
    cr.items = dump_items(items)
    cr.note = _clean(note)
    cr.updated_at = _now(s)
    s.flush()
    return cr


def submit(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    cr = get_for_update(s, change_id)
    _require_status(cr, "draft")
    _require_creator(cr, user)
    _require_role(user, "maintainer")
    dry_run(s, parse_items(cr), cr.id, user.id)  # 不通过即抛错
    now = _now(s)
    cr.status, cr.submitted_by, cr.submitted_at, cr.updated_at = "submitted", user.id, now, now
    s.flush()
    return cr


def confirm(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    cr = get_for_update(s, change_id)
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
    cr = get_for_update(s, change_id)
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
    cr = get_for_update(s, change_id)
    _require_status(cr, "draft", "submitted")
    _require_creator(cr, user)
    now = _now(s)
    cr.status, cr.cancelled_by, cr.cancelled_at, cr.updated_at = "cancelled", user.id, now, now
    s.flush()
    return cr


def copy_as_draft(s: Session, user: AppUser, change_id: int) -> ChangeRequest:
    _require_role(user, "maintainer")
    src = s.get(ChangeRequest, change_id)
    if src is None:
        raise NotFound(f"变更申请 #{change_id} 不存在")
    _require_status(src, "returned", "cancelled")
    cr = ChangeRequest(items=src.items, note=src.note, created_by=user.id, copied_from_id=src.id)
    s.add(cr)
    s.flush()
    return cr


def _clean(note: str | None) -> str | None:
    note = (note or "").strip()
    return note or None
