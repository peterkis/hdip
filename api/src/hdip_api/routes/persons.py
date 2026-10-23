"""人员的只读查询（人员设计第 7.1 节）。写入只经 /change-requests。

需要“查看人员”权限（core/permissions.py）；没有时整组接口返回 403。
"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.core.permissions import PERSON_VIEW, require_permission
from hdip_api.schemas.read import (
    DepartmentDutyRow,
    DepartmentPersonRow,
    PersonDetail,
    PersonRow,
    PersonStatus,
)
from hdip_api.services import person_queries

router = APIRouter(tags=["persons"], responses=ERROR_RESPONSES)

AsOf = Annotated[date | None, Query(description="查看日期 YYYY-MM-DD，默认今天")]


def _day(session, as_of: date | None) -> date:
    return as_of or session.scalar(select(func.current_date()))


@router.get("/persons", response_model=list[PersonRow], operation_id="listPersons")
def list_persons(
    session: SessionDep,
    user: CurrentUser,
    as_of: AsOf = None,
    q: Annotated[str, Query(description="姓名、曾用名、拼音码、人员代码或工号（含旧工号）")] = "",
    scope: Annotated[
        Literal["as_of", "all"],
        Query(description="as_of = 名册（按查看日期）；all = 查重，含历史、未来、无有效任用的人"),
    ] = "as_of",
    status: PersonStatus | None = None,
    institution_id: int | None = None,
    department_id: int | None = None,
    include_future: Annotated[bool, Query(description="名册是否加上仅有计划任用的人")] = False,
):
    """名册每人一行（按人去重）；任用与当天的工号、主归属作为子项。"""
    require_permission(user, PERSON_VIEW)
    return person_queries.list_persons(
        session,
        user,
        _day(session, as_of),
        q=q,
        scope=scope,
        status=status,
        institution_id=institution_id,
        department_id=department_id,
        include_future=include_future,
    )


@router.get("/persons/{person_id}", response_model=PersonDetail, operation_id="getPerson")
def get_person(session: SessionDep, user: CurrentUser, person_id: int, as_of: AsOf = None):
    require_permission(user, PERSON_VIEW)
    return person_queries.get_person(session, user, person_id, _day(session, as_of))


@router.get(
    "/departments/{department_id}/persons",
    response_model=list[DepartmentPersonRow],
    operation_id="listDepartmentPersons",
)
def list_department_persons(
    session: SessionDep,
    user: CurrentUser,
    department_id: int,
    as_of: AsOf = None,
    include_future: bool = False,
):
    """查看日期归属该部门的人员（主归属，不含下级部门）。"""
    require_permission(user, PERSON_VIEW)
    return person_queries.department_persons(
        session, department_id, _day(session, as_of), include_future=include_future
    )


@router.get(
    "/departments/{department_id}/duties",
    response_model=list[DepartmentDutyRow],
    operation_id="listDepartmentDuties",
)
def list_department_duties(
    session: SessionDep,
    user: CurrentUser,
    department_id: int,
    as_of: AsOf = None,
    include_future: bool = False,
):
    """查看日期该部门的职务：部长、副部长、主持工作、代管（负责人由此按日期派生，不存在部门上）。"""
    require_permission(user, PERSON_VIEW)
    return person_queries.department_duties(
        session, department_id, _day(session, as_of), include_future=include_future
    )
