"""主数据只读查询。所有写入都经 /change-requests，这里没有任何增改接口。"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from hdip_api.core.auth import current_user
from hdip_api.core.db import SessionDep
from hdip_api.core.errors import ERROR_RESPONSES
from hdip_api.schemas.read import (
    CampusDetail,
    CampusRow,
    ClassificationSchemeOut,
    DepartmentDependencies,
    DepartmentDetail,
    DepartmentRow,
    ExternalCodeDetail,
    ExternalCodePage,
    InstitutionDetail,
    InstitutionRow,
    OrgViewOut,
    RelationOut,
    ServiceUnitDetail,
    ServiceUnitRow,
    SourceSystemOut,
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
    include_future: Annotated[
        bool, Query(description="是否包含查看日期之后才开始的关系（如筹建院区的未来运营关系）")
    ] = False,
):
    """查看日期当天有效的主体—院区关系；include_future 时另含之后才开始的。"""
    return queries.list_relations(
        session,
        _day(session, as_of),
        institution_id=institution_id,
        campus_id=campus_id,
        include_future=include_future,
    )


@router.get("/departments", response_model=list[DepartmentRow], operation_id="listDepartments")
def list_departments(
    session: SessionDep,
    as_of: AsOf = None,
    q: Annotated[str | None, Query(description="按管理编码、名称（含曾用名）、别名搜索")] = None,
):
    """全部部门（含尚未设立的计划部门），附查看日期当天的版本、主分类、主归属与已生效单元数。

    部门数口径：只计查看日期当天组织生命周期为“正式履职”（ACTIVE）且已生效的部门。
    """
    return queries.list_departments(session, _day(session, as_of), q)


@router.get(
    "/departments/{department_id}", response_model=DepartmentDetail, operation_id="getDepartment"
)
def get_department(session: SessionDep, department_id: int, as_of: AsOf = None):
    return queries.get_department(session, department_id, _day(session, as_of))


@router.get(
    "/departments/{department_id}/dependencies",
    response_model=DepartmentDependencies,
    operation_id="getDepartmentDependencies",
)
def get_department_dependencies(session: SessionDep, department_id: int, day: date):
    """承接清单：部门在 day（组织变更生效日）及以后仍有效的服务单元、下级部门、外部编码解释、
    分类与管理关系。组织变更向导据此逐项处置。"""
    return queries.department_dependencies(session, department_id, day)


@router.get("/service-units", response_model=list[ServiceUnitRow], operation_id="listServiceUnits")
def list_service_units(
    session: SessionDep,
    as_of: AsOf = None,
    campus_id: int | None = None,
    department_id: int | None = None,
    institution_id: int | None = None,
    include_future: Annotated[
        bool, Query(description="是否包含查看日期尚未生效的计划单元（以 not_yet_effective 标出）")
    ] = True,
):
    """查看日期当天有效的服务单元，含暂停的（看 version.status）；已退出的不含。

    剧本 5“某日哪些单元在运营、归哪个主体”：include_future=false，按 institution 字段归集。
    """
    return queries.list_service_units(
        session,
        _day(session, as_of),
        campus_id=campus_id,
        department_id=department_id,
        institution_id=institution_id,
        include_future=include_future,
    )


@router.get(
    "/service-units/{unit_id}", response_model=ServiceUnitDetail, operation_id="getServiceUnit"
)
def get_service_unit(session: SessionDep, unit_id: int, as_of: AsOf = None):
    return queries.get_service_unit(session, unit_id, _day(session, as_of))


@router.get(
    "/classification-schemes",
    response_model=list[ClassificationSchemeOut],
    operation_id="listClassificationSchemes",
)
def list_classification_schemes(session: SessionDep):
    """分类方案与代码（含已停用的代码，以 is_active 标出）。"""
    return queries.list_classification_schemes(session)


@router.get("/org-views", response_model=list[OrgViewOut], operation_id="listOrgViews")
def list_org_views(session: SessionDep):
    """组织视图：行政视图启用；运营、病案视图占位（status = PLANNED）。"""
    return queries.list_org_views(session)


@router.get(
    "/source-systems", response_model=list[SourceSystemOut], operation_id="listSourceSystems"
)
def list_source_systems(session: SessionDep, as_of: AsOf = None):
    """来源系统实例与其字典，附每本字典的代码数与查看日期当天的待裁决数。"""
    return queries.list_source_systems(session, _day(session, as_of))


@router.get("/external-codes", response_model=ExternalCodePage, operation_id="listExternalCodes")
def list_external_codes(
    session: SessionDep,
    as_of: AsOf = None,
    namespace_id: int | None = None,
    status: Annotated[
        Literal["pending", "mapped", "unmodeled"] | None,
        Query(description="查看日期当天：待裁决 / 已映射 / 对象未建模"),
    ] = None,
    q: Annotated[str | None, Query(description="按代码或源名称搜索")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """编码映射台账。某日没有任何解释覆盖的源记录，当天即待裁决。"""
    return queries.list_external_codes(
        session,
        _day(session, as_of),
        namespace_id=namespace_id,
        status=status,
        q=q,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/external-codes/{code_id}",
    response_model=ExternalCodeDetail,
    operation_id="getExternalCode",
)
def get_external_code(session: SessionDep, code_id: int, as_of: AsOf = None):
    return queries.get_external_code(session, code_id, _day(session, as_of))
