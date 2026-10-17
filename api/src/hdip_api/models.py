"""ORM 映射。表结构以 migrations/versions/ 为准，这里只做读写映射，不用于建表。"""

from datetime import date, datetime
from typing import Any

from sqlalchemy import ARRAY, BigInteger, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from hdip_api.core.db import Base

NOW = text("LOCALTIMESTAMP")


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text)
    roles: Mapped[list[str]] = mapped_column(ARRAY(Text))
    is_active: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(server_default=NOW)


class OptionItem(Base):
    __tablename__ = "option_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category: Mapped[str] = mapped_column(Text)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool]


class ApprovalRule(Base):
    __tablename__ = "approval_rule"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    object_type: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    confirmer_role: Mapped[str] = mapped_column(Text)
    allow_self_confirm: Mapped[bool]


class ChangeRequest(Base):
    __tablename__ = "change_request"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    status: Mapped[str] = mapped_column(Text, server_default="draft")
    note: Mapped[str | None] = mapped_column(Text)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    results: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    copied_from_id: Mapped[int | None] = mapped_column(ForeignKey("change_request.id"))
    created_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(server_default=NOW)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    submitted_at: Mapped[datetime | None]
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    confirmed_at: Mapped[datetime | None]
    returned_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    returned_at: Mapped[datetime | None]
    return_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    cancelled_at: Mapped[datetime | None]


class _Identity:
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    created_change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=NOW)


class _Version:
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version_no: Mapped[int] = mapped_column(Integer)
    valid_from: Mapped[date]
    valid_to: Mapped[date | None]
    change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))


class Institution(_Identity, Base):
    __tablename__ = "institution"
    __mapper_args__ = {"eager_defaults": True}


class InstitutionVersion(_Version, Base):
    __tablename__ = "institution_version"
    __mapper_args__ = {"eager_defaults": True}

    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    name: Mapped[str] = mapped_column(Text)
    nature: Mapped[str | None] = mapped_column(Text)
    unified_credit_code: Mapped[str | None] = mapped_column(Text)
    medical_reg_code: Mapped[str | None] = mapped_column(Text)
    license_no: Mapped[str | None] = mapped_column(Text)
    license_valid_from: Mapped[date | None]
    license_valid_to: Mapped[date | None]

    CONTENT = (
        "name",
        "nature",
        "unified_credit_code",
        "medical_reg_code",
        "license_no",
        "license_valid_from",
        "license_valid_to",
    )


class Campus(_Identity, Base):
    __tablename__ = "campus"
    __mapper_args__ = {"eager_defaults": True}


class CampusVersion(_Version, Base):
    __tablename__ = "campus_version"
    __mapper_args__ = {"eager_defaults": True}

    campus_id: Mapped[int] = mapped_column(ForeignKey("campus.id"))
    name: Mapped[str] = mapped_column(Text)
    node_role: Mapped[str | None] = mapped_column(Text)  # 已停用，只读历史
    public_name: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    admin_division_code: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    actual_open_date: Mapped[date | None]
    operating_status: Mapped[str] = mapped_column(Text)

    CONTENT = (
        "name",
        "node_role",
        "public_name",
        "address",
        "admin_division_code",
        "phone",
        "actual_open_date",
        "operating_status",
    )


class OperatorRelation(Base):
    __tablename__ = "operator_relation"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    campus_id: Mapped[int] = mapped_column(ForeignKey("campus.id"))
    relation_type: Mapped[str] = mapped_column(Text)
    is_primary: Mapped[bool]
    valid_from: Mapped[date]
    valid_to: Mapped[date | None]
    created_change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    closed_change_id: Mapped[int | None] = mapped_column(ForeignKey("change_request.id"))
    closed_at: Mapped[datetime | None]
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


class Department(_Identity, Base):
    """部门身份：id、管理编码 code、创建申请。名称与属性在 DepartmentVersion。"""

    __tablename__ = "department"
    __mapper_args__ = {"eager_defaults": True}


class DepartmentVersion(_Version, Base):
    __tablename__ = "department_version"
    __mapper_args__ = {"eager_defaults": True}

    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    name: Mapped[str] = mapped_column(Text)
    short_name: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    establishment_form: Mapped[str] = mapped_column(Text)
    temporary_until: Mapped[date | None]
    lifecycle: Mapped[str] = mapped_column(Text)
    admin_grade: Mapped[str | None] = mapped_column(Text)
    duties: Mapped[list[str]] = mapped_column(ARRAY(Text))
    basis_note: Mapped[str | None] = mapped_column(Text)

    CONTENT = (
        "name",
        "short_name",
        "description",
        "establishment_form",
        "temporary_until",
        "lifecycle",
        "admin_grade",
        "duties",
        "basis_note",
    )


class _Period:
    """带期间、经变更申请写入的关系 / 赋值行的公共列。"""

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    valid_from: Mapped[date]
    valid_to: Mapped[date | None]
    change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    closed_change_id: Mapped[int | None] = mapped_column(ForeignKey("change_request.id"))


class DepartmentAlias(_Period, Base):
    __tablename__ = "department_alias"
    __mapper_args__ = {"eager_defaults": True}

    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    kind: Mapped[str] = mapped_column(Text)
    value: Mapped[str] = mapped_column(Text)


class ClassificationScheme(Base):
    """分类方案（配置）：维护人可直接维护，不经变更申请。"""

    __tablename__ = "classification_scheme"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str | None] = mapped_column(Text)
    is_exclusive: Mapped[bool]
    is_active: Mapped[bool]
    meaning_for_department: Mapped[str | None] = mapped_column(Text)
    meaning_for_unit: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=NOW)


class ClassificationCode(Base):
    """分类代码（配置）：代码值不可改，不删除只停用。"""

    __tablename__ = "classification_code"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    scheme_id: Mapped[int] = mapped_column(ForeignKey("classification_scheme.id"))
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    criterion: Mapped[str | None] = mapped_column(Text)
    caution: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool]
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=NOW)


class DepartmentClassification(_Period, Base):
    __tablename__ = "department_classification"
    __mapper_args__ = {"eager_defaults": True}

    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    scheme_id: Mapped[int] = mapped_column(BigInteger)
    is_exclusive: Mapped[bool]
    code: Mapped[str] = mapped_column(Text)


class DepartmentInstitution(_Period, Base):
    __tablename__ = "department_institution"
    __mapper_args__ = {"eager_defaults": True}

    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    is_primary: Mapped[bool]


class DepartmentHierarchy(_Period, Base):
    """组织视图内的一条上下级边。"""

    __tablename__ = "department_hierarchy"
    __mapper_args__ = {"eager_defaults": True}

    view_id: Mapped[int] = mapped_column(ForeignKey("org_view.id"))
    parent_department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    child_department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))


class DepartmentRelation(_Period, Base):
    """专业管理、协作、院区管理。"""

    __tablename__ = "department_relation"
    __mapper_args__ = {"eager_defaults": True}

    kind: Mapped[str] = mapped_column(Text)
    from_department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    to_department_id: Mapped[int | None] = mapped_column(ForeignKey("department.id"))
    campus_id: Mapped[int | None] = mapped_column(ForeignKey("campus.id"))
    scope: Mapped[str] = mapped_column(Text)


class OrgView(Base):
    __tablename__ = "org_view"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str | None] = mapped_column(Text)
    single_parent: Mapped[bool]
    status: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)


class ServiceUnit(_Identity, Base):
    __tablename__ = "service_unit"
    __mapper_args__ = {"eager_defaults": True}

    unit_type: Mapped[str] = mapped_column(Text)


class ServiceUnitVersion(_Version, Base):
    __tablename__ = "service_unit_version"
    __mapper_args__ = {"eager_defaults": True}

    service_unit_id: Mapped[int] = mapped_column(ForeignKey("service_unit.id"))
    name: Mapped[str] = mapped_column(Text)
    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    campus_id: Mapped[int] = mapped_column(ForeignKey("campus.id"))
    institution_id: Mapped[int] = mapped_column(ForeignKey("institution.id"))
    status: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    scope_note: Mapped[str | None] = mapped_column(Text)

    CONTENT = (
        "name",
        "department_id",
        "campus_id",
        "institution_id",
        "status",
        "phone",
        "scope_note",
    )


class ServiceUnitLineage(Base):
    """拆分/合并的前身 → 后继，一行一对；只追加。"""

    __tablename__ = "service_unit_lineage"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    predecessor_id: Mapped[int] = mapped_column(ForeignKey("service_unit.id"))
    successor_id: Mapped[int] = mapped_column(ForeignKey("service_unit.id"))
    lineage_type: Mapped[str] = mapped_column(Text)
    effective_date: Mapped[date]
    change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))


class DepartmentChangeEvent(Base):
    """部门组织变更事件（整体拆分 / 分设 / 吸收合并 / 合并新设）；只追加。"""

    __tablename__ = "department_change_event"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_type: Mapped[str] = mapped_column(Text)
    effective_date: Mapped[date]
    basis_note: Mapped[str] = mapped_column(Text)
    scope_note: Mapped[str | None] = mapped_column(Text)
    other_matters: Mapped[str | None] = mapped_column(Text)
    change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))


class DepartmentChangeParticipant(Base):
    """参与部门：原部门 / 结果部门，身份结论 存续 / 退出 / 新设；只追加。"""

    __tablename__ = "department_change_participant"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("department_change_event.id"))
    department_id: Mapped[int] = mapped_column(ForeignKey("department.id"))
    role: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text)
    scope_note: Mapped[str | None] = mapped_column(Text)


class ServiceUnitClassification(_Period, Base):
    __tablename__ = "service_unit_classification"
    __mapper_args__ = {"eager_defaults": True}

    service_unit_id: Mapped[int] = mapped_column(ForeignKey("service_unit.id"))
    scheme_id: Mapped[int] = mapped_column(BigInteger)
    is_exclusive: Mapped[bool]
    code: Mapped[str] = mapped_column(Text)


class SourceSystem(Base):
    """来源系统实例（配置）。"""

    __tablename__ = "source_system"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool]
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=NOW)


class CodeNamespace(Base):
    """来源系统里的一本字典（配置）。"""

    __tablename__ = "code_namespace"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_system_id: Mapped[int] = mapped_column(ForeignKey("source_system.id"))
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool]
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=NOW)


class ExternalCode(Base):
    """台账里的一条源记录：身份行不可更新。"""

    __tablename__ = "external_code"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    namespace_id: Mapped[int] = mapped_column(ForeignKey("code_namespace.id"))
    code: Mapped[str] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(Text)
    semantic_note: Mapped[str | None] = mapped_column(Text)
    created_change_id: Mapped[int] = mapped_column(ForeignKey("change_request.id"))
    recorded_at: Mapped[datetime] = mapped_column(server_default=NOW)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))


class ExternalCodeAssignment(_Period, Base):
    """一条源记录在某段期间的解释：部门、服务单元或对象未建模，可带院区条件。"""

    __tablename__ = "external_code_assignment"
    __mapper_args__ = {"eager_defaults": True}

    external_code_id: Mapped[int] = mapped_column(ForeignKey("external_code.id"))
    target_type: Mapped[str] = mapped_column(Text)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("department.id"))
    service_unit_id: Mapped[int | None] = mapped_column(ForeignKey("service_unit.id"))
    unmodeled_type: Mapped[str | None] = mapped_column(Text)
    campus_id: Mapped[int | None] = mapped_column(ForeignKey("campus.id"))
    evidence_note: Mapped[str | None] = mapped_column(Text)
