"""代码预留：表单“保存到申请”前为要新建的院区、部门、服务单元取号（services/codes.py）。

预留只登记“这个号已经发出”，不改主数据；对象本身仍经变更申请新建。
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.core.permissions import CHANGE_CREATE, require_permission
from hdip_api.services import codes

router = APIRouter(prefix="/code-reservations", tags=["changes"], responses=ERROR_RESPONSES)


class ReserveBody(BaseModel):
    object_type: Literal["campus", "department", "service_unit"]
    # 由表单生成、一次保存内不变：网络重试、校验失败后再保存都拿回同一批号
    request_key: str = Field(min_length=8, max_length=100)
    count: int = Field(ge=1, le=50)


class ReserveOut(BaseModel):
    codes: list[str]


@router.post("", response_model=ReserveOut, operation_id="reserveCodes")
def reserve_codes(session: SessionDep, user: CurrentUser, body: ReserveBody):
    require_permission(user, CHANGE_CREATE)
    out = codes.reserve(session, user, body.object_type, body.request_key, body.count)
    session.commit()
    return ReserveOut(codes=out)
