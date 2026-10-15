"""变更项：变更申请里的每一项是其中一种，按 kind 区分。

对象之间用 code 引用（code 永久绑定），所以同一张申请里后面的项可以引用前面新建的对象，
例如“新建院区 + 建立该院区的运营关系”。运营关系没有 code，关闭时用 id。
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

Code = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"),
]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]

OperatingStatus = Literal["PLANNING", "TRIAL_RUNNING", "RUNNING", "SUSPENDED"]
# 新建院区只能从筹建、试运行或运行开始；停用只能经“变更运营状态”到达
InitialOperatingStatus = Literal["PLANNING", "TRIAL_RUNNING", "RUNNING"]
RelationType = Literal["OPERATE", "REGISTER", "MANAGE", "CHARGE"]

OPERATING_STATUS_ORDER: dict[str, int] = {
    "PLANNING": 0,
    "TRIAL_RUNNING": 1,
    "RUNNING": 2,
    "SUSPENDED": 3,
}


class _Item(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Patch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("至少修改一项内容")
        return self


# ------------------------------------------------------------------ 主体
class InstitutionFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    nature: Text | None = None
    unified_credit_code: Text | None = None
    medical_reg_code: Text | None = None
    license_no: Text | None = None
    license_valid_from: date | None = None
    license_valid_to: date | None = None


class InstitutionPatch(_Patch):
    """只写要改的字段；写 null 表示清空该项。"""

    name: Name | None = None
    nature: Text | None = None
    unified_credit_code: Text | None = None
    medical_reg_code: Text | None = None
    license_no: Text | None = None
    license_valid_from: date | None = None
    license_valid_to: date | None = None

    @model_validator(mode="after")
    def _name_not_null(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("名称不能清空")
        return self


class InstitutionCreate(_Item):
    kind: Literal["institution.create"]
    code: Code
    valid_from: date
    fields: InstitutionFields


class InstitutionRevise(_Item):
    kind: Literal["institution.revise"]
    code: Code
    effective_date: date
    changes: InstitutionPatch


# ------------------------------------------------------------------ 院区
class CampusFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    node_role: Text | None = None
    address: Text | None = None
    admin_division_code: Text | None = None
    phone: Text | None = None
    actual_open_date: date | None = None


class CampusPatch(_Patch):
    """修订资料，不含运营状态（运营状态走 campus.change_status）。"""

    name: Name | None = None
    node_role: Text | None = None
    address: Text | None = None
    admin_division_code: Text | None = None
    phone: Text | None = None
    actual_open_date: date | None = None

    @model_validator(mode="after")
    def _name_not_null(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("名称不能清空")
        return self


class CampusCreate(_Item):
    kind: Literal["campus.create"]
    code: Code
    valid_from: date
    operating_status: InitialOperatingStatus = "PLANNING"
    fields: CampusFields


class CampusRevise(_Item):
    kind: Literal["campus.revise"]
    code: Code
    effective_date: date
    changes: CampusPatch


class CampusChangeStatus(_Item):
    kind: Literal["campus.change_status"]
    code: Code
    effective_date: date
    operating_status: OperatingStatus


# ------------------------------------------------------------------ 运营关系
class OperatorRelationCreate(_Item):
    kind: Literal["operator_relation.create"]
    institution_code: Code
    campus_code: Code
    relation_type: RelationType
    is_primary: bool = False
    valid_from: date
    valid_to: date | None = None


class OperatorRelationClose(_Item):
    kind: Literal["operator_relation.close"]
    relation_id: int
    valid_to: date


# ------------------------------------------------------------------ 部门
DepartmentStatus = Literal["ACTIVE", "INACTIVE"]
EstablishmentForm = Literal["STANDING", "TEMPORARY"]
# 新建只能从筹备或正式履职开始；被替代只由将来的部门拆并产生
InitialLifecycle = Literal["PREPARING", "ACTIVE"]
TargetLifecycle = Literal["ACTIVE", "SUSPENDED", "REVOKED"]
Duty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
SchemeCode = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]{0,63}$")]


def _check_temporary(form: str | None, until: date | None, form_set: bool = True) -> None:
    if form_set and (form == "TEMPORARY") != (until is not None):
        raise ValueError("经批准的临时部门必须填期限；常设部门不填期限")


class DepartmentCreate(_Item):
    kind: Literal["department.create"]
    code: Code
    name: Name
    # 生效日；旧申请里没有这一项，空表示确认当天
    valid_from: date | None = None
    short_name: Text | None = None
    description: Text | None = None
    establishment_form: EstablishmentForm = "STANDING"
    temporary_until: date | None = None
    lifecycle: InitialLifecycle = "ACTIVE"
    admin_grade: Text | None = None
    duties: list[Duty] = Field(default_factory=list)
    basis_note: Text | None = None
    # 主体归属（主归属）；空表示暂不填
    institution_code: Code | None = None

    @model_validator(mode="after")
    def _temporary(self):
        _check_temporary(self.establishment_form, self.temporary_until)
        return self


class DepartmentPatch(_Patch):
    """只写要改的字段；写 null 表示清空。名称、设立形式不能清空。"""

    name: Name | None = None
    short_name: Text | None = None
    description: Text | None = None
    establishment_form: EstablishmentForm | None = None
    temporary_until: date | None = None
    admin_grade: Text | None = None
    duties: list[Duty] | None = None
    basis_note: Text | None = None

    @model_validator(mode="after")
    def _not_null(self):
        for f in ("name", "establishment_form", "duties"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} 不能清空")
        return self


class DepartmentRevise(_Item):
    kind: Literal["department.revise"]
    code: Code
    effective_date: date
    changes: DepartmentPatch


class DepartmentChangeLifecycle(_Item):
    """组织生命周期：筹备 → 正式履职 ⇄ 暂停履职 → 撤销。"""

    kind: Literal["department.change_lifecycle"]
    code: Code
    effective_date: date
    lifecycle: TargetLifecycle


class DepartmentClassify(_Item):
    """给部门在某分类方案下赋值：结束当前赋值，自生效日起用新代码；class_code 为空表示只结束。"""

    kind: Literal["department.classify"]
    code: Code
    scheme_code: SchemeCode = "DEPT_MAIN_CLASS"
    class_code: SchemeCode | None
    effective_date: date


class DepartmentAffiliate(_Item):
    """主体归属：结束当前主归属，自生效日起归属新主体。"""

    kind: Literal["department.affiliate"]
    code: Code
    institution_code: Code
    effective_date: date


class DepartmentAliasAdd(_Item):
    kind: Literal["department.alias_add"]
    code: Code
    alias_kind: Literal["ALIAS", "SEARCH_CODE"] = "ALIAS"
    value: Name
    valid_from: date | None = None


class DepartmentAliasClose(_Item):
    kind: Literal["department.alias_close"]
    alias_id: int
    valid_to: date


class DepartmentRename(_Item):
    """已停用的旧变更类型（部门有版本后改用 department.revise）。保留以便读取历史申请。"""

    kind: Literal["department.rename"]
    code: Code
    name: Name


class DepartmentChangeStatus(_Item):
    """已停用的旧变更类型（改用 department.change_lifecycle）。保留以便读取历史申请。"""

    kind: Literal["department.change_status"]
    code: Code
    status: DepartmentStatus


# ------------------------------------------------------------------ 服务单元
UnitType = Literal["OPD", "IPD", "ED", "EXAM", "LAB", "PHARMACY", "OR", "OTHER"]
UnitStatus = Literal["ACTIVE", "SUSPENDED"]


class ServiceUnitFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    department_code: Code
    campus_code: Code
    institution_code: Code
    phone: Text | None = None
    scope_note: Text | None = None


class ServiceUnitCreate(_Item):
    kind: Literal["service_unit.create"]
    code: Code
    unit_type: UnitType
    valid_from: date
    fields: ServiceUnitFields


class ServiceUnitPatch(_Patch):
    """修订只改名称、电话、范围说明；身份、类型、部门、院区、运营主体各有显式动作。"""

    name: Name | None = None
    phone: Text | None = None
    scope_note: Text | None = None

    @model_validator(mode="after")
    def _name_not_null(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("名称不能清空")
        return self


class ServiceUnitRevise(_Item):
    kind: Literal["service_unit.revise"]
    code: Code
    effective_date: date
    changes: ServiceUnitPatch


class ServiceUnitRebind(_Item):
    """换院区或运营主体（至少一项）；身份不变，产生新版本。"""

    kind: Literal["service_unit.rebind"]
    code: Code
    effective_date: date
    campus_code: Code | None = None
    institution_code: Code | None = None

    @model_validator(mode="after")
    def _something(self):
        if self.campus_code is None and self.institution_code is None:
            raise ValueError("至少要换院区或运营主体之一")
        return self


class ServiceUnitChangeDepartment(_Item):
    kind: Literal["service_unit.change_department"]
    code: Code
    effective_date: date
    department_code: Code


class ServiceUnitChangeStatus(_Item):
    """暂停 / 恢复。"""

    kind: Literal["service_unit.change_status"]
    code: Code
    effective_date: date
    status: UnitStatus


class ServiceUnitRetire(_Item):
    """永久退出：valid_to 是最后有效日（当天仍有效）。终态，代码不释放。"""

    kind: Literal["service_unit.retire"]
    code: Code
    valid_to: date


class SuccessorUnit(BaseModel):
    """拆分/合并产生的后继单元：新身份、新代码，部门、院区、运营主体可与前身不同。"""

    model_config = ConfigDict(extra="forbid")

    code: Code
    unit_type: UnitType
    fields: ServiceUnitFields


class ServiceUnitSplit(_Item):
    """把一个单元拆成至少两个：前身在 effective_date 前一日退出，后继自 effective_date 起。"""

    kind: Literal["service_unit.split"]
    code: Code
    effective_date: date
    successors: list[SuccessorUnit] = Field(min_length=2)

    @model_validator(mode="after")
    def _distinct(self):
        codes = [s.code for s in self.successors]
        if len(set(codes)) != len(codes):
            raise ValueError("后继单元代码不能重复")
        if self.code in codes:
            raise ValueError("后继单元须用新代码，不能沿用前身代码")
        return self


class ServiceUnitMerge(_Item):
    """把至少两个单元合并成一个：前身在 effective_date 前一日退出，后继自 effective_date 起。"""

    kind: Literal["service_unit.merge"]
    codes: list[Code] = Field(min_length=2)
    effective_date: date
    successor: SuccessorUnit

    @model_validator(mode="after")
    def _distinct(self):
        if len(set(self.codes)) != len(self.codes):
            raise ValueError("前身单元不能重复")
        if self.successor.code in self.codes:
            raise ValueError("后继单元须用新代码，不能沿用前身代码")
        return self


ChangeItem = Annotated[
    InstitutionCreate
    | InstitutionRevise
    | CampusCreate
    | CampusRevise
    | CampusChangeStatus
    | OperatorRelationCreate
    | OperatorRelationClose
    | DepartmentCreate
    | DepartmentRevise
    | DepartmentChangeLifecycle
    | DepartmentClassify
    | DepartmentAffiliate
    | DepartmentAliasAdd
    | DepartmentAliasClose
    | DepartmentRename
    | DepartmentChangeStatus
    | ServiceUnitCreate
    | ServiceUnitRevise
    | ServiceUnitRebind
    | ServiceUnitChangeDepartment
    | ServiceUnitChangeStatus
    | ServiceUnitRetire
    | ServiceUnitSplit
    | ServiceUnitMerge,
    Field(discriminator="kind"),
]

ITEMS_ADAPTER: TypeAdapter[list[ChangeItem]] = TypeAdapter(list[ChangeItem])

KIND_LABELS: dict[str, str] = {
    "institution.create": "新建主体",
    "institution.revise": "修订主体",
    "campus.create": "新建院区",
    "campus.revise": "修订院区资料",
    "campus.change_status": "变更院区运营状态",
    "operator_relation.create": "建立运营关系",
    "operator_relation.close": "关闭运营关系",
    "department.create": "新建部门",
    "department.revise": "修订部门属性",
    "department.change_lifecycle": "变更部门生命周期",
    "department.classify": "调整部门分类",
    "department.affiliate": "调整部门主体归属",
    "department.alias_add": "添加部门别名",
    "department.alias_close": "停用部门别名",
    "department.rename": "部门改名（旧）",
    "department.change_status": "停用/恢复部门（旧）",
    "service_unit.create": "新建服务单元",
    "service_unit.revise": "修订服务单元",
    "service_unit.rebind": "重新绑定服务单元",
    "service_unit.change_department": "更换所属部门",
    "service_unit.change_status": "暂停/恢复服务单元",
    "service_unit.retire": "永久退出服务单元",
    "service_unit.split": "拆分服务单元",
    "service_unit.merge": "合并服务单元",
}


def dump_items(items: list[ChangeItem]) -> list[dict]:
    """存库：只保留填写过的字段，修订项的“写 null 清空”因此得以保留。"""
    return [i.model_dump(mode="json", exclude_unset=True) | {"kind": i.kind} for i in items]
