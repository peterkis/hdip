"""配置字典的维护（分类方案的代码）。

这是配置而不是业务数据：有“维护分类字典”权限（维护人角色）即可直接维护，不经变更申请、不需确认，
记录维护人与时间；代码值不可改，不删除只停用（数据库触发器保证）。部门上的分类“赋值”仍经变更申请。
"""

from typing import Annotated

from fastapi import APIRouter, Path
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES, BusinessError, NotFound
from hdip_api.core.permissions import DICTIONARY_MAINTAIN, require_permission
from hdip_api.models import ClassificationCode, ClassificationScheme
from hdip_api.schemas.read import (
    ClassificationCodeCreate,
    ClassificationCodeWrite,
    ClassificationSchemeOut,
)
from hdip_api.services import queries

router = APIRouter(prefix="/dictionary", tags=["dictionary"], responses=ERROR_RESPONSES)

CODE_RE = r"^[A-Z][A-Z0-9_]{0,63}$"


def _scheme_out(session, scheme_id: int) -> ClassificationSchemeOut:
    return next(x for x in queries.list_classification_schemes(session) if x.id == scheme_id)


@router.post(
    "/classification-schemes/{scheme_code}/codes",
    response_model=ClassificationSchemeOut,
    operation_id="createClassificationCode",
)
def create_code(
    session: SessionDep,
    user: CurrentUser,
    scheme_code: Annotated[str, Path(pattern=CODE_RE)],
    body: ClassificationCodeCreate,
):
    """在方案里新增一个代码。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    scheme = session.scalar(
        select(ClassificationScheme).where(ClassificationScheme.code == scheme_code)
    )
    if scheme is None:
        raise NotFound(f"分类方案 {scheme_code} 不存在")
    if not body.name.strip():
        raise BusinessError("名称不能为空")
    session.add(
        ClassificationCode(
            scheme_id=scheme.id,
            code=body.code.strip().upper(),
            name=body.name.strip(),
            criterion=(body.criterion or "").strip() or None,
            caution=(body.caution or "").strip() or None,
            sort_order=body.sort_order,
            is_active=True,
            updated_by=user.id,
        )
    )
    try:
        session.flush()
    except IntegrityError as e:
        session.rollback()
        name = getattr(getattr(e.orig, "diag", None), "constraint_name", "")
        if name == "classification_code_uniq":
            raise BusinessError("该方案里已有这个代码") from None
        if name == "classification_code_code_check":
            raise BusinessError("代码只能用大写字母、数字、下划线，且以字母开头") from None
        raise
    session.commit()
    return _scheme_out(session, scheme.id)


@router.patch(
    "/classification-codes/{code_id}",
    response_model=ClassificationSchemeOut,
    operation_id="updateClassificationCode",
)
def update_code(
    session: SessionDep, user: CurrentUser, code_id: int, body: ClassificationCodeWrite
):
    """修改代码的名称、判断依据、防误判提示、排序，或停用 / 恢复。代码值本身不可改。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    c = session.get(ClassificationCode, code_id, with_for_update=True)
    if c is None:
        raise NotFound("分类代码不存在")
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and not (patch["name"] or "").strip():
        raise BusinessError("名称不能为空")
    for k, v in patch.items():
        if isinstance(v, str):
            v = v.strip() or None  # 空文本即清空（名称已在上面拒绝为空）
        setattr(c, k, v)
    c.updated_by = user.id
    c.updated_at = session.scalar(select(func.localtimestamp()))
    session.commit()
    return _scheme_out(session, c.scheme_id)
