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
    "department-hierarchy",
    "department-relations",
    "external-codes",
    "classifications",
    "department-lineage",
    "persons",
    "person-relations",
    "person-duties",
]

# 人员数据集：需要“导出人员数据”权限，敏感字段按当前用户隐去（人员设计第 7.3、8 节）。
# 值 = 该数据集支持的筛选（与对应页面同口径，A1）；其他数据集不接受筛选
PERSON_DATASETS: dict[str, set[str]] = {
    "persons": {"q", "status", "department_id", "include_future"},
    "person-relations": {"q", "status", "department_id", "include_future"},
    "person-duties": {"q", "department_id", "duty", "mode", "include_future"},
}

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
DEPT_RELATION = {
    "PROFESSIONAL_MGMT": "专业管理",
    "COLLABORATION": "协作",
    "CAMPUS_MGMT": "院区管理",
}
RELATION_TYPE = {"OPERATE": "运营", "REGISTER": "登记", "MANAGE": "管理", "CHARGE": "收费"}
LINEAGE_TYPE = {"SPLIT": "拆分", "MERGE": "合并"}
REORG_TYPE = {"SPLIT": "整体拆分", "SPLIT_OFF": "分设", "ABSORB": "吸收合并", "MERGE": "合并新设"}
REORG_ROLE = {"SOURCE": "原部门", "RESULT": "结果部门"}
REORG_OUTCOME = {"CONTINUES": "存续", "EXITS": "退出", "NEW": "新设"}
TARGET_TYPE = {"department": "部门", "service_unit": "服务单元", "unmodeled": "对象未建模"}


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
            "unit_pinyin": v.pinyin,
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
            "admin_level": d.level,
            "admin_parent_code": d.parent.code if d.parent else None,
            "admin_parent_name": d.parent.name if d.parent else None,
            "department_pinyin": v.pinyin,
        }


def _hierarchy(s: Session, day: date) -> Iterable[dict]:
    """行政视图在查看日期的结构：每个已设立部门一行，含层级与直接上级。"""
    for d in queries.list_departments(s, day):
        if d.not_yet_effective:
            continue
        yield {
            "view_code": "ADMIN",
            "department_code": d.code,
            "department_name": d.version.name,
            "level": d.level,
            "parent_code": d.parent.code if d.parent else None,
            "parent_name": d.parent.name if d.parent else None,
        }


def _department_relations(s: Session, day: date) -> Iterable[dict]:
    """查看日期当天有效的专业管理、协作、院区管理关系。"""
    seen: set[int] = set()
    for d in queries.list_departments(s, day):
        for r in queries.get_department(s, d.id, day).relations:
            if r.id in seen or not queries.covers(r.valid_from, r.valid_to, day):
                continue
            seen.add(r.id)
            yield {
                "relation_id": r.id,
                "relation_kind": r.kind,
                "relation_kind_name": DEPT_RELATION[r.kind],
                "from_code": r.from_department.code,
                "from_name": r.from_department.name,
                "to_code": r.to_department.code if r.to_department else None,
                "to_name": r.to_department.name if r.to_department else None,
                "campus_name": r.campus_name,
                "scope": r.scope,
                "valid_from": r.valid_from,
                "valid_to": r.valid_to,
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
            "public_name": v.public_name,
            "actual_open_date": v.actual_open_date,
            "version_no": v.version_no,
            "valid_from": v.valid_from,
            "valid_to": v.valid_to,
            "campus_pinyin": v.pinyin,
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


def _persons(s: Session, day: date, user, filters: dict) -> Iterable[dict]:
    """与名册同口径：默认当天有有效任用的人员，一人一行（按人去重）。"""
    from hdip_api.services import person_queries

    statuses = _options(s, "person_relation_status")
    for r in person_queries.export_persons(s, user, day, **filters):
        yield r | {"relation_status_name": statuses.get(r["relation_status"])}


def _person_relations(s: Session, day: date, user, filters: dict) -> Iterable[dict]:
    """名册里的任用 × 当天的主归属；暂未分配时部门列为空（不写成“离职”）。"""
    from hdip_api.services import person_queries

    types = _options(s, "engagement_type")
    kinds = _options(s, "assignment_kind")
    for r in person_queries.export_relations(s, user, day, **filters):
        yield r | {
            "engagement_type_name": types.get(r["engagement_type"]),
            "assignment_kind_name": kinds.get(r["assignment_kind"]),
        }


def _person_duties(s: Session, day: date, user, filters: dict) -> Iterable[dict]:
    """部门任职台账：一行一条职务；依据为空 = A1 之前的记录未提供依据。"""
    from hdip_api.services import person_queries

    types = _options(s, "engagement_type")
    for r in person_queries.export_duties(s, user, day, **filters):
        yield r | {"engagement_type_name": types.get(r["engagement_type"])}


def _department_lineage(s: Session, day: date) -> Iterable[dict]:
    """查看日期及之前已生效的部门组织变更，一行一个参与部门（沿革是累积的历史事实）。"""
    from hdip_api.models import Department, DepartmentChangeEvent, DepartmentChangeParticipant

    rows = s.execute(
        select(DepartmentChangeEvent, DepartmentChangeParticipant, Department.code)
        .join(
            DepartmentChangeParticipant,
            DepartmentChangeParticipant.event_id == DepartmentChangeEvent.id,
        )
        .join(Department, Department.id == DepartmentChangeParticipant.department_id)
        .where(DepartmentChangeEvent.effective_date <= day)
        .order_by(
            DepartmentChangeEvent.effective_date,
            DepartmentChangeEvent.id,
            DepartmentChangeParticipant.id,
        )
    ).all()
    names = {d.code: d.version.name for d in queries.list_departments(s, day)} if rows else {}
    for e, p, code in rows:
        yield {
            "event_id": e.id,
            "event_type": e.event_type,
            "event_type_name": REORG_TYPE[e.event_type],
            "effective_date": e.effective_date,
            "department_code": code,
            "department_name": names.get(code),
            "role": p.role,
            "role_name": REORG_ROLE[p.role],
            "outcome": p.outcome,
            "outcome_name": REORG_OUTCOME[p.outcome],
            "scope_note": p.scope_note,
            "basis_note": e.basis_note,
            "change_id": e.change_id,
        }


def _external_codes(s: Session, day: date) -> Iterable[dict]:
    """当天有效、指向平台对象的解释。

    待裁决（当天没有解释）与“对象未建模”的源记录都不进入导出：导出回答“外部代码对应平台哪个对象”。
    """
    from hdip_api.services.apply import UNMODELED_LABELS

    codes = queries._Codes(s, day)
    for ec in sorted(codes.codes.values(), key=lambda x: (x.namespace_id, x.code)):
        row = codes.row(ec)
        for a in row["current"]:
            if a.target_type == "unmodeled":
                continue
            target = a.department or a.service_unit
            yield {
                "system_code": row["system_code"],
                "namespace_code": row["namespace_code"],
                "external_code": ec.code,
                "source_name": ec.source_name,
                "target_type": a.target_type,
                "target_type_name": TARGET_TYPE[a.target_type],
                "target_code": target.code if target else None,
                "target_name": target.name if target else None,
                "unmodeled_type": a.unmodeled_type,
                "unmodeled_type_name": UNMODELED_LABELS.get(a.unmodeled_type or ""),
                "campus_code": a.campus_code,
                "campus_name": a.campus_name,
                "valid_from": a.valid_from,
                "valid_to": a.valid_to,
            }


def _classifications(s: Session, day: date) -> Iterable[dict]:
    """当天有效的分类赋值：部门与服务单元分开列出，部门分类不下发给单元。"""
    from hdip_api.models import (
        Department,
        DepartmentClassification,
        DepartmentVersion,
        ServiceUnit,
        ServiceUnitClassification,
        ServiceUnitVersion,
    )

    names = queries._ClassNames(s)
    sources = [
        ("department", Department, DepartmentClassification, "department_id", DepartmentVersion),
        (
            "service_unit",
            ServiceUnit,
            ServiceUnitClassification,
            "service_unit_id",
            ServiceUnitVersion,
        ),
    ]
    for object_type, ident, model, fk, version in sources:
        objs = {o.id: o for o in s.scalars(select(ident))}
        versions = queries._versions_by(s, version, fk)
        rows = [
            r for r in s.scalars(select(model)) if queries.covers(r.valid_from, r.valid_to, day)
        ]
        for r in sorted(rows, key=lambda r: (objs[getattr(r, fk)].code, r.scheme_id, r.code)):
            obj = objs[getattr(r, fk)]
            ref = names.ref(r.scheme_id, r.code)
            yield {
                "object_type": object_type,
                "object_code": obj.code,
                "object_name": queries._name_on(versions[obj.id], day),
                "scheme_code": ref.scheme_code,
                "scheme_name": ref.scheme_name,
                "class_code": ref.code,
                "class_name": ref.name,
                "valid_from": r.valid_from,
                "valid_to": r.valid_to,
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
        "admin_level", "admin_parent_code", "admin_parent_name",
    ]),
    "department-hierarchy": (_hierarchy, [
        "view_code", "department_code", "department_name", "level", "parent_code", "parent_name",
    ]),
    "department-relations": (_department_relations, [
        "relation_id", "relation_kind", "relation_kind_name", "from_code", "from_name",
        "to_code", "to_name", "campus_name", "scope", "valid_from", "valid_to",
    ]),
    "campuses": (_campuses, [
        "campus_code", "campus_name", "node_role", "node_role_name",
        "operating_status", "operating_status_name",
        "primary_operator_code", "primary_operator_name",
        "address", "admin_division_code", "phone", "actual_open_date",
        "version_no", "valid_from", "valid_to", "public_name",
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
    "department-lineage": (_department_lineage, [
        "event_id", "event_type", "event_type_name", "effective_date",
        "department_code", "department_name", "role", "role_name", "outcome", "outcome_name",
        "scope_note", "basis_note", "change_id",
    ]),
    "external-codes": (_external_codes, [
        "system_code", "namespace_code", "external_code", "source_name",
        "target_type", "target_type_name", "target_code", "target_name",
        "unmodeled_type", "unmodeled_type_name", "campus_code", "campus_name",
        "valid_from", "valid_to",
    ]),
    "classifications": (_classifications, [
        "object_type", "object_code", "object_name", "scheme_code", "scheme_name",
        "class_code", "class_name", "valid_from", "valid_to",
    ]),
    "persons": (_persons, [
        "person_code", "name", "pinyin", "relation_status", "relation_status_name",
    ]),
    "person-relations": (_person_relations, [
        "person_code", "name", "institution_code", "institution_name",
        "engagement_type", "engagement_type_name", "work_no",
        "engagement_valid_from", "engagement_valid_to",
        "assignment_kind", "assignment_kind_name", "department_code", "department_name",
        "assignment_valid_from", "assignment_valid_to", "not_yet_effective",
    ]),
    "person-duties": (_person_duties, [
        "department_code", "department_name", "duty", "mode", "label",
        "person_code", "name", "institution_name", "engagement_type", "engagement_type_name",
        "primary_department_code", "primary_department_name",
        "valid_from", "valid_to", "not_yet_effective", "basis_note", "change_id",
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


def to_csv(s: Session, dataset: Dataset, day: date, user=None, filters: dict | None = None) -> str:
    fn, columns = BUILDERS[dataset]
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)
    rows = fn(s, day, user, filters or {}) if dataset in PERSON_DATASETS else fn(s, day)
    for row in rows:
        writer.writerow([_cell(row[c]) for c in columns])
    return buf.getvalue()
