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
    node_role: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    admin_division_code: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    actual_open_date: Mapped[date | None]
    operating_status: Mapped[str] = mapped_column(Text)

    CONTENT = (
        "name",
        "node_role",
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
