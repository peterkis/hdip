"""标准资料库的只读查询（迁移 0023）。写入只经本地导入命令 scripts/import_standards.py，没有写接口。

需要“查看标准资料”权限（core/permissions.py）。
"""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.core.permissions import STANDARD_VIEW, require_permission
from hdip_api.schemas.standards import (
    EntryType,
    StandardDocumentDetail,
    StandardDocumentRow,
    StandardEntryDetail,
    StandardEntryPage,
)
from hdip_api.services import standards

router = APIRouter(prefix="/standards", tags=["standards"], responses=ERROR_RESPONSES)


@router.get(
    "/documents", response_model=list[StandardDocumentRow], operation_id="listStandardDocuments"
)
def list_documents(
    session: SessionDep,
    user: CurrentUser,
    include_superseded: Annotated[bool, Query(description="同时列出历史处理修订")] = False,
):
    """已收录的标准资料（每行一份结构化文档修订），含接入覆盖；默认只列当前处理修订。"""
    require_permission(user, STANDARD_VIEW)
    return standards.list_documents(session, include_superseded)


@router.get(
    "/documents/{doc_id}",
    response_model=StandardDocumentDetail,
    operation_id="getStandardDocument",
)
def get_document(session: SessionDep, user: CurrentUser, doc_id: Annotated[int, Path()]):
    """标准资料详情：来源包、读取成员、读取器版本与覆盖。"""
    require_permission(user, STANDARD_VIEW)
    return standards.get_document(session, doc_id)


@router.get("/entries", response_model=StandardEntryPage, operation_id="searchStandardEntries")
def search_entries(
    session: SessionDep,
    user: CurrentUser,
    q: Annotated[str | None, Query(description="名称或标识（DE / CV / 码值）")] = None,
    entry_type: Annotated[EntryType | None, Query()] = None,
    top_level: Annotated[
        bool, Query(description="只要顶层条目（数据元、值域表），不含代码行")
    ] = False,
    document_id: Annotated[
        int | None, Query(description="只看这一份文档修订（历史修订也可）")
    ] = None,
    series: Annotated[str | None, Query(description="标准系列，如 WS/T 363")] = None,
    standard_no: Annotated[str | None, Query(description="分册，如 WS/T 363.3")] = None,
    standard_year: Annotated[str | None, Query(description="原文年份")] = None,
    include_superseded: Annotated[bool, Query(description="同时检索历史处理修订")] = False,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """按名称或标识检索条目；先筛选再计数分页，total 是匹配总数。默认只检索当前处理修订。"""
    require_permission(user, STANDARD_VIEW)
    return standards.search_entries(
        session,
        q=q,
        entry_type=entry_type,
        top_level=top_level,
        document_id=document_id,
        series=series,
        standard_no=standard_no,
        standard_year=standard_year,
        include_superseded=include_superseded,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/entries/{entry_id}", response_model=StandardEntryDetail, operation_id="getStandardEntry"
)
def get_entry(session: SessionDep, user: CurrentUser, entry_id: Annotated[int, Path()]):
    """条目详情：类型化正文、值域代码、引用解析、被引用、出处与原记录。"""
    require_permission(user, STANDARD_VIEW)
    return standards.get_entry(session, entry_id)
