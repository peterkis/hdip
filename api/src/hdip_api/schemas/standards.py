"""标准资料库的条目正文与读取响应（迁移 0023，docs/标准资料库-F0F1开发计划.md）。

条目类型由代码固定；每种类型一个正文结构，导入时校验，读取时原样给出。原记录另在 raw 里。
"""

from datetime import datetime
from typing import Literal

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
    raw_cells: list[str]


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
    source_issues: list[str] = []
    evidence: list[Evidence] = []


# ---------------------------------------------------------------- 读取响应


class StandardDocumentRow(BaseModel):
    id: int
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


class DocumentRef(BaseModel):
    id: int
    standard_no: str
    standard_year: str | None
    reader_version: str


class StandardEntryRow(BaseModel):
    id: int
    entry_type: EntryType
    identifier: str | None
    name: str | None
    document: DocumentRef
    parent_id: int | None = None


class ReferenceTarget(BaseModel):
    entry_id: int
    identifier: str | None
    name: str | None
    document: DocumentRef


class ReferenceOut(BaseModel):
    field: str
    ref_kind: Literal["value_domain", "external_standard"]
    raw_text: str
    target_standard: str
    target_year: str | None
    target_identifier: str | None
    target_label: str | None
    resolution: Resolution
    targets: list[ReferenceTarget] = Field(description="explicit / catalog 一项，candidates 多项")
    other_versions: list[ReferenceTarget] = Field(
        default=[], description="原文写明年份但本库只收录了其他年份时列出，供阅读，不等价"
    )


class IncomingReference(BaseModel):
    entry: StandardEntryRow
    raw_text: str
    resolution: Resolution


class StandardEntryDetail(BaseModel):
    id: int
    entry_type: EntryType
    source_key: str
    identifier: str | None
    name: str | None
    seq: int
    document: DocumentRef
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


class StandardCodeRow(BaseModel):
    id: int
    code: str
    name: str
    description: str
    hierarchy_level: int | None
    parent_code: str | None
