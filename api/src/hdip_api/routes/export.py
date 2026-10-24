"""按日期的只读导出（CSV）。与其他只读接口一样需要 X-HDIP-User；正式认证方案确定后一并替换。"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, select

from hdip_api.core.auth import CurrentUser, current_user
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES, BusinessError
from hdip_api.core.permissions import PERSON_EXPORT, require_permission
from hdip_api.schemas.read import PersonStatus
from hdip_api.services.export import PERSON_DATASETS, Dataset, to_csv

_ONLY = "仅人员数据集；与对应页面同口径，见 docs/人员共享数据契约.md"

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
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    dataset: Dataset,
    as_of: Annotated[date | None, Query(description="查看日期 YYYY-MM-DD，默认今天")] = None,
    q: Annotated[str | None, Query(description=f"检索词（{_ONLY}）")] = None,
    status: Annotated[PersonStatus | None, Query(description=f"人员状态（{_ONLY}）")] = None,
    department_id: Annotated[int | None, Query(description=f"主部门 / 任职部门（{_ONLY}）")] = None,
    include_future: Annotated[bool | None, Query(description=f"含计划（{_ONLY}）")] = None,
    duty: Annotated[Literal["HEAD", "DEPUTY"] | None, Query(description=f"职务（{_ONLY}）")] = None,
    mode: Annotated[
        Literal["FORMAL", "ACTING", "CARETAKER"] | None, Query(description=f"任职方式（{_ONLY}）")
    ] = None,
) -> Response:
    """导出查看日期当天有效的一类数据。服务单元含暂停的、不含计划和已退出的。

    人员数据集带上页面的筛选，导出的行与页面一致；某数据集不支持的筛选直接拒绝，不悄悄导出全量。
    按请求实际带的参数名检查（含未声明、拼错的参数，如 scope=all），不只看已声明的几个。"""
    allowed = PERSON_DATASETS.get(dataset, set())
    if dataset in PERSON_DATASETS:
        require_permission(user, PERSON_EXPORT)
    if extra := sorted(set(request.query_params) - allowed - {"as_of"}):
        raise BusinessError(f"{dataset} 不支持按 {'、'.join(extra)} 筛选导出")
    given = {
        k: v
        for k, v in dict(
            q=q,
            status=status,
            department_id=department_id,
            include_future=include_future,
            duty=duty,
            mode=mode,
        ).items()
        if v is not None and v != ""
    }
    day = as_of or session.scalar(select(func.current_date()))
    body = to_csv(session, dataset, day, user, given)
    filename = f"hdip-{dataset}-{day.isoformat()}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
