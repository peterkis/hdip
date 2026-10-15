"""权限键。调用处只问“有没有某个权限”，不直接判断角色；角色 → 权限键的映射集中在这里。

本期沿用 app_user.roles 的三个角色。以后细化权限时，把 ROLE_PERMISSIONS 换成表（如 role_permission）
或按对象范围授权，调用处不变。变更申请的确认权限另由 approval_rule 按“对象类型 × 动作”配置。
"""

from hdip_api.core.errors import Forbidden
from hdip_api.models import AppUser

# 权限键
CHANGE_CREATE = "change.create"  # 创建、编辑、提交、撤销、复制自己的变更申请
DICTIONARY_MAINTAIN = "dictionary.maintain"  # 直接维护分类方案与代码等配置字典（不经变更申请）

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "maintainer": {CHANGE_CREATE, DICTIONARY_MAINTAIN},
    "confirmer": set(),
    "viewer": set(),
}

PERMISSION_LABELS = {CHANGE_CREATE: "维护变更申请", DICTIONARY_MAINTAIN: "维护分类字典"}


def permissions_of(user: AppUser) -> set[str]:
    return set().union(*(ROLE_PERMISSIONS.get(r, set()) for r in user.roles))


def has_permission(user: AppUser, key: str) -> bool:
    return key in permissions_of(user)


def require_permission(user: AppUser, key: str) -> None:
    if not has_permission(user, key):
        raise Forbidden(f"没有“{PERMISSION_LABELS.get(key, key)}”的权限")
