"""标准资料库的条目正文与读取响应（迁移 0023，docs/标准资料库-F0F1开发计划.md）。

条目类型由代码固定；每种类型一个正文结构，导入时校验，读取时原样给出。原记录另在 raw 里。
"""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

EntryType = Literal["data_element", "value_domain", "code_row"]
ENTRY_TYPE_LABELS: dict[str, str] = {
    "data_element": "数据元",
    "value_domain": "值域表",
    "code_row": "代码",
}

# 允许值的原性质：空 / 引用其他标准或值域 / 原文直接写出的取值说明
AllowedValueNature = Literal["empty", "reference", "text"]
# 引用解析：原文写明年份且命中 / 原文未写年份、按本库目录定位 / 本库未收录 / 多个候选
Resolution = Literal["explicit", "catalog", "unresolved", "candidates"]
# 定位依据：标准号原样一致 / 来源写 WS 364.x、本库收录为 WS/T 364.x（已知前缀差异，受限回退）
MatchBasis = Literal["exact", "prefix_variant"]
# 来源引用名称与目标表名：一致 / 只差“代码”“表”等后缀写法 / 主体名称不同（待人工核对）
LabelCheck = Literal["same", "minor", "different"]
# 不属于解析结果的阅读提示：引用分册没有、其他分册有同编号表 / 其他处理修订有同标识条目 /
# 本库有前缀差异的同编号表、但名称不一致而未定位
RelatedKind = Literal["other_part", "other_revision", "prefix_variant_conflict"]
# 证据可用性：包内有 / 只有外部链接（未核实可访问）/ 资料记了路径但未随包提供
Availability = Literal["in_package", "external", "not_in_package"]


class DataElementBody(BaseModel):
    identifier: str = Field(description="数据元标识符，如 DE02.01.031.00")
    name: str
    definition: str
    data_type: str = Field(description="数据元值的数据类型，原文，如 S3")
    format: str = Field(description="表示格式，原文，如 N2")
    allowed_values: str = Field(description="数据元允许值原文（保留换行）")
    allowed_value_nature: AllowedValueNature
    version: str | None = Field(None, description="数据元版本，如 V1.1")
    section: str | None = None


class ValueDomainBody(BaseModel):
    identifier: str = Field(description="值域代码，如 CV02.01.101")
    name: str
    definition: str
    structure: str
    definition_raw: str = Field(description="定义与编码结构原文段落")
    column_headers: list[str] | None = None


class CodeRowBody(BaseModel):
    code: str = Field(description="码值，字符串原样（保留前导零）")
    name: str
    description: str
    hierarchy_level: int | None = None
    parent_code: str | None = None
    raw_cells: list[str | None] = Field(
        description="原表格各列；null 表示原表未提供（v1 曾记成“None”）"
    )


class Evidence(BaseModel):
    kind: Literal["image", "pdf"]
    label: str
    path: str | None = None
    url: str | None = None
    availability: Availability


class Provenance(BaseModel):
    """出处：资料里有什么记什么，缺项保持为空。"""

    member: str = Field(description="包内成员路径")
    json_pointer: str = Field(description="成员内 JSON 位置，如 [123]")
    record_id: str | None = Field(None, description="原资料的记录 ID（row_id 等）")
    pdf_pages: list[int] = []
    printed_pages: list[str] = []
    table_ref: str | None = Field(None, description="表 / 片段 / 行，如“片段 1 第 2 行”")
    source_pdf: str | None = None
    source_url: str | None = None
    source_sha256: str | None = None
    qa_status: str | None = Field(None, description="资料中的复核状态，原值")
    import_gate: str | None = Field(None, description="资料中的 automatic_import_gate，原值")
    source_issues: list[str | dict[str, Any]] = Field(
        default=[], description="资料记载的问题：文字或原对象（v1 曾把对象记成 Python 字面形式）"
    )
    evidence: list[Evidence] = []


# ---------------------------------------------------------------- 读取响应


class DocumentRef(BaseModel):
    id: int
    standard_no: str
    standard_year: str | None
    reader: str
    reader_version: str
    is_current: bool = Field(
        description="当前处理修订：同一包、资料族、读取器、标准号、原文年份里读取器版本最高的一份"
    )


class StandardDocumentRow(BaseModel):
    id: int
    series: str = Field(description="标准系列，如 WS/T 363（标准号去掉分册）")
    standard_no: str
    standard_year: str | None
    title: str | None
    family: str
    package_file: str
    reader: str
    reader_version: str
    total_records: int
    covered_keys: int
    counts: dict[str, int] = Field(description="各条目类型已接入数")
    imported_at: datetime
    is_current: bool
    newer_revision: DocumentRef | None = Field(
        None, description="历史处理修订时：同一来源文档的当前处理修订（不是新版标准）"
    )


class PackageOut(BaseModel):
    id: int
    file_name: str
    stored_path: str
    bytes: int
    sha256: str
    expected_sha256: str | None
    sha_check: Literal["matched", "not_compared"]
    release_id: str | None
    drive_file_id: str | None
    source_url: str | None
    member_count: int
    registered_at: datetime


class StandardDocumentDetail(StandardDocumentRow):
    package: PackageOut
    members: list[dict]
    source_version: str | None
    source_sha256: str | None
    source_pdf: str | None
    source_url: str | None
    revisions: list[DocumentRef] = Field(
        description="同一来源文档的全部处理修订（含本份），按读取器版本从低到高"
    )
    edition: "EditionRef | None" = Field(
        None, description="所属标准：标准号与年份完全相同的目录记录；目录未登记为空"
    )
    file_id: int | None = Field(
        None, description="所据原文：所属标准下摘要与 source_sha256 相同的文件；没有为空"
    )


class ParentRef(BaseModel):
    id: int
    identifier: str | None
    name: str | None


class StandardEntryRow(BaseModel):
    id: int
    entry_type: EntryType
    identifier: str | None
    name: str | None
    document: DocumentRef
    parent_id: int | None = None
    parent: ParentRef | None = Field(None, description="代码行所属的值域表")


class StandardEntryPage(BaseModel):
    items: list[StandardEntryRow]
    total: int = Field(description="符合筛选的条目总数（不是本页条数）")
    offset: int
    limit: int


class ReferenceTarget(BaseModel):
    entry_id: int
    identifier: str | None
    name: str | None
    document: DocumentRef
    label_check: LabelCheck | None = Field(
        None, description="来源引用名称与本表名称的比较；来源没写名称时为空"
    )


class RelatedTarget(BaseModel):
    """阅读提示，不是解析结果：不等价、不改指。"""

    kind: RelatedKind
    note: str
    target: ReferenceTarget


class ReferenceOut(BaseModel):
    field: str
    ref_kind: Literal["value_domain", "external_standard"]
    raw_text: str
    target_standard: str
    target_year: str | None
    target_identifier: str | None
    target_label: str | None
    identifier_as_written: str | None = Field(
        None, description="原文里的值域编号写法；与 target_identifier 不同说明做过排版空白归一"
    )
    identifier_normalized: bool = False
    identifier_incomplete: bool = Field(False, description="原文值域编号不完整，不解析、不补全")
    resolution: Resolution
    match_basis: MatchBasis | None = None
    resolution_note: str | None = None
    targets: list[ReferenceTarget] = Field(description="explicit / catalog 一项，candidates 多项")
    other_versions: list[ReferenceTarget] = Field(
        default=[], description="原文写明年份但本库只收录了其他年份时列出，供阅读，不等价"
    )
    related: list[RelatedTarget] = Field(default=[], description="未解析时的阅读提示")


class IncomingReference(BaseModel):
    entry: StandardEntryRow
    raw_text: str
    resolution: Resolution
    match_basis: MatchBasis | None = None
    label_check: LabelCheck | None = None


class StandardEntryDetail(BaseModel):
    id: int
    entry_type: EntryType
    source_key: str
    identifier: str | None
    name: str | None
    seq: int
    document: DocumentRef
    newer_revision: DocumentRef | None = Field(
        None, description="本条目属于历史处理修订时，同一来源文档的当前处理修订"
    )
    data_element: DataElementBody | None = None
    value_domain: ValueDomainBody | None = None
    code_row: CodeRowBody | None = None
    parent: StandardEntryRow | None = None
    codes: list["StandardCodeRow"] = Field(default=[], description="值域表的代码行，按原顺序")
    references: list[ReferenceOut] = []
    referenced_by: list[IncomingReference] = []
    provenance: Provenance
    raw: dict
    imported_at: datetime
    edition: "EditionRef | None" = Field(None, description="所属标准（按所在处理修订）")
    file_id: int | None = Field(
        None, description="所据原文文件（摘要与所在处理修订一致）；有它才可按物理页打开出处"
    )


class StandardCodeRow(BaseModel):
    id: int
    code: str
    name: str
    description: str
    hierarchy_level: int | None
    parent_code: str | None


# ---------------------------------------------------------------- 标准目录与原文（迁移 0025）

# 读取时推算：现行 / 即将实施（现行且实施日期晚于今天）/ 废止 / 待核实（没有官方状态）
EditionStatus = Literal["current", "upcoming", "abolished", "unverified"]
FileRole = Literal["TEXT", "BOUND", "ERRATA", "PAGE_IMAGE", "ORIGINAL_FORMAT"]


class EditionRef(BaseModel):
    id: int
    standard_no: str
    standard_year: str
    title: str


class StandardEditionRow(BaseModel):
    id: int
    series: str = Field(description="GB / GB/T / WS / WS/T")
    standard_no: str
    standard_year: str
    title: str
    status: EditionStatus
    verified_on: date | None
    issued_on: date | None
    effective_on: date | None
    catalog_category: str | None
    difference: str | None = Field(description="官网目录与文件不一致的类别，原样")
    text_files: int = Field(description="正文、合订、官方原格式文件数")
    page_images: int
    other_files: int = Field(description="修改单等其他文件数")
    counts: dict[str, int] = Field(
        description="当前处理修订的各条目类型数（多份处理修订相加）；没有结构化成果为空"
    )


class StandardEditionPage(BaseModel):
    items: list[StandardEditionRow]
    total: int = Field(description="符合筛选的标准总数（不是本页条数）")
    offset: int
    limit: int


class EditionVersionOut(BaseModel):
    seq: int
    title: str
    catalog_code: str | None
    catalog_category: str | None
    status: Literal["CURRENT", "ABOLISHED"] | None
    issued_on: date | None
    effective_on: date | None
    abolished_on: date | None
    verified_on: date | None
    basis_url: str | None
    basis_note: str | None
    online_url: str | None
    difference: str | None
    file_identity: str | None
    note: str | None
    change_note: str
    recorded_at: datetime


class StandardFileOut(BaseModel):
    id: int
    role: FileRole
    source: str
    identity_check: str
    page_image: bool
    file_name: str
    media_type: str
    bytes: int
    sha256: str
    note: str | None
    registered_at: datetime


class EditionRevision(BaseModel):
    """挂在本标准下的一份处理修订（标准号 + 年份相同）。"""

    document: DocumentRef
    package_file: str
    total_records: int
    covered_keys: int
    counts: dict[str, int]
    source_sha256: str | None
    file_id: int | None = Field(description="摘要相同的原文文件；没有为空，不按页码跳转")


class StandardEditionDetail(StandardEditionRow):
    current: EditionVersionOut
    versions: list[EditionVersionOut] = Field(description="目录信息的登记历史，按 seq 从早到晚")
    files: list[StandardFileOut]
    revisions: list[EditionRevision] = Field(description="全部处理修订，当前的排在前面")


StandardDocumentDetail.model_rebuild()
StandardEntryDetail.model_rebuild()
