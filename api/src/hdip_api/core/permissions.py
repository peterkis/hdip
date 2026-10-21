"""权限键。调用处只问“有没有某个权限”，不直接判断角色；角色 → 权限键的映射集中在这里。

本期沿用 app_user.roles 的三个角色。以后细化权限时，把 ROLE_PERMISSIONS 换成表（如 role_permission）
或按对象范围授权，调用处不变。变更申请的确认权限另由 approval_rule 按“对象类型 × 动作”配置。
"""

from collections.abc import Iterable

from hdip_api.core.errors import Forbidden
from hdip_api.models import AppUser

# 权限键
CHANGE_CREATE = "change.create"  # 创建、编辑、提交、撤销、复制自己的变更申请
DICTIONARY_MAINTAIN = "dictionary.maintain"  # 直接维护分类方案与代码等配置字典（不经变更申请）
# 人员模块（人员设计第 8 节）：可见、敏感字段、导出、发起分开判断，以后细分权限只改下面的映射
PERSON_VIEW = "person.view"  # 看到人员模块：名册、详情、部门的人员区块、含人员变更项的申请
PERSON_VIEW_SENSITIVE = "person.view_sensitive"  # 看到敏感字段（PERSON_FIELD_PERMISSIONS）
PERSON_EXPORT = "person.export"  # 导出人员数据集
PERSON_CHANGE = "person.change"  # 发起、编辑、提交含人员变更项的申请；确认仍按 approval_rule

_PERSON_READ = {PERSON_VIEW, PERSON_VIEW_SENSITIVE, PERSON_EXPORT}
# P1 与组织模块等价：三个角色都能看，维护人能发起
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "maintainer": {CHANGE_CREATE, DICTIONARY_MAINTAIN, PERSON_CHANGE, *_PERSON_READ},
    "confirmer": set(_PERSON_READ),
    "viewer": set(_PERSON_READ),
}

PERMISSION_LABELS = {
    CHANGE_CREATE: "维护变更申请",
    DICTIONARY_MAINTAIN: "维护分类字典",
    PERSON_VIEW: "查看人员",
    PERSON_VIEW_SENSITIVE: "查看人员敏感信息",
    PERSON_EXPORT: "导出人员数据",
    PERSON_CHANGE: "维护人员",
}

# 敏感字段 → 查看所需的权限键。读接口、导出、申请页都按这里统一隐去（值置空并列入 masked_fields）。
# 工号不是敏感字段（2026-10-21 Peter）；身份证号、联系电话等将来加入时在这里登记一行。
PERSON_FIELD_PERMISSIONS: dict[str, str] = {}


def permissions_of(user: AppUser) -> set[str]:
    return set().union(*(ROLE_PERMISSIONS.get(r, set()) for r in user.roles))


def has_permission(user: AppUser, key: str) -> bool:
    return key in permissions_of(user)


def require_permission(user: AppUser, key: str) -> None:
    if not has_permission(user, key):
        raise Forbidden(f"没有“{PERMISSION_LABELS.get(key, key)}”的权限")


def masked_fields(user: AppUser, fields: Iterable[str]) -> set[str]:
    """fields 里当前用户无权查看的敏感字段。"""
    have = permissions_of(user)
    return {f for f in fields if (key := PERSON_FIELD_PERMISSIONS.get(f)) and key not in have}


def can_see_items(user: AppUser, kinds: Iterable[str]) -> bool:
    """含人员变更项的申请，只对有“查看人员”权限的人可见（整张隐藏）。"""
    return has_permission(user, PERSON_VIEW) or not any(k.startswith("person.") for k in kinds)
