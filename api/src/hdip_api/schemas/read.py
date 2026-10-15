"""只读查询与变更申请的响应结构。"""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel

from hdip_api.core.errors import ProblemItem
from hdip_api.schemas.items import ChangeItem

ChangeStatus = Literal["draft", "submitted", "confirmed", "returned", "cancelled"]


class UserRef(BaseModel):
    id: int
    username: str
    display_name: str


class UserOut(UserRef):
    roles: list[str]
    permissions: list[str]
    """权限键（见 core/permissions.py），页面据此显示可用操作。"""


class OptionOut(BaseModel):
    category: str
    code: str
    name: str
    sort_order: int


# ------------------------------------------------------------------ 版本
class VersionMeta(BaseModel):
    version_no: int
    valid_from: date
    valid_to: date | None
    change_id: int
    recorded_at: datetime
    recorded_by: UserRef


class InstitutionVersionOut(VersionMeta):
    name: str
    nature: str | None
    unified_credit_code: str | None
    medical_reg_code: str | None
    license_no: str | None
    license_valid_from: date | None
    license_valid_to: date | None


class CampusVersionOut(VersionMeta):
    name: str
    node_role: str | None
    address: str | None
    admin_division_code: str | None
    phone: str | None
    actual_open_date: date | None
    operating_status: str


class RelationOut(BaseModel):
    id: int
    institution_id: int
    institution_code: str
    institution_name: str
    campus_id: int
    campus_code: str
    campus_name: str
    relation_type: str
    is_primary: bool
    valid_from: date
    valid_to: date | None
    created_change_id: int
    closed_change_id: int | None
    effective_on_as_of: bool


class InstitutionRow(BaseModel):
    id: int
    code: str
    version: InstitutionVersionOut
    """查看日期当天有效的版本；当天尚未生效时为最早的计划版本。"""
    not_yet_effective: bool
    has_later_versions: bool


class InstitutionDetail(BaseModel):
    id: int
    code: str
    created_at: datetime
    created_change_id: int
    versions: list[InstitutionVersionOut]
    relations: list[RelationOut]


class PrimaryOperator(BaseModel):
    institution_id: int
    code: str
    name: str


class CampusRow(BaseModel):
    id: int
    code: str
    version: CampusVersionOut
    not_yet_effective: bool
    has_later_versions: bool
    primary_operator: PrimaryOperator | None


class CampusDetail(BaseModel):
    id: int
    code: str
    created_at: datetime
    created_change_id: int
    versions: list[CampusVersionOut]
    relations: list[RelationOut]


# ------------------------------------------------------------------ 部门与服务单元
class ServiceUnitVersionOut(VersionMeta):
    name: str
    department_id: int
    department_code: str
    department_name: str
    """查看日期当天的部门名称（部门有版本后按日期准确）。"""
    department_lifecycle: str
    """查看日期当天部门的组织生命周期（PREPARING/ACTIVE/SUSPENDED/REVOKED/SUPERSEDED）。"""
    campus_id: int
    campus_code: str
    campus_name: str
    institution_id: int
    institution_code: str
    institution_name: str
    status: str
    phone: str | None
    scope_note: str | None


class ServiceUnitRow(BaseModel):
    id: int
    code: str
    unit_type: str
    version: ServiceUnitVersionOut
    """查看日期当天有效的版本；当天尚未生效时为最早的计划版本。"""
    not_yet_effective: bool
    has_later_versions: bool


class LineageOut(BaseModel):
    """一条演变关系：另一端单元的身份、代码与名称（前身取其最后一版名称，后继取第一版）。"""

    id: int
    lineage_type: Literal["SPLIT", "MERGE"]
    effective_date: date
    """后继的开始日；前身的最后有效日为其前一日。"""
    change_id: int
    predecessor_id: int
    predecessor_code: str
    predecessor_name: str
    successor_id: int
    successor_code: str
    successor_name: str


class ServiceUnitDetail(BaseModel):
    id: int
    code: str
    unit_type: str
    created_at: datetime
    created_change_id: int
    retired_after: date | None
    """永久退出时为最后有效日（当天仍有效）；未退出为空。"""
    versions: list[ServiceUnitVersionOut]
    predecessors: list[LineageOut]
    """本单元由哪些单元拆分或合并而来。"""
    successors: list[LineageOut]
    """本单元拆分或合并成了哪些单元。"""


class DepartmentVersionOut(VersionMeta):
    name: str
    short_name: str | None
    description: str | None
    establishment_form: Literal["STANDING", "TEMPORARY"]
    temporary_until: date | None
    lifecycle: Literal["PREPARING", "ACTIVE", "SUSPENDED", "REVOKED", "SUPERSEDED"]
    admin_grade: str | None
    duties: list[str]
    basis_note: str | None


class ClassRef(BaseModel):
    scheme_code: str
    scheme_name: str
    code: str
    name: str


class DepartmentClassificationOut(ClassRef):
    id: int
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None


class DepartmentAffiliationOut(BaseModel):
    id: int
    institution_id: int
    institution_code: str
    institution_name: str
    is_primary: bool
    valid_from: date
    valid_to: date | None
    change_id: int


class DepartmentAliasOut(BaseModel):
    id: int
    kind: Literal["ALIAS", "SEARCH_CODE"]
    value: str
    valid_from: date
    valid_to: date | None
    change_id: int


class DepartmentRow(BaseModel):
    id: int
    code: str
    version: DepartmentVersionOut
    """查看日期当天有效的版本；当天尚未设立时为最早的版本。"""
    not_yet_effective: bool
    has_later_versions: bool
    main_class: ClassRef | None
    """查看日期当天的部门管理主分类。"""
    institution_name: str | None
    """查看日期当天的主归属主体。"""
    unit_count: int
    """查看日期当天挂在该部门下、已生效的服务单元数。"""


class DepartmentDetail(BaseModel):
    id: int
    code: str
    created_at: datetime
    created_change_id: int
    versions: list[DepartmentVersionOut]
    """新到旧。旧版本的名称即曾用名。"""
    classifications: list[DepartmentClassificationOut]
    affiliations: list[DepartmentAffiliationOut]
    aliases: list[DepartmentAliasOut]
    units: list[ServiceUnitRow]
    """查看日期当天挂在该部门下的服务单元（含计划中）。"""
    change_ids: list[int]
    """改动过该部门的已确认申请。"""


class ClassificationCodeOut(BaseModel):
    id: int
    code: str
    name: str
    criterion: str | None
    caution: str | None
    sort_order: int
    is_active: bool
    updated_at: datetime
    updated_by: UserRef | None


class ClassificationSchemeOut(BaseModel):
    id: int
    code: str
    name: str
    version: str
    purpose: str | None
    is_exclusive: bool
    is_active: bool
    codes: list[ClassificationCodeOut]


class ClassificationCodeWrite(BaseModel):
    """维护分类字典（配置，不经变更申请）。代码值不可改，不删除只停用。"""

    name: str | None = None
    criterion: str | None = None
    caution: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ClassificationCodeCreate(BaseModel):
    code: str
    name: str
    criterion: str | None = None
    caution: str | None = None
    sort_order: int = 0


class OrgViewOut(BaseModel):
    code: str
    name: str
    purpose: str | None
    status: Literal["ACTIVE", "PLANNED"]


# ------------------------------------------------------------------ 变更申请
class ChangeRequestWrite(BaseModel):
    items: list[ChangeItem]
    note: str | None = None


class ReturnBody(BaseModel):
    reason: str


class ItemOutcome(BaseModel):
    index: int
    kind: str
    label: str
    target: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class Permissions(BaseModel):
    can_edit: bool
    can_submit: bool
    can_confirm: bool
    can_return: bool
    can_cancel: bool
    can_copy: bool
    confirm_hint: str | None
    """不能确认时的原因（例如需要其他确认人），供页面提示。"""


class ChangeRequestSummary(BaseModel):
    id: int
    status: ChangeStatus
    note: str | None
    item_labels: list[str]
    created_by: UserRef
    created_at: datetime
    submitted_at: datetime | None
    confirmed_at: datetime | None


class ChangeRequestOut(BaseModel):
    id: int
    status: ChangeStatus
    note: str | None
    items: list[ChangeItem]
    item_labels: list[str]
    outcomes: list[ItemOutcome] | None
    """已确认：确认时记录的前后内容；草稿/已提交：按当前数据预演的结果。"""
    problems: list[ProblemItem]
    """预演未通过时的问题。"""
    problem_message: str | None
    copied_from_id: int | None
    created_by: UserRef
    created_at: datetime
    updated_at: datetime
    submitted_by: UserRef | None
    submitted_at: datetime | None
    confirmed_by: UserRef | None
    confirmed_at: datetime | None
    returned_by: UserRef | None
    returned_at: datetime | None
    return_reason: str | None
    cancelled_by: UserRef | None
    cancelled_at: datetime | None
    permissions: Permissions
