"""变更申请：唯一的写入入口。每个动作一次事务，成功才提交。"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES, BusinessError, ProblemItem
from hdip_api.models import ChangeRequest
from hdip_api.schemas.items import dump_items
from hdip_api.schemas.read import (
    ChangeRequestOut,
    ChangeRequestSummary,
    ChangeRequestWrite,
    ReturnBody,
)
from hdip_api.services import queries, workflow
from hdip_api.services.masking import (
    hidden_fields,
    mask,
    mask_change,
    sensitive_values,
    stored_values,
)

router = APIRouter(prefix="/change-requests", tags=["changes"], responses=ERROR_RESPONSES)


def _out(session, out: ChangeRequestOut, user) -> JSONResponse:
    """变更项只返回填写过的字段，与存库一致。

    否则修订项里没改的字段会以 null 返回；前端把草稿原样回传（如再加一项）时，
    null 会被当成“清空”。当前用户无权查看的敏感字段统一隐去（services/masking.py）。
    """
    payload = out.model_dump(mode="json") | {"items": dump_items(out.items)}
    return JSONResponse(mask_change(session, payload, user))


def _done(session, cr_id: int, user) -> JSONResponse:
    session.commit()
    return _out(session, queries.get_change(session, cr_id, user), user)


@contextmanager
def _masked_errors(session, user, change_id: int) -> Iterator[None]:
    """被拒时的说明与问题同样隐去当前用户无权查看的敏感值（与 _out 同一规则）。"""
    try:
        yield
    except BusinessError as e:
        hidden = hidden_fields(user)
        if hidden:
            session.rollback()
            cr = session.get(ChangeRequest, change_id)
            values = stored_values(session, hidden)
            if cr is not None:
                values |= sensitive_values(cr.items, hidden)
            e.message = mask(e.message, hidden, values)
            e.problems = [
                ProblemItem.model_validate(mask(p.model_dump(mode="json"), hidden, values))
                for p in e.problems
            ]
        raise


@router.get("", response_model=list[ChangeRequestSummary], operation_id="listChangeRequests")
def list_changes(
    session: SessionDep,
    user: CurrentUser,
    status: Literal["draft", "submitted", "confirmed", "returned", "cancelled"] | None = None,
):
    return queries.list_changes(session, status, user)


@router.post("", response_model=ChangeRequestOut, operation_id="createChangeRequest")
def create_change(session: SessionDep, user: CurrentUser, body: ChangeRequestWrite):
    cr = workflow.create_draft(session, user, body.items, body.note, body.request_key)
    return _done(session, cr.id, user)


@router.get("/{change_id}", response_model=ChangeRequestOut, operation_id="getChangeRequest")
def get_change(session: SessionDep, user: CurrentUser, change_id: int):
    return _out(session, queries.get_change(session, change_id, user), user)


@router.put("/{change_id}", response_model=ChangeRequestOut, operation_id="updateChangeRequest")
def update_change(session: SessionDep, user: CurrentUser, change_id: int, body: ChangeRequestWrite):
    with _masked_errors(session, user, change_id):
        workflow.update_draft(
            session,
            user,
            change_id,
            body.items,
            body.note,
            body.request_key,
            body.expected_updated_at,
        )
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/submit", response_model=ChangeRequestOut, operation_id="submitChangeRequest"
)
def submit(session: SessionDep, user: CurrentUser, change_id: int):
    with _masked_errors(session, user, change_id):
        workflow.submit(session, user, change_id)
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/confirm", response_model=ChangeRequestOut, operation_id="confirmChangeRequest"
)
def confirm(session: SessionDep, user: CurrentUser, change_id: int):
    with _masked_errors(session, user, change_id):
        workflow.confirm(session, user, change_id)
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/return", response_model=ChangeRequestOut, operation_id="returnChangeRequest"
)
def return_change(session: SessionDep, user: CurrentUser, change_id: int, body: ReturnBody):
    workflow.return_request(session, user, change_id, body.reason)
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/cancel", response_model=ChangeRequestOut, operation_id="cancelChangeRequest"
)
def cancel(session: SessionDep, user: CurrentUser, change_id: int):
    workflow.cancel(session, user, change_id)
    return _done(session, change_id, user)


@router.post("/{change_id}/copy", response_model=ChangeRequestOut, operation_id="copyChangeRequest")
def copy(session: SessionDep, user: CurrentUser, change_id: int):
    """把已退回或已撤销的申请复制为新草稿（原申请保持不变）。"""
    cr = workflow.copy_as_draft(session, user, change_id)
    return _done(session, cr.id, user)
