"""主数据只读查询。所有写入都经 /change-requests，这里没有任何增改接口。"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from hdip_api.core.auth import current_user
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.schemas.read import (
    CampusDetail,
    CampusRow,
    DepartmentDetail,
    DepartmentRow,
    InstitutionDetail,
    InstitutionRow,
    RelationOut,
    ServiceUnitDetail,
    ServiceUnitRow,
)
from hdip_api.services import queries

router = APIRouter(tags=["master"], dependencies=[Depends(current_user)], responses=ERROR_RESPONSES)

AsOf = Annotated[date | None, Query(description="查看日期 YYYY-MM-DD，默认今天")]


def _day(session, as_of: date | None) -> date:
    return as_of or session.scalar(select(func.current_date()))


@router.get("/institutions", response_model=list[InstitutionRow], operation_id="listInstitutions")
def list_institutions(session: SessionDep, as_of: AsOf = None):
    return queries.list_institutions(session, _day(session, as_of))


@router.get(
    "/institutions/{institution_id}",
    response_model=InstitutionDetail,
    operation_id="getInstitution",
)
def get_institution(session: SessionDep, institution_id: int, as_of: AsOf = None):
    return queries.get_institution(session, institution_id, _day(session, as_of))


@router.get("/campuses", response_model=list[CampusRow], operation_id="listCampuses")
def list_campuses(session: SessionDep, as_of: AsOf = None):
    return queries.list_campuses(session, _day(session, as_of))


@router.get("/campuses/{campus_id}", response_model=CampusDetail, operation_id="getCampus")
def get_campus(session: SessionDep, campus_id: int, as_of: AsOf = None):
    return queries.get_campus(session, campus_id, _day(session, as_of))


@router.get(
    "/operator-relations", response_model=list[RelationOut], operation_id="listOperatorRelations"
)
def list_relations(
    session: SessionDep,
    as_of: AsOf = None,
    institution_id: int | None = None,
    campus_id: int | None = None,
):
    """查看日期当天有效的主体—院区关系。"""
    return queries.list_relations(
        session, _day(session, as_of), institution_id=institution_id, campus_id=campus_id
    )


@router.get("/departments", response_model=list[DepartmentRow], operation_id="listDepartments")
def list_departments(session: SessionDep, as_of: AsOf = None):
    """全部部门（含停用），附查看日期当天挂在其下的单元数。"""
    return queries.list_departments(session, _day(session, as_of))


@router.get(
    "/departments/{department_id}", response_model=DepartmentDetail, operation_id="getDepartment"
)
def get_department(session: SessionDep, department_id: int, as_of: AsOf = None):
    return queries.get_department(session, department_id, _day(session, as_of))


@router.get("/service-units", response_model=list[ServiceUnitRow], operation_id="listServiceUnits")
def list_service_units(
    session: SessionDep,
    as_of: AsOf = None,
    campus_id: int | None = None,
    department_id: int | None = None,
    institution_id: int | None = None,
):
    """查看日期当天有效的服务单元（含尚未生效的计划单元，以 not_yet_effective 标出）。"""
    return queries.list_service_units(
        session,
        _day(session, as_of),
        campus_id=campus_id,
        department_id=department_id,
        institution_id=institution_id,
    )


@router.get(
    "/service-units/{unit_id}", response_model=ServiceUnitDetail, operation_id="getServiceUnit"
)
def get_service_unit(session: SessionDep, unit_id: int, as_of: AsOf = None):
    return queries.get_service_unit(session, unit_id, _day(session, as_of))
