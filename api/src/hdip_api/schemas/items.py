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
    operating_status: OperatingStatus = "PLANNING"
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


ChangeItem = Annotated[
    InstitutionCreate
    | InstitutionRevise
    | CampusCreate
    | CampusRevise
    | CampusChangeStatus
    | OperatorRelationCreate
    | OperatorRelationClose,
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
}


def dump_items(items: list[ChangeItem]) -> list[dict]:
    """存库：只保留填写过的字段，修订项的“写 null 清空”因此得以保留。"""
    return [i.model_dump(mode="json", exclude_unset=True) | {"kind": i.kind} for i in items]
