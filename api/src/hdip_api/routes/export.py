"""按日期的只读导出（CSV）。与其他只读接口一样需要 X-HDIP-User；正式认证方案确定后一并替换。"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select

from hdip_api.core.auth import CurrentUser, current_user
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.core.permissions import PERSON_EXPORT, require_permission
from hdip_api.services.export import PERSON_DATASETS, Dataset, to_csv

router = APIRouter(
    prefix="/export",
    tags=["export"],
    dependencies=[Depends(current_user)],
    responses=ERROR_RESPONSES,
)


@router.get(
    "/{dataset}.csv",
    operation_id="exportCsv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string"}}}}},
)
def export_csv(
    session: SessionDep,
    user: CurrentUser,
    dataset: Dataset,
    as_of: Annotated[date | None, Query(description="查看日期 YYYY-MM-DD，默认今天")] = None,
) -> Response:
    """导出查看日期当天有效的一类数据。服务单元含暂停的、不含计划和已退出的。"""
    if dataset in PERSON_DATASETS:
        require_permission(user, PERSON_EXPORT)
    day = as_of or session.scalar(select(func.current_date()))
    body = to_csv(session, dataset, day, user)
    filename = f"hdip-{dataset}-{day.isoformat()}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
