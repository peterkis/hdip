"""变更项：变更申请里的每一项是其中一种，按 kind 区分。

对象之间用 code 引用（code 永久绑定），所以同一张申请里后面的项可以引用前面新建的对象，
例如“新建院区 + 建立该院区的运营关系”。运营关系没有 code，关闭时用 id。
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

# 院内代码大小写等价，一律存大写（d000001 = D000001）
Code = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
    ),
]
# 拼音码：名称的拼音首字母，大写字母与数字；检索用，不唯一。新建时不填由后端按名称生成
Pinyin = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9]{1,64}$")
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
    pinyin: Pinyin | None = None
    # 节点角色已停用（与院区名称重复），只为读取旧申请保留；对外叫法写 public_name
    node_role: Text | None = None
    public_name: Text | None = None
    address: Text | None = None
    admin_division_code: Text | None = None
    phone: Text | None = None
    actual_open_date: date | None = None


class CampusPatch(_Patch):
    """修订资料，不含运营状态（运营状态走 campus.change_status）。改名未给拼音码时按新名称生成。"""

    name: Name | None = None
    pinyin: Pinyin | None = None
    node_role: Text | None = None
    public_name: Text | None = None
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
# 外部分类代码按正式代码表原样书写（如 03.05、0305），不删点号、不补零
ClassCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"),
]


def _check_temporary(form: str | None, until: date | None, form_set: bool = True) -> None:
    if form_set and (form == "TEMPORARY") != (until is not None):
        raise ValueError("经批准的临时部门必须填期限；常设部门不填期限")


class DepartmentCreate(_Item):
    kind: Literal["department.create"]
    code: Code
    name: Name
    pinyin: Pinyin | None = None
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
    """只写要改的字段；写 null 表示清空。名称、设立形式不能清空。改名未给拼音码时按新名称生成。"""

    name: Name | None = None
    pinyin: Pinyin | None = None
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
    class_code: ClassCode | None
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


class DepartmentSetParent(_Item):
    """在某组织视图里调整直接上级：结束当前上级，自生效日起隶属新上级。

    parent_code 为空 = 一级部门。
    """

    kind: Literal["department.set_parent"]
    code: Code
    view_code: SchemeCode = "ADMIN"
    parent_code: Code | None
    effective_date: date


RelationKind = Literal["PROFESSIONAL_MGMT", "COLLABORATION", "CAMPUS_MGMT"]


class DepartmentRelationCreate(_Item):
    """部门管理关系。

    专业管理：from 对 to 的某事项实施管理；协作：双方就某范围协作；
    院区管理：from（院区管理组织）在某院区对某范围有管理职责，to 可空。
    """

    kind: Literal["department.relation_create"]
    relation_kind: RelationKind
    from_code: Code
    to_code: Code | None = None
    campus_code: Code | None = None
    scope: Name
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def _targets(self):
        if self.relation_kind == "CAMPUS_MGMT":
            if self.campus_code is None:
                raise ValueError("院区管理须指明院区")
        else:
            if self.to_code is None:
                raise ValueError("专业管理、协作须指明另一个部门")
            if self.campus_code is not None:
                raise ValueError("只有院区管理才填院区")
        if self.to_code is not None and self.to_code == self.from_code:
            raise ValueError("关系双方不能是同一个部门")
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("结束日不能早于开始日")
        return self


class DepartmentRelationClose(_Item):
    kind: Literal["department.relation_close"]
    relation_id: int
    valid_to: date


ReorgType = Literal["SPLIT", "SPLIT_OFF", "ABSORB", "MERGE"]
REORG_LABELS = {"SPLIT": "整体拆分", "SPLIT_OFF": "分设", "ABSORB": "吸收合并", "MERGE": "合并新设"}


class ReorgParticipant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Code
    # 该部门承接 / 移出的职责范围（文字说明）
    scope_note: Text | None = None


class DepartmentReorganize(_Item):
    """部门组织变更（docs/部门组织变更-评估与分期.md）：先定身份，再逐项处置依赖。

    - 整体拆分 SPLIT：1 个原部门退出（被替代），≥2 个结果部门新设
    - 分设 SPLIT_OFF：1 个原部门存续（可同申请改名），≥1 个结果部门新设
    - 吸收合并 ABSORB：≥1 个原部门退出，并入 1 个已有部门（身份不变）
    - 合并新设 MERGE：≥2 个原部门退出，1 个结果部门新设

    新设部门须在同一张申请里先用 department.create 建好，开始日 = 生效日、正式履职。
    受影响的单元、下级部门、外部编码解释由同一申请里的其他变更项逐项处置，缺一则不能确认。
    """

    kind: Literal["department.reorganize"]
    event_type: ReorgType
    effective_date: date
    basis_note: Name
    scope_note: Text | None = None
    other_matters: Text | None = None
    sources: list[ReorgParticipant] = Field(min_length=1)
    results: list[ReorgParticipant] = Field(min_length=1)

    @model_validator(mode="after")
    def _shape(self):
        n_src, n_res = len(self.sources), len(self.results)
        rule = {
            "SPLIT": (n_src == 1 and n_res >= 2, "整体拆分：1 个原部门，至少 2 个新设部门"),
            "SPLIT_OFF": (n_src == 1 and n_res >= 1, "分设：1 个存续的原部门，至少 1 个新设部门"),
            "ABSORB": (n_src >= 1 and n_res == 1, "吸收合并：并入 1 个已有部门"),
            "MERGE": (n_src >= 2 and n_res == 1, "合并新设：至少 2 个原部门，1 个新设部门"),
        }[self.event_type]
        if not rule[0]:
            raise ValueError(rule[1])
        codes = [p.code for p in self.sources + self.results]
        if len(set(codes)) != len(codes):
            raise ValueError("同一部门不能重复出现，原部门也不能同时列为结果部门")
        return self


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
    pinyin: Pinyin | None = None
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
    """修订只改名称（及拼音码）、电话、范围说明；身份、类型、部门、院区、运营主体各有显式动作。"""

    name: Name | None = None
    pinyin: Pinyin | None = None
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


# ------------------------------------------------------------------ 外部标识与分类关联（D3）
# 来源系统里的代码原样保存：不限字符，只去掉首尾空白
SourceCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
UnmodeledType = Literal["NURSING_UNIT", "WARD", "LOCATION", "STAT_GROUP", "COMPOSITE", "OTHER"]


class ServiceUnitClassify(_Item):
    """给服务单元在某分类方案下赋值；与部门分类相互独立，部门分类不下发给单元。"""

    kind: Literal["service_unit.classify"]
    code: Code
    scheme_code: SchemeCode
    class_code: ClassCode | None
    effective_date: date


class DepartmentClassificationClose(_Item):
    """结束部门的一条分类赋值：valid_to 为最后有效日（当天仍有效）。"""

    kind: Literal["department.classification_close"]
    classification_id: int
    valid_to: date


class ServiceUnitClassificationClose(_Item):
    """结束服务单元的一条分类赋值：valid_to 为最后有效日（当天仍有效）。"""

    kind: Literal["service_unit.classification_close"]
    classification_id: int
    valid_to: date


class _CodeRef(_Item):
    """源记录用“来源系统 + 字典 + 代码”引用，同一张申请里可引用前面刚登记的记录。"""

    system_code: SchemeCode
    namespace_code: SchemeCode
    external_code: SourceCode


class ExternalCodeRegister(_CodeRef):
    """登记一条源记录。只登记、不解释时，该记录在任何日期都是待裁决。"""

    kind: Literal["external_code.register"]
    source_name: Text | None = None
    semantic_note: Text | None = None


class ExternalCodeAssign(_CodeRef):
    """一条源记录自 valid_from 起的解释：指向部门、服务单元，或标“对象未建模”。

    campus_code 是条件：同一字典同一代码在不同院区指向不同对象时才填。
    """

    kind: Literal["external_code.assign"]
    target_type: Literal["department", "service_unit", "unmodeled"]
    department_code: Code | None = None
    service_unit_code: Code | None = None
    unmodeled_type: UnmodeledType | None = None
    campus_code: Code | None = None
    valid_from: date
    valid_to: date | None = None
    evidence_note: Text | None = None

    @model_validator(mode="after")
    def _one_target(self):
        given = {
            "department": self.department_code,
            "service_unit": self.service_unit_code,
            "unmodeled": self.unmodeled_type,
        }
        if given[self.target_type] is None:
            raise ValueError("请指明解释指向的对象")
        if sum(v is not None for v in given.values()) != 1:
            raise ValueError("一条解释只能指向一个对象")
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("结束日不能早于开始日")
        return self


class ExternalCodeAssignmentClose(_Item):
    """结束一条解释：valid_to 为最后有效日。"""

    kind: Literal["external_code.assignment_close"]
    assignment_id: int
    valid_to: date


# ------------------------------------------------------------------ 人员（迁移 0016）
# 人员用代码引用；任用、归属没有代码，用 id 引用（同运营关系）。
# 选项码（任用类型）在 option_item 里，加码值不改代码，应用时校验
OptionCode = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z][A-Z0-9_]{0,63}$")
]
# 业务工号按字符串原样保存（0007 不丢前导零），只去掉首尾空白
WorkNo = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class PersonCreate(_Item):
    """登记人员身份与第一个姓名版本；开始日 = 首项任用的开始日（登记向导自动带上）。"""

    kind: Literal["person.create"]
    code: Code
    name: Name
    pinyin: Pinyin | None = None
    valid_from: date


class PersonEngage(_Item):
    """建立任用（新登记或再次任用）：同期间的业务工号（选填）与主归属。

    department_code 为空 = 暂未分配（表单须明确选择）。valid_to 选填（医院常提前填写结束日）。
    """

    kind: Literal["person.engage"]
    person_code: Code
    institution_code: Code
    engagement_type: OptionCode
    work_no: WorkNo | None = None
    note: Text | None = None
    valid_from: date
    valid_to: date | None = None
    department_code: Code | None = None

    @model_validator(mode="after")
    def _period(self):
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("任用结束日不能早于开始日")
        return self


class PersonRevise(_Item):
    """姓名修订：RENAME 本人改名（旧名是曾用名）/ CORRECTION 更正录入错误（旧值标“误录”）。

    都自生效日起产生新版本，不改写已生效的历史；最新版本尚未生效时可在其开始日当天直接更正。
    改名未给拼音码时按新名称生成。
    """

    kind: Literal["person.revise"]
    code: Code
    reason: Literal["RENAME", "CORRECTION"]
    effective_date: date
    name: Name
    pinyin: Pinyin | None = None


class PersonChangeWorkNo(_Item):
    """换工号（实习转正、人事系统改号）或更正误录的工号：旧号止于生效日前一日，新号自生效日起。

    work_no 为空 = 此后不再有工号。expected_work_no 是发起时看到的当前工号（没有时为空）。
    """

    kind: Literal["person.change_work_no"]
    engagement_id: int
    expected_work_no: WorkNo | None
    reason: Literal["CHANGE", "CORRECTION"]
    work_no: WorkNo | None
    effective_date: date


class PersonAssign(_Item):
    """补归属：assignment_kind 为 PRIMARY 时给暂未分配的期间补主部门；
    ADDITIONAL 为附加归属（兼任等，P3），可有多条，但不能与同一时期的主部门相同。
    valid_to 为空时到任用结束（或长期）。"""

    kind: Literal["person.assign"]
    engagement_id: int
    department_code: Code
    assignment_kind: Literal["PRIMARY", "ADDITIONAL"] = "PRIMARY"
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def _period(self):
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("归属结束日不能早于开始日")
        return self


DutyCode = Literal["HEAD", "DEPUTY"]
DutyMode = Literal["FORMAL", "ACTING", "CARETAKER"]


class PersonDutyAssign(_Item):
    """任命部门职务（P3）：挂在任用 × 部门上，不要求此人归属该部门（代管）。

    同一部门同一天正式部长最多一位、主持工作者（代理或代管）最多一位，两者可并存。
    """

    kind: Literal["person.duty_assign"]
    engagement_id: int
    department_code: Code
    duty: DutyCode
    mode: DutyMode = "FORMAL"
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def _period(self):
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("职务结束日不能早于开始日")
        return self


class PersonDutySetEnd(_Item):
    """结束职务、调整尚未到达的结束日（空 = 清除），或撤销尚未开始的职务（开始日前一日）。"""

    kind: Literal["person.duty_set_end"]
    duty_id: int
    expected_valid_to: date | None
    valid_to: date | None


class PersonDutyHandover(_Item):
    """职务交接：原任职者止于生效日前一日，接任者自生效日起担任同一部门的同一职务（同一方式）。"""

    kind: Literal["person.duty_handover"]
    duty_id: int
    expected_valid_to: date | None
    to_engagement_id: int
    effective_date: date


class PersonTransfer(_Item):
    """调科：原归属止于生效日前一日，新归属自生效日起，结束日沿用原归属的结束日。

    expected_valid_to 是发起时看到的原归属结束日；确认时已被别的申请改过就拒绝，不覆盖。
    """

    kind: Literal["person.transfer"]
    assignment_id: int
    expected_valid_to: date | None
    department_code: Code
    effective_date: date


class PersonEngagementSetEnd(_Item):
    """结束任用、调整尚未到达的结束日（提前、推后、清空），
    或撤销尚未开始的任用（valid_to = 开始日前一日）。

    下属的部门归属与工号随之处理：提前时跨过新结束日的止于新结束日、之后才开始的撤销；
    推后 / 清空时，工号与“结束日恰好等于原结束日”的归属一起延长
    （extend_assignments 为假时归属不动）。
    结束日到达后不能再改，也不“接续”：再次任用 = 新建任用。
    """

    kind: Literal["person.engagement_set_end"]
    engagement_id: int
    expected_valid_to: date | None
    valid_to: date | None
    extend_assignments: bool = True


class PersonAssignmentSetEnd(_Item):
    """结束一条归属、调整它尚未到达的结束日（valid_to 为最后有效日；空 = 清除结束日），
    或撤销尚未开始的归属（valid_to = 开始日前一日）。"""

    kind: Literal["person.assignment_set_end"]
    assignment_id: int
    expected_valid_to: date | None
    valid_to: date | None


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
    | DepartmentSetParent
    | DepartmentRelationCreate
    | DepartmentRelationClose
    | DepartmentReorganize
    | DepartmentRename
    | DepartmentChangeStatus
    | ServiceUnitCreate
    | ServiceUnitRevise
    | ServiceUnitRebind
    | ServiceUnitChangeDepartment
    | ServiceUnitChangeStatus
    | ServiceUnitRetire
    | ServiceUnitSplit
    | ServiceUnitMerge
    | ServiceUnitClassify
    | DepartmentClassificationClose
    | ServiceUnitClassificationClose
    | ExternalCodeRegister
    | ExternalCodeAssign
    | ExternalCodeAssignmentClose
    | PersonCreate
    | PersonEngage
    | PersonRevise
    | PersonChangeWorkNo
    | PersonAssign
    | PersonTransfer
    | PersonDutyAssign
    | PersonDutySetEnd
    | PersonDutyHandover
    | PersonEngagementSetEnd
    | PersonAssignmentSetEnd,
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
    "department.set_parent": "调整行政隶属",
    "department.relation_create": "建立部门管理关系",
    "department.relation_close": "结束部门管理关系",
    "department.reorganize": "部门组织变更",
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
    "service_unit.classify": "调整服务单元分类",
    "department.classification_close": "结束部门分类",
    "service_unit.classification_close": "结束服务单元分类",
    "external_code.register": "登记外部代码",
    "external_code.assign": "解释外部代码",
    "external_code.assignment_close": "结束外部代码解释",
    "person.create": "登记人员",
    "person.engage": "建立任用",
    "person.revise": "修订人员姓名",
    "person.change_work_no": "变更业务工号",
    "person.assign": "补部门归属",
    "person.duty_assign": "任命部门职务",
    "person.duty_set_end": "结束部门职务",
    "person.duty_handover": "部门职务交接",
    "person.transfer": "调科",
    "person.engagement_set_end": "结束 / 调整任用期限",
    "person.assignment_set_end": "结束部门归属",
}

# 人员相关的变更项：没有 person.view 权限的人看不到含这些项的申请（core/permissions.py）
PERSON_KINDS = frozenset(k for k in KIND_LABELS if k.startswith("person."))


def dump_items(items: list[ChangeItem]) -> list[dict]:
    """存库：只保留填写过的字段，修订项的“写 null 清空”因此得以保留。"""
    return [i.model_dump(mode="json", exclude_unset=True) | {"kind": i.kind} for i in items]
