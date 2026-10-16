"""变更申请：唯一的写入入口。每个动作一次事务，成功才提交。"""

from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.schemas.items import dump_items
from hdip_api.schemas.read import (
    ChangeRequestOut,
    ChangeRequestSummary,
    ChangeRequestWrite,
    ReturnBody,
)
from hdip_api.services import queries, workflow

router = APIRouter(prefix="/change-requests", tags=["changes"], responses=ERROR_RESPONSES)


def _out(out: ChangeRequestOut) -> JSONResponse:
    """变更项只返回填写过的字段，与存库一致。

    否则修订项里没改的字段会以 null 返回；前端把草稿原样回传（如再加一项）时，
    null 会被当成“清空”。
    """
    return JSONResponse(out.model_dump(mode="json") | {"items": dump_items(out.items)})


def _done(session, cr_id: int, user) -> JSONResponse:
    session.commit()
    return _out(queries.get_change(session, cr_id, user))


@router.get("", response_model=list[ChangeRequestSummary], operation_id="listChangeRequests")
def list_changes(
    session: SessionDep,
    _user: CurrentUser,
    status: Literal["draft", "submitted", "confirmed", "returned", "cancelled"] | None = None,
):
    return queries.list_changes(session, status)


@router.post("", response_model=ChangeRequestOut, operation_id="createChangeRequest")
def create_change(session: SessionDep, user: CurrentUser, body: ChangeRequestWrite):
    cr = workflow.create_draft(session, user, body.items, body.note)
    return _done(session, cr.id, user)


@router.get("/{change_id}", response_model=ChangeRequestOut, operation_id="getChangeRequest")
def get_change(session: SessionDep, user: CurrentUser, change_id: int):
    return _out(queries.get_change(session, change_id, user))


@router.put("/{change_id}", response_model=ChangeRequestOut, operation_id="updateChangeRequest")
def update_change(session: SessionDep, user: CurrentUser, change_id: int, body: ChangeRequestWrite):
    workflow.update_draft(session, user, change_id, body.items, body.note)
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/submit", response_model=ChangeRequestOut, operation_id="submitChangeRequest"
)
def submit(session: SessionDep, user: CurrentUser, change_id: int):
    workflow.submit(session, user, change_id)
    return _done(session, change_id, user)


@router.post(
    "/{change_id}/confirm", response_model=ChangeRequestOut, operation_id="confirmChangeRequest"
)
def confirm(session: SessionDep, user: CurrentUser, change_id: int):
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
