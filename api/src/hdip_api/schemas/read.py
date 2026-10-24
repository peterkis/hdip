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
    pinyin: str | None = None
    """名称的拼音首字母，检索用。"""
    node_role: str | None
    public_name: str | None
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
    pinyin: str | None = None
    """名称的拼音首字母，检索用。"""
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
    classifications: list["DepartmentClassificationOut"]
    """服务单元自己的分类（不含所属部门的分类），新到旧。"""
    external_codes: list["ExternalCodeLink"]
    """解释指向本单元的外部代码（含已结束的），新到旧。"""


class DepartmentVersionOut(VersionMeta):
    name: str
    pinyin: str | None = None
    """名称的拼音首字母，检索用。"""
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


class DeptRef(BaseModel):
    id: int
    code: str
    name: str
    """查看日期当天的名称。"""


class DepartmentEdgeOut(BaseModel):
    """一条行政隶属边（本部门 → 上级）。"""

    id: int
    view_code: str
    view_name: str
    parent: DeptRef
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None


class DepartmentRelationOut(BaseModel):
    id: int
    kind: Literal["PROFESSIONAL_MGMT", "COLLABORATION", "CAMPUS_MGMT"]
    from_department: DeptRef
    to_department: DeptRef | None
    campus_id: int | None
    campus_name: str | None
    scope: str
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None


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
    parent: DeptRef | None
    """查看日期当天行政视图中的直接上级；无上级为一级部门。"""
    level: int
    """行政视图中的组织层级：1 = 一级部门，2 = 二级部门……由隶属关系计算。"""
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
    level: int
    """查看日期当天在行政视图中的层级。"""
    path: list[DeptRef]
    """查看日期当天从一级部门到本部门的行政隶属路径（含本部门）。"""
    parents: list[DepartmentEdgeOut]
    """本部门在行政视图中的上级历史，新到旧。"""
    children: list[DeptRef]
    """查看日期当天的直接下级部门。"""
    relations: list[DepartmentRelationOut]
    """本部门参与的专业管理、协作、院区管理关系（含已结束的），新到旧。"""
    change_ids: list[int]
    """改动过该部门的已确认申请。"""
    external_codes: list["ExternalCodeLink"]
    """解释指向本部门的外部代码（含已结束的），新到旧。"""
    unit_external_codes: list["ExternalCodeLink"]
    """查看日期当天经本部门的服务单元得到的代码：只读，不是本部门的身份标识。"""
    reorganizations: list["ReorgEventOut"]
    """本部门参与的组织变更事件（沿革），新到旧。演变关系不是行政上下级。"""


class ReorgParticipantOut(BaseModel):
    department: DeptRef
    role: Literal["SOURCE", "RESULT"]
    outcome: Literal["CONTINUES", "EXITS", "NEW"]
    scope_note: str | None


class ReorgEventOut(BaseModel):
    """一次组织变更：类型、生效日、依据，以及参与部门的身份结论与承接范围。"""

    id: int
    event_type: Literal["SPLIT", "SPLIT_OFF", "ABSORB", "MERGE"]
    effective_date: date
    basis_note: str
    scope_note: str | None
    other_matters: str | None
    change_id: int
    recorded_at: datetime
    participants: list[ReorgParticipantOut]


class DepartmentDependencies(BaseModel):
    """承接清单的原始数据：某部门在某日及以后仍有效的依赖。"""

    day: date
    units: list["ServiceUnitRow"]
    """该日及以后挂在本部门的服务单元（含计划中的）：须逐个改挂或退出。"""
    children: list[DeptRef]
    """该日及以后仍隶属本部门的下级部门（行政视图）：须逐个改挂。"""
    code_links: list["ExternalCodeLink"]
    """该日及以后仍指向本部门的外部编码解释：退出时须结束。"""
    classifications: list[DepartmentClassificationOut]
    """该日仍有效的分类赋值：退出时自动结束，结果部门的分类另行确认（可作候选）。"""
    relations: list[DepartmentRelationOut]
    """该日仍有效的管理关系：退出时自动结束，需要的为结果部门重建。"""
    persons: list["DepartmentPersonRow"] = []
    """该日及以后归属本部门的人员（含计划中、预约调入的）：部门退出时须逐个调走或结束归属。"""


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
    meaning_for_department: str | None
    """用在部门上时表示什么；为空表示不适用于部门。"""
    meaning_for_unit: str | None
    """用在服务单元上时表示什么；为空表示不适用于服务单元。"""
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
    notices: list[str] = []
    """提示（不阻止提交与确认）：同名人员、部门筹备 / 暂停履职、暂未分配主部门等。"""


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
    returned_at: datetime | None
    cancelled_at: datetime | None


class ItemPart(BaseModel):
    """一行里的一个片段：text 文字；chip 名称；new 新设的名称；out 退出的名称；
    tag 状态标签；arrow 箭头；ref 关联对象的名称（如隶属的上级部门，着色显示）。"""

    kind: Literal["text", "chip", "new", "out", "tag", "arrow", "ref"]
    text: str
    tone: str | None = None
    """tag 的色调：green / brown / yellow / blue / gray / red。"""


class ItemView(BaseModel):
    parts: list[ItemPart]
    meta: str | None = None
    """靠右弱化显示：代码、院区。"""
    covered_by: int | None = None
    """并进另一行显示（如新设部门的主分类、隶属并进它的“新设”行）时，那一行的序号。"""


class ChangeRequestOut(BaseModel):
    id: int
    status: ChangeStatus
    note: str | None
    items: list[ChangeItem]
    item_labels: list[str]
    item_summaries: list[str] = []
    item_views: list["ItemView"] = []
    """每项的结构化呈现：名称标签、状态标签、箭头、文字片段，以及靠右的代码（申请页逐行展示）。"""
    """每项一句话说明：用名称说清谁、怎么变、从哪天起（预演失败时也有）。"""
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
    masked_fields: list[str] = []
    """当前用户无权查看、已在本申请里隐去的敏感字段（值置空，文字里替换为“（已隐去）”）。"""


class ClassificationSchemeCreate(BaseModel):
    """登记分类方案（配置）。外部分类方案的代码以正式代码表为准，不臆造。"""

    code: str
    name: str
    version: str
    purpose: str | None = None
    is_exclusive: bool = False
    meaning_for_department: str | None = None
    meaning_for_unit: str | None = None


class ClassificationSchemeWrite(BaseModel):
    name: str | None = None
    purpose: str | None = None
    meaning_for_department: str | None = None
    meaning_for_unit: str | None = None
    is_active: bool | None = None


# ------------------------------------------------------------------ 外部标识（D3）
class UnitRef(BaseModel):
    id: int
    code: str
    name: str


class ExternalCodeLink(BaseModel):
    """一条解释，从对象一侧看：哪本字典的哪个代码指向它。"""

    assignment_id: int
    external_code_id: int
    system_code: str
    system_name: str
    namespace_code: str
    namespace_name: str
    code: str
    source_name: str | None
    campus_code: str | None
    campus_name: str | None
    valid_from: date
    valid_to: date | None
    evidence_note: str | None
    change_id: int
    via_unit: UnitRef | None = None
    """经哪个服务单元得到（只在部门页的“关联单元编码”里出现）。"""


class AssignmentOut(BaseModel):
    """一条解释，从源记录一侧看。"""

    id: int
    target_type: str
    department: DeptRef | None
    service_unit: UnitRef | None
    unmodeled_type: str | None
    campus_code: str | None
    campus_name: str | None
    valid_from: date
    valid_to: date | None
    evidence_note: str | None
    change_id: int
    closed_change_id: int | None


class ExternalCodeRow(BaseModel):
    id: int
    system_code: str
    system_name: str
    namespace_code: str
    namespace_name: str
    code: str
    source_name: str | None
    semantic_note: str | None
    status: str
    """查看日期当天：pending 待裁决 / mapped 已映射 / unmodeled 对象未建模。"""
    current: list[AssignmentOut]
    """查看日期当天有效的解释（按院区条件可有多条）。"""
    assignment_count: int
    suggestions: list["CodeSuggestion"] = []
    """批量裁决用：待裁决代码按源名称给出的候选对象（suggest=true 时才计算），按可信度排序。"""


class CodeSuggestion(BaseModel):
    """按源名称找到的候选：只是建议，裁决仍由人勾选确认、经变更申请生效。"""

    target_type: Literal["department", "service_unit"]
    code: str
    name: str
    campus_name: str | None = None
    match: Literal["exact", "alias", "former_name", "contains", "similar"]
    """exact 名称相同；alias 与别名 / 简称相同；former_name 与曾用名相同；
    contains 源名称包含该对象名称；similar 去掉“科、门诊、专家、病区”等后缀后名称相近（最弱）。"""


class ExternalCodePage(BaseModel):
    total: int
    counts: dict[str, int]
    """当前筛选（不含状态）下各状态的数量：pending / mapped / unmodeled。"""
    rows: list[ExternalCodeRow]


class ExternalCodeDetail(ExternalCodeRow):
    created_change_id: int
    recorded_at: datetime
    assignments: list[AssignmentOut]
    """全部解释（含已结束），新到旧。"""


class NamespaceOut(BaseModel):
    id: int
    code: str
    name: str
    note: str | None
    is_active: bool
    code_count: int
    pending_count: int
    """查看日期当天的待裁决数。"""
    breakdown: dict[str, int] = {}
    """查看日期当天按源记录去重的解释状态：pending 待裁决 / unmodeled 对象未建模 /
    department 指向部门 / service_unit 指向服务单元 / mixed 部门与单元都有（按院区条件）。
    数为 0 的状态不出现。"""


class SourceSystemOut(BaseModel):
    id: int
    code: str
    name: str
    kind: str
    note: str | None
    is_active: bool
    namespaces: list[NamespaceOut]


class SourceSystemWrite(BaseModel):
    """维护来源系统实例（配置）。code 新建后不可改。"""

    code: str | None = None
    name: str | None = None
    kind: str | None = None
    note: str | None = None
    is_active: bool | None = None


class NamespaceWrite(BaseModel):
    """维护字典（配置）。code 新建后不可改。"""

    code: str | None = None
    name: str | None = None
    note: str | None = None
    is_active: bool | None = None


ServiceUnitDetail.model_rebuild()
DepartmentDetail.model_rebuild()


# ------------------------------------------------------------------ 人员（迁移 0016）
PersonStatus = Literal["ENGAGED", "PLANNED", "NONE"]
"""按查看日期派生，不存储：有效任用 / 计划中（仅有计划任用）/ 无效任用（当天没有有效任用）。"""


class PersonVersionOut(BaseModel):
    version_no: int
    valid_from: date
    valid_to: date | None
    name: str
    pinyin: str | None
    revise_reason: Literal["INITIAL", "RENAME", "CORRECTION"]
    change_id: int
    recorded_at: datetime
    void: bool
    """生效前已撤销（空期间）。"""


class PersonWorkNoOut(BaseModel):
    id: int
    work_no: str | None
    """无权查看时为空（见 masked_fields）。"""
    revise_reason: Literal["INITIAL", "CHANGE", "CORRECTION"]
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None
    void: bool


class PersonAssignmentOut(BaseModel):
    id: int
    kind: str
    department: DeptRef
    """部门名称取查看日期（落在归属期间内时）或归属开始日的名称。"""
    department_lifecycle: str | None
    """部门在查看日期（或归属开始日）的组织生命周期，用于提示筹备 / 暂停履职。"""
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None
    void: bool


class PersonDutyOut(BaseModel):
    """部门职务（P3）：部门可以不是此人的归属部门（代管）。"""

    id: int
    department: DeptRef
    duty: Literal["HEAD", "DEPUTY"]
    mode: Literal["FORMAL", "ACTING", "CARETAKER"]
    label: str
    """部长 / 副部长 / 主持工作 / 代管。"""
    valid_from: date
    valid_to: date | None
    basis_note: str | None
    """任职依据；A1 之前登记的为空（显示“历史记录未提供依据”）。"""
    change_id: int
    closed_change_id: int | None
    void: bool


class EngagementEndChange(BaseModel):
    """任用结束日的一次登记或调整（来自已确认申请的前后结果，不另存）。"""

    change_id: int
    confirmed_at: datetime | None
    action: Literal["REGISTER", "END", "EARLIER", "LATER", "CLEAR", "CANCEL"]
    """登记时填写 / 结束任用 / 提前 / 推后 / 撤回结束日 / 撤销计划。"""
    from_valid_to: date | None
    to_valid_to: date | None
    handled: list[str] = []
    """随之处理的归属、工号、职务。"""


class PersonEngagementOut(BaseModel):
    id: int
    institution_id: int
    institution_code: str
    institution_name: str
    engagement_type: str
    note: str | None
    valid_from: date
    valid_to: date | None
    change_id: int
    closed_change_id: int | None
    void: bool
    work_nos: list[PersonWorkNoOut]
    assignments: list[PersonAssignmentOut]
    duties: list[PersonDutyOut] = []
    end_changes: list[EngagementEndChange] = []
    """结束日的逐次登记与调整，按确认时间先后（PERS-06）。"""


class PersonEngagementBrief(BaseModel):
    """名册一行里的一项任用：当天（或最早计划）的工号与主归属。"""

    id: int
    institution_id: int
    institution_name: str
    engagement_type: str
    valid_from: date
    valid_to: date | None
    not_yet_effective: bool
    work_no: str | None
    assignment_id: int | None
    department: DeptRef | None
    """为空 = 暂未分配主部门。"""


class PersonRow(BaseModel):
    id: int
    code: str
    name: str
    pinyin: str | None
    status: PersonStatus
    engagements: list[PersonEngagementBrief]
    matched: str | None = None
    """检索命中的不是当前姓名时说明命中了什么（曾用名、误录、旧工号…）。"""
    masked_fields: list[str] = []


class PersonDetail(BaseModel):
    id: int
    code: str
    name: str
    """查看日期的姓名（尚未开始时取最早一版）。"""
    pinyin: str | None
    status: PersonStatus
    created_at: datetime
    created_change_id: int
    versions: list[PersonVersionOut]
    engagements: list[PersonEngagementOut]
    masked_fields: list[str] = []


class DepartmentPersonRow(BaseModel):
    """归属某部门的一条人员归属（部门详情的人员区块、承接清单）。"""

    person_id: int
    person_code: str
    person_name: str
    engagement_id: int
    engagement_type: str
    institution_name: str
    assignment_id: int
    kind: str
    valid_from: date
    valid_to: date | None
    not_yet_effective: bool


DepartmentDependencies.model_rebuild()


class DepartmentDutyRow(BaseModel):
    """某部门的一条职务（部门详情的“负责人”与职务清单）。"""

    duty_id: int
    person_id: int
    person_code: str
    person_name: str
    engagement_id: int
    duty: Literal["HEAD", "DEPUTY"]
    mode: Literal["FORMAL", "ACTING", "CARETAKER"]
    label: str
    valid_from: date
    valid_to: date | None
    not_yet_effective: bool
    basis_note: str | None
    """任职依据；A1 之前登记的为空。"""


class DutyRegisterRow(DepartmentDutyRow):
    """部门任职台账的一行 = 一条职务（A1）。任职部门与此人的主部门可以不同（代管）。"""

    department: DeptRef
    """任职部门。"""
    institution_name: str
    engagement_type: str
    primary_department: DeptRef | None
    """此人在查看日期（计划中的职务取开始日）的主部门；暂未分配时为空。"""
    change_id: int
    """登记这条职务的申请。"""


class DepartmentLeaderRow(BaseModel):
    """一个部门在查看日期的负责人依据：当天的部长职务（正式、主持工作、代管）；为空 = 空缺。

    负责人规则与部门详情相同：有主持工作者显示主持工作者并注明部长，否则显示正式部长。"""

    department: DeptRef
    heads: list[DepartmentDutyRow]


class DutyRegister(BaseModel):
    """部门任职台账（A1）。计数只算查看日期当天有效的职务，计划中的另计。"""

    as_of: date
    record_count: int
    """当天有效的职务条数（一人兼两职算两条）。"""
    person_count: int
    """当天担任职务的人数（按人员去重）。"""
    planned_count: int
    """筛选结果里尚未开始的职务条数（含计划时才有）。"""
    rows: list[DutyRegisterRow]
    leaders: list[DepartmentLeaderRow]
    """正式履职的部门（及当天有部长职务的部门）的负责人一览；只受“任职部门”筛选影响。"""
