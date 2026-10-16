"""配置字典的维护（分类方案与代码、来源系统与字典）。

这是配置而不是业务数据：有“维护分类字典”权限（维护人角色）即可直接维护，不经变更申请、不需确认，
记录维护人与时间；代码值不可改，不删除只停用（数据库触发器保证）。部门上的分类“赋值”仍经变更申请。
"""

import re
from typing import Annotated

from fastapi import APIRouter, Path
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES, BusinessError, NotFound
from hdip_api.core.permissions import DICTIONARY_MAINTAIN, require_permission
from hdip_api.models import ClassificationCode, ClassificationScheme, CodeNamespace, SourceSystem
from hdip_api.schemas.read import (
    ClassificationCodeCreate,
    ClassificationCodeWrite,
    ClassificationSchemeCreate,
    ClassificationSchemeOut,
    ClassificationSchemeWrite,
    NamespaceWrite,
    SourceSystemOut,
    SourceSystemWrite,
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
            code=body.code.strip(),
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
            raise BusinessError(
                "代码只能包含字母、数字、点、下划线、短横线，且以字母或数字开头"
            ) from None
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


def _clean(patch: dict) -> dict:
    """文本去首尾空白，空文本即清空。"""
    return {k: ((v.strip() or None) if isinstance(v, str) else v) for k, v in patch.items()}


def _now(session):
    return session.scalar(select(func.localtimestamp()))


def _flush(session, messages: dict[str, str]) -> None:
    try:
        session.flush()
    except IntegrityError as e:
        session.rollback()
        name = getattr(getattr(e.orig, "diag", None), "constraint_name", "")
        if name in messages:
            raise BusinessError(messages[name]) from None
        raise


CODE_MESSAGES = {
    "classification_scheme_code_uniq": "已有这个方案代码",
    "source_system_code_uniq": "已有这个来源系统代码",
    "source_system_code_check": "代码只能用大写字母、数字、下划线，且以字母开头",
    "source_system_kind_check": "系统类别只能是 HIS、MEDICAL_RECORD、INTEROP、OTHER",
    "source_system_name_check": "名称不能为空",
    "code_namespace_code_uniq": "该系统里已有这个字典代码",
    "code_namespace_code_check": "代码只能用大写字母、数字、下划线，且以字母开头",
    "code_namespace_name_check": "名称不能为空",
}


@router.post(
    "/classification-schemes",
    response_model=ClassificationSchemeOut,
    operation_id="createClassificationScheme",
)
def create_scheme(session: SessionDep, user: CurrentUser, body: ClassificationSchemeCreate):
    """登记一个分类方案（如外部分类体系）。用在部门 / 服务单元上的含义为空表示不适用。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    data = _clean(body.model_dump())
    if not data["name"] or not data["version"]:
        raise BusinessError("名称与版本不能为空")
    if not re.fullmatch(CODE_RE, data["code"] or ""):
        raise BusinessError("方案代码只能用大写字母、数字、下划线，且以字母开头")
    scheme = ClassificationScheme(**data, is_active=True, updated_by=user.id)
    session.add(scheme)
    _flush(session, CODE_MESSAGES)
    session.commit()
    return _scheme_out(session, scheme.id)


@router.patch(
    "/classification-schemes/{scheme_code}",
    response_model=ClassificationSchemeOut,
    operation_id="updateClassificationScheme",
)
def update_scheme(
    session: SessionDep,
    user: CurrentUser,
    scheme_code: Annotated[str, Path(pattern=CODE_RE)],
    body: ClassificationSchemeWrite,
):
    """修改方案名称、用途、用于部门 / 单元时的含义，或停用 / 恢复。代码与单选属性不可改。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    scheme = session.scalar(
        select(ClassificationScheme)
        .where(ClassificationScheme.code == scheme_code)
        .with_for_update()
    )
    if scheme is None:
        raise NotFound(f"分类方案 {scheme_code} 不存在")
    patch = _clean(body.model_dump(exclude_unset=True))
    if "name" in patch and not patch["name"]:
        raise BusinessError("名称不能为空")
    for k, v in patch.items():
        setattr(scheme, k, v)
    scheme.updated_by, scheme.updated_at = user.id, _now(session)
    session.commit()
    return _scheme_out(session, scheme.id)


def _system_out(session, system_id: int) -> SourceSystemOut:
    day = session.scalar(select(func.current_date()))
    return next(x for x in queries.list_source_systems(session, day) if x.id == system_id)


@router.post("/source-systems", response_model=SourceSystemOut, operation_id="createSourceSystem")
def create_source_system(session: SessionDep, user: CurrentUser, body: SourceSystemWrite):
    """登记一个来源系统实例。同一厂商的多个实例（如各院区账套）分别登记。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    data = _clean(body.model_dump(exclude_unset=True))
    if not data.get("code") or not data.get("name") or not data.get("kind"):
        raise BusinessError("代码、名称、系统类别不能为空")
    data.pop("is_active", None)
    system = SourceSystem(**data, is_active=True, updated_by=user.id)
    session.add(system)
    _flush(session, CODE_MESSAGES)
    session.commit()
    return _system_out(session, system.id)


@router.patch(
    "/source-systems/{system_id}", response_model=SourceSystemOut, operation_id="updateSourceSystem"
)
def update_source_system(
    session: SessionDep, user: CurrentUser, system_id: int, body: SourceSystemWrite
):
    require_permission(user, DICTIONARY_MAINTAIN)
    system = session.get(SourceSystem, system_id, with_for_update=True)
    if system is None:
        raise NotFound("来源系统不存在")
    patch = _clean(body.model_dump(exclude_unset=True))
    if "code" in patch and patch["code"] != system.code:
        raise BusinessError("代码新建后不可改")
    patch.pop("code", None)
    if "name" in patch and not patch["name"]:
        raise BusinessError("名称不能为空")
    for k, v in patch.items():
        setattr(system, k, v)
    system.updated_by, system.updated_at = user.id, _now(session)
    _flush(session, CODE_MESSAGES)
    session.commit()
    return _system_out(session, system.id)


@router.post(
    "/source-systems/{system_id}/namespaces",
    response_model=SourceSystemOut,
    operation_id="createCodeNamespace",
)
def create_namespace(session: SessionDep, user: CurrentUser, system_id: int, body: NamespaceWrite):
    """在来源系统里登记一本字典。字典不限定只能映射到某一种对象，混装字典逐条判断。"""
    require_permission(user, DICTIONARY_MAINTAIN)
    if session.get(SourceSystem, system_id) is None:
        raise NotFound("来源系统不存在")
    data = _clean(body.model_dump(exclude_unset=True))
    if not data.get("code") or not data.get("name"):
        raise BusinessError("代码与名称不能为空")
    data.pop("is_active", None)
    session.add(
        CodeNamespace(**data, source_system_id=system_id, is_active=True, updated_by=user.id)
    )
    _flush(session, CODE_MESSAGES)
    session.commit()
    return _system_out(session, system_id)


@router.patch(
    "/code-namespaces/{namespace_id}",
    response_model=SourceSystemOut,
    operation_id="updateCodeNamespace",
)
def update_namespace(
    session: SessionDep, user: CurrentUser, namespace_id: int, body: NamespaceWrite
):
    require_permission(user, DICTIONARY_MAINTAIN)
    ns = session.get(CodeNamespace, namespace_id, with_for_update=True)
    if ns is None:
        raise NotFound("字典不存在")
    patch = _clean(body.model_dump(exclude_unset=True))
    if "code" in patch and patch["code"] != ns.code:
        raise BusinessError("代码新建后不可改")
    patch.pop("code", None)
    if "name" in patch and not patch["name"]:
        raise BusinessError("名称不能为空")
    for k, v in patch.items():
        setattr(ns, k, v)
    ns.updated_by, ns.updated_at = user.id, _now(session)
    session.commit()
    return _system_out(session, ns.source_system_id)
