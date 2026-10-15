"""按日期的只读导出（设计文档第 6 节“最小只读输出”）：CSV，供其他系统取用。

- 只含查看日期当天有效的记录：尚未生效的计划对象、已退出的单元都不含；暂停的单元含，看 status。
- 列名用英文字段名（与只读接口一致，作为对外契约保持稳定），码值另附中文名列。
- UTF-8 带 BOM，Excel 直接打开不乱码。
- 部门暂无版本：名称与状态为当前值（设计文档第 6 节局限）。
"""

import csv
import io
from collections.abc import Callable, Iterable
from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.models import OptionItem
from hdip_api.services import queries

Dataset = Literal[
    "service-units",
    "departments",
    "campuses",
    "institutions",
    "operator-relations",
    "service-unit-lineage",
]

OPERATING_STATUS = {
    "PLANNING": "筹建",
    "TRIAL_RUNNING": "试运行",
    "RUNNING": "运行",
    "SUSPENDED": "停用",
}
UNIT_STATUS = {"ACTIVE": "在用", "SUSPENDED": "暂停"}
LIFECYCLE = {
    "PREPARING": "筹备",
    "ACTIVE": "正式履职",
    "SUSPENDED": "暂停履职",
    "REVOKED": "撤销",
    "SUPERSEDED": "被替代",
}
FORM = {"STANDING": "常设部门", "TEMPORARY": "经批准的临时部门"}
RELATION_TYPE = {"OPERATE": "运营", "REGISTER": "登记", "MANAGE": "管理", "CHARGE": "收费"}
LINEAGE_TYPE = {"SPLIT": "拆分", "MERGE": "合并"}


def _options(s: Session, category: str) -> dict[str, str]:
    rows = s.scalars(select(OptionItem).where(OptionItem.category == category))
    return {o.code: o.name for o in rows}


def _service_units(s: Session, day: date) -> Iterable[dict]:
    types = _options(s, "service_unit_type")
    for r in queries.list_service_units(s, day, include_future=False):
        v = r.version
        yield {
            "unit_code": r.code,
            "unit_name": v.name,
            "unit_type": r.unit_type,
            "unit_type_name": types.get(r.unit_type, r.unit_type),
            "status": v.status,
            "status_name": UNIT_STATUS[v.status],
            "department_code": v.department_code,
            "department_name": v.department_name,
            "department_status": v.department_lifecycle,
            "campus_code": v.campus_code,
            "campus_name": v.campus_name,
            "institution_code": v.institution_code,
            "institution_name": v.institution_name,
            "phone": v.phone,
            "scope_note": v.scope_note,
            "version_no": v.version_no,
            "valid_from": v.valid_from,
            "valid_to": v.valid_to,
        }


def _departments(s: Session, day: date) -> Iterable[dict]:
    """当天已设立的部门（不含计划中尚未设立的）。status 列自 D1 起为组织生命周期。"""
    for d in queries.list_departments(s, day):
        if d.not_yet_effective:
            continue
        v, c = d.version, d.main_class
        yield {
            "department_code": d.code,
            "department_name": v.name,
            "status": v.lifecycle,
            "status_name": LIFECYCLE[v.lifecycle],
            "unit_count": d.unit_count,
            "short_name": v.short_name,
            "main_class": c.code if c else None,
            "main_class_name": c.name if c else None,
            "establishment_form": v.establishment_form,
            "establishment_form_name": FORM[v.establishment_form],
            "temporary_until": v.temporary_until,
            "admin_grade": v.admin_grade,
            "duties": "、".join(v.duties),
            "institution_name": d.institution_name,
            "version_no": v.version_no,
            "valid_from": v.valid_from,
            "valid_to": v.valid_to,
        }


def _campuses(s: Session, day: date) -> Iterable[dict]:
    roles = _options(s, "campus_node_role")
    for r in queries.list_campuses(s, day):
        if r.not_yet_effective:
            continue
        v, p = r.version, r.primary_operator
        yield {
            "campus_code": r.code,
            "campus_name": v.name,
            "node_role": v.node_role,
            "node_role_name": roles.get(v.node_role) if v.node_role else None,
            "operating_status": v.operating_status,
            "operating_status_name": OPERATING_STATUS[v.operating_status],
            "primary_operator_code": p.code if p else None,
            "primary_operator_name": p.name if p else None,
            "address": v.address,
            "admin_division_code": v.admin_division_code,
            "phone": v.phone,
            "actual_open_date": v.actual_open_date,
            "version_no": v.version_no,
            "valid_from": v.valid_from,
            "valid_to": v.valid_to,
        }


def _institutions(s: Session, day: date) -> Iterable[dict]:
    for r in queries.list_institutions(s, day):
        if r.not_yet_effective:
            continue
        v = r.version
        yield {
            "institution_code": r.code,
            "institution_name": v.name,
            "nature": v.nature,
            "unified_credit_code": v.unified_credit_code,
            "medical_reg_code": v.medical_reg_code,
            "license_no": v.license_no,
            "license_valid_from": v.license_valid_from,
            "license_valid_to": v.license_valid_to,
            "version_no": v.version_no,
            "valid_from": v.valid_from,
            "valid_to": v.valid_to,
        }


def _relations(s: Session, day: date) -> Iterable[dict]:
    for r in queries.list_relations(s, day):
        yield {
            "relation_id": r.id,
            "institution_code": r.institution_code,
            "institution_name": r.institution_name,
            "campus_code": r.campus_code,
            "campus_name": r.campus_name,
            "relation_type": r.relation_type,
            "relation_type_name": RELATION_TYPE[r.relation_type],
            "is_primary": r.is_primary,
            "valid_from": r.valid_from,
            "valid_to": r.valid_to,
        }


def _lineage(s: Session, day: date) -> Iterable[dict]:
    """查看日期及之前已生效的全部演变关系（演变是累积的历史事实，不按“当天”截取）。"""
    for r in queries.list_lineage(s, until=day):
        yield {
            "lineage_type": r.lineage_type,
            "lineage_type_name": LINEAGE_TYPE[r.lineage_type],
            "effective_date": r.effective_date,
            "predecessor_code": r.predecessor_code,
            "predecessor_name": r.predecessor_name,
            "successor_code": r.successor_code,
            "successor_name": r.successor_name,
            "change_id": r.change_id,
        }


# 列顺序即对外契约；新增列只加在末尾
# fmt: off
BUILDERS: dict[str, tuple[Callable[[Session, date], Iterable[dict]], list[str]]] = {
    "service-units": (_service_units, [
        "unit_code", "unit_name", "unit_type", "unit_type_name", "status", "status_name",
        "department_code", "department_name", "department_status",
        "campus_code", "campus_name", "institution_code", "institution_name",
        "phone", "scope_note", "version_no", "valid_from", "valid_to",
    ]),
    "departments": (_departments, [
        "department_code", "department_name", "status", "status_name", "unit_count",
        "short_name", "main_class", "main_class_name", "establishment_form",
        "establishment_form_name", "temporary_until", "admin_grade", "duties",
        "institution_name", "version_no", "valid_from", "valid_to",
    ]),
    "campuses": (_campuses, [
        "campus_code", "campus_name", "node_role", "node_role_name",
        "operating_status", "operating_status_name",
        "primary_operator_code", "primary_operator_name",
        "address", "admin_division_code", "phone", "actual_open_date",
        "version_no", "valid_from", "valid_to",
    ]),
    "institutions": (_institutions, [
        "institution_code", "institution_name", "nature", "unified_credit_code",
        "medical_reg_code", "license_no", "license_valid_from", "license_valid_to",
        "version_no", "valid_from", "valid_to",
    ]),
    "operator-relations": (_relations, [
        "relation_id", "institution_code", "institution_name", "campus_code", "campus_name",
        "relation_type", "relation_type_name", "is_primary", "valid_from", "valid_to",
    ]),
    "service-unit-lineage": (_lineage, [
        "lineage_type", "lineage_type_name", "effective_date",
        "predecessor_code", "predecessor_name", "successor_code", "successor_name", "change_id",
    ]),
}
# fmt: on


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def to_csv(s: Session, dataset: Dataset, day: date) -> str:
    fn, columns = BUILDERS[dataset]
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)
    for row in fn(s, day):
        writer.writerow([_cell(row[c]) for c in columns])
    return buf.getvalue()
