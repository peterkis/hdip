"""敏感字段在申请页与派生文字里的统一隐去（人员设计第 10.3 节待办，2026-10-24）。

读接口与导出按 PERSON_FIELD_PERMISSIONS 在取值处置空；申请的变更项、前后内容是原样 JSON，
一句话说明、行内片段、提示、问题又是由这些值拼成的文字。所以分两步：
1. 结构化内容：键名是敏感字段（或以 _字段名 结尾，如 expected_work_no）的值置空；
2. 文字：把敏感值在所有字符串里替换为“（已隐去）”。敏感值取自本申请的结构化内容，
   以及人员各表里同名列的全部取值（文字可能只带值、不带键，如“工号 S2019001 止于…”；
   以后在人员表上加身份证号、电话列并登记到 PERSON_FIELD_PERMISSIONS，这里自动覆盖）。
"""

import re
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.permissions import PERSON_FIELD_PERMISSIONS, masked_fields
from hdip_api.models import (
    AppUser,
    Person,
    PersonAssignment,
    PersonDuty,
    PersonEngagement,
    PersonVersion,
    PersonWorkNo,
)

MASK = "（已隐去）"
# 文字里只替换完整的一段（前后不是字母数字），不会改到 P000007、D000101 这类代码里的片段。
# 本申请自己带的敏感值从 4 位起替换；从人员表里查来的值（与本申请无关的人也在内）从 6 位起，
# 免得短值误伤日期等。身份证号（18 位）、电话（11 位）都远长于此
_MIN_OWN = 4
_MIN_STORED = 6
_PERSON_TABLES = (
    Person,
    PersonVersion,
    PersonEngagement,
    PersonWorkNo,
    PersonAssignment,
    PersonDuty,
)


def hidden_fields(user: AppUser) -> set[str]:
    return masked_fields(user, PERSON_FIELD_PERMISSIONS)


def _is_sensitive(key: str, hidden: set[str]) -> bool:
    return any(key == f or key.endswith(f"_{f}") for f in hidden)


def sensitive_values(data: Any, hidden: set[str], min_len: int = _MIN_OWN) -> set[str]:
    """data 里敏感键的取值（非空、不短于 min_len），用于在文字里替换。"""
    out: set[str] = set()
    if not hidden:
        return out

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                if _is_sensitive(k, hidden) and v not in (None, ""):
                    out.add(str(v))
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(data)
    return {v for v in out if len(v) >= min_len}


def stored_values(s: Session, hidden: set[str]) -> set[str]:
    """人员各表里与敏感字段同名的列的全部取值。"""
    out: set[str] = set()
    for f in hidden:
        for model in _PERSON_TABLES:
            column = getattr(model, f, None)
            if column is not None:
                out.update(str(v) for v in s.scalars(select(column).distinct()) if v)
    return {v for v in out if len(v) >= _MIN_STORED}


def mask(data: Any, hidden: set[str], values: Iterable[str]) -> Any:
    """返回隐去后的副本：敏感键置空，字符串里出现的敏感值替换为 MASK。"""
    if not hidden:
        return data
    ordered = sorted(set(values), key=len, reverse=True)
    pattern = (
        re.compile(r"(?<![0-9A-Za-z])(?:" + "|".join(map(re.escape, ordered)) + r")(?![0-9A-Za-z])")
        if ordered
        else None
    )

    def text(s: str) -> str:
        return pattern.sub(MASK, s) if pattern else s

    def walk(x: Any) -> Any:
        if isinstance(x, dict):
            return {k: None if _is_sensitive(k, hidden) else walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        if isinstance(x, str):
            return text(x)
        return x

    return walk(data)


def mask_change(s: Session, payload: dict, user: AppUser) -> dict:
    """整张申请的响应：变更项、前后内容、说明、片段、提示、问题一并处理。

    masked_fields 列出本申请里确实隐去了的字段（申请不涉及敏感值时为空）。"""
    hidden = hidden_fields(user)
    own = sensitive_values([payload.get("items"), payload.get("outcomes")], hidden)
    values = own | stored_values(s, hidden)
    masked = mask(payload, hidden, values)
    if not (own or masked != payload):
        return payload | {"masked_fields": []}
    # 页面拿到的是隐去后的内容，不能据此编辑（workflow.update_draft 同样拒绝）
    perms = (masked.get("permissions") or {}) | {"can_edit": False}
    return masked | {"masked_fields": sorted(hidden), "permissions": perms}
