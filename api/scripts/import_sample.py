"""把院方整理的“统一部门服务单元分类映射”资料包导入为开发库的样例数据。

用法（在 api/ 下）：uv run python scripts/import_sample.py <资料包目录> [--user solo]

资料包是候选基线（DRAFT_NOT_PRODUCTION），所以这里只做两件事：
1. 配置（维护人可直接维护，不经申请）：来源系统与字典、外部分类方案及其正式代码表。
2. 业务数据一律生成变更申请并提交，由确认人在页面上确认，脚本不代为确认：
   - 院区：本部院区更名、高新院区运行、新增中心院区及其运营关系；
   - 部门：资料包的行政部门树（心血管内科与已有的 XNK 是同一部门，不重复新建）；
   - HIS 科室字典：全部源代码登记入台账；只解释证据明确的几类，其余留作待裁决。
   部门申请确认后再运行一次本脚本，才会生成 HIS 字典申请（它引用这些部门）。

脚本可重复运行：已有的配置跳过，已生成过的申请（按说明里的标记识别）不再生成。
资料包要求不自动补值的字段（院区、组织生效日、启停状态、企业微信原生 ID 等）一律不推断：
部门与解释的开始日取资料包的记录日期 2026-10-16，并在说明里写明它不是真实设立日。
资料包里的脚本一概不运行，只读取 02_机器可读/ 下的 CSV。
"""

import argparse
import csv
import sys
from pathlib import Path

from sqlalchemy import select

from hdip_api.core.db import SessionLocal
from hdip_api.core.errors import BusinessError
from hdip_api.models import (
    AppUser,
    ChangeRequest,
    ClassificationCode,
    ClassificationScheme,
    CodeNamespace,
    Department,
    SourceSystem,
)
from hdip_api.schemas.items import ITEMS_ADAPTER
from hdip_api.services import workflow

RECORDED_ON = "2026-10-16"  # 资料包的记录日期，不是任何对象的真实生效日
INSTITUTION = "CD3"
# 资料包里的心血管内科 D0042 就是库里已有的 XNK
SAME_DEPARTMENT = {"D0042": "XNK"}

TAG_CAMPUS = "[样例导入:院区]"
TAG_DEPT = "[样例导入:部门]"
TAG_HIS = "[样例导入:HIS科室字典]"

# 外部分类方案：资料包目录 → (方案代码, 名称, 用于部门的含义, 用于服务单元的含义)
SCHEMES = {
    "DIAGNOSTIC": (
        "DIAGNOSTIC_SUBJECT",
        "医疗机构诊疗科目",
        "诊疗科目参考（不代表执业许可）",
        "服务专业参考（不代表执业许可）",
    ),
    "HQMS_RC023": (
        "HQMS_RC023",
        "病案首页科别（HQMS RC023）",
        "部门参考（非排他）",
        "住院单元科别候选",
    ),
    "HQMS_RC015": ("HQMS_RC015", "病案监护室类型（HQMS RC015）", None, "监护室类型"),
    "MR_STAT_LOCAL": (
        "MR_STAT_LOCAL",
        "本院病案统计科别",
        "由单元归口派生的参考（非排他）",
        "住院单元病案统计科别",
    ),
}


def load(root: Path, name: str) -> list[dict]:
    with open(root / "02_机器可读" / f"{name}.csv", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------ 配置
def ensure_config(s, root: Path, user: AppUser) -> None:
    his = s.scalar(select(SourceSystem).where(SourceSystem.code == "HIS"))
    if his is None:
        his = SourceSystem(
            code="HIS",
            name="HIS（实例待确认）",
            kind="HIS",
            note="资料包未给出 source_instance_id；各院区账套若是不同实例，确认后分别登记",
            is_active=True,
            updated_by=user.id,
        )
        s.add(his)
        s.flush()
        print("配置：登记来源系统 HIS")
    if not s.scalar(
        select(CodeNamespace).where(
            CodeNamespace.source_system_id == his.id, CodeNamespace.code == "DEPT_DICT"
        )
    ):
        s.add(
            CodeNamespace(
                source_system_id=his.id,
                code="DEPT_DICT",
                name="科室字典（DEPT_DICT）",
                note="混装字典：同一字典里有部门、服务单元、护理单元、号别配置、统计大类等，逐条解释",
                is_active=True,
                updated_by=user.id,
            )
        )
        print("配置：登记字典 HIS/DEPT_DICT")

    catalogs = {c["catalog_id"]: c for c in load(root, "dictionary_catalogs")}
    items = load(root, "dictionary_items")
    for catalog_id, (code, name, for_dept, for_unit) in SCHEMES.items():
        if s.scalar(select(ClassificationScheme.id).where(ClassificationScheme.code == code)):
            continue
        cat = catalogs[catalog_id]
        scheme = ClassificationScheme(
            code=code,
            name=name,
            version=cat["source_edition"],
            purpose=cat["use_boundary"],
            is_exclusive=False,
            is_active=True,
            meaning_for_department=for_dept,
            meaning_for_unit=for_unit,
            updated_by=user.id,
        )
        s.add(scheme)
        s.flush()
        rows = [
            r
            for r in items
            if r["catalog_id"] == catalog_id
            and r["code"]
            # 研究补充项不进入正式代码表（资料包：研究补充 42 不进入已映射结果）
            and r["verification_status"] != "RESEARCH_SUPPLEMENT_ONLY"
        ]
        for i, r in enumerate(rows):
            s.add(
                ClassificationCode(
                    scheme_id=scheme.id,
                    code=r["code"],
                    name=r["name"],
                    sort_order=(i + 1) * 10,
                    is_active=True,
                    updated_by=user.id,
                )
            )
        print(f"配置：登记分类方案 {code}（{len(rows)} 个代码）")
    s.flush()


# ------------------------------------------------------------------ 申请
def already(s, tag: str) -> ChangeRequest | None:
    return s.scalar(
        select(ChangeRequest)
        .where(
            ChangeRequest.note.like(f"{tag}%"),
            ChangeRequest.status.in_(("draft", "submitted", "confirmed")),
        )
        .order_by(ChangeRequest.id.desc())
    )


def file_request(s, user: AppUser, tag: str, items: list[dict], note: str) -> None:
    found = already(s, tag)
    if found:
        print(f"{tag} 已有申请 #{found.id}（{workflow.STATUS_LABELS[found.status]}），跳过")
        return
    parsed = ITEMS_ADAPTER.validate_python(items)
    cr = workflow.create_draft(s, user, parsed, f"{tag} {note}")
    try:
        workflow.submit(s, user, cr.id)
    except BusinessError as e:
        print(f"{tag} 申请 #{cr.id} 预演未通过，留作草稿：{e.message}")
        return
    print(f"{tag} 已生成并提交申请 #{cr.id}（{len(items)} 项），请确认人确认")


def campus_items() -> list[dict]:
    return [
        {
            "kind": "campus.revise",
            "code": "BY",
            "effective_date": RECORDED_ON,
            "changes": {"name": "本部院区"},
        },
        {
            "kind": "campus.change_status",
            "code": "GX",
            "effective_date": RECORDED_ON,
            "operating_status": "RUNNING",
        },
        {
            "kind": "campus.create",
            "code": "ZX",
            "valid_from": RECORDED_ON,
            "operating_status": "RUNNING",
            "fields": {"name": "中心院区", "node_role": "CITY_CENTER"},
        },
        {
            "kind": "operator_relation.create",
            "institution_code": INSTITUTION,
            "campus_code": "ZX",
            "relation_type": "OPERATE",
            "is_primary": True,
            "valid_from": RECORDED_ON,
        },
    ]


def department_items(root: Path) -> list[dict]:
    rows = load(root, "departments")
    code_of = {
        r["department_id"]: SAME_DEPARTMENT.get(r["department_code"], r["department_code"])
        for r in rows
    }
    items: list[dict] = []
    for r in rows:
        if r["department_code"] in SAME_DEPARTMENT:
            continue
        items.append(
            {
                "kind": "department.create",
                "code": r["department_code"],
                "name": r["department_name"],
                "valid_from": RECORDED_ON,
                "lifecycle": "ACTIVE",
                "institution_code": INSTITUTION,
                "basis_note": (
                    f"企业微信行政路径：{r['source_path']}"
                    "（样例导入；开始日为记录日期，非真实设立日）"
                ),
            }
        )
    for r in rows:
        if r["parent_department_id"]:
            items.append(
                {
                    "kind": "department.set_parent",
                    "code": code_of[r["department_id"]],
                    "view_code": "ADMIN",
                    "parent_code": code_of[r["parent_department_id"]],
                    "effective_date": RECORDED_ON,
                }
            )
    return items


def his_items(root: Path) -> list[dict]:
    """登记全部源代码；只解释三类证据明确的，其余留作待裁决。"""
    departments = {r["department_id"]: r["department_code"] for r in load(root, "departments")}
    units = {r["service_unit_id"]: r for r in load(root, "service_units")}
    roles: dict[str, list[dict]] = {}
    for m in load(root, "source_mappings"):
        if m["source_system"] == "HIS":
            roles.setdefault(m["source_key"], []).append(m)

    register, assign = [], []
    ref = {"system_code": "HIS", "namespace_code": "DEPT_DICT"}
    for r in load(root, "source_his_raw"):
        code = r["DEPT_CODE"].strip()
        register.append(
            {
                "kind": "external_code.register",
                **ref,
                "external_code": code,
                "source_name": r["DEPT_NAME"] or None,
            }
        )
        ms = roles.get(code, [])
        identity = [
            m
            for m in ms
            if m["mapping_role"]
            in (
                "DEPARTMENT_IDENTITY",
                "EXECUTION_ROLE_SPLIT",
                "SERVICE_IDENTITY",
                "RECONCILIATION_IDENTITY",
            )
        ]
        if len(identity) != 1:
            continue  # 多重角色（如执行职能拆分）待人工裁决
        m = identity[0]
        base = {
            "kind": "external_code.assign",
            **ref,
            "external_code": code,
            "valid_from": RECORDED_ON,
        }
        if m["mapping_role"] == "DEPARTMENT_IDENTITY" and m["confidence"] == "HIGH":
            dept = SAME_DEPARTMENT.get(departments[m["target_id"]], departments[m["target_id"]])
            assign.append(
                base
                | {
                    "target_type": "department",
                    "department_code": dept,
                    "evidence_note": f"资料包候选（高置信）：{m['evidence']}",
                }
            )
        elif (
            m["mapping_role"] == "SERVICE_IDENTITY"
            and units[m["target_id"]]["unit_type_code"] == "NURSING"
        ):
            assign.append(
                base
                | {
                    "target_type": "unmodeled",
                    "unmodeled_type": "NURSING_UNIT",
                    "evidence_note": (
                        "HIS 临床属性为护理单元；本平台护理单元未建模（服务单元 ≠ 护理单元）"
                    ),
                }
            )
        elif m["mapping_role"] == "RECONCILIATION_IDENTITY" and m["target_type"] == "BUSINESS_VIEW":
            assign.append(
                base
                | {
                    "target_type": "unmodeled",
                    "unmodeled_type": "STAT_GROUP",
                    "evidence_note": f"资料包：业务视图（{m['target_name']}），不是组织实体",
                }
            )
    return register + assign


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("package", type=Path)
    ap.add_argument("--user", default="solo")
    args = ap.parse_args()
    root: Path = args.package
    if not (root / "02_机器可读" / "departments.csv").exists():
        sys.exit(f"不是资料包目录：{root}")

    with SessionLocal() as s:
        user = s.scalar(select(AppUser).where(AppUser.username == args.user, AppUser.is_active))
        if user is None:
            sys.exit(f"用户 {args.user} 不存在或未启用")
        ensure_config(s, root, user)
        s.commit()

        file_request(
            s,
            user,
            TAG_CAMPUS,
            campus_items(),
            "三个直属院区：本部院区（原“本院院区”更名）、高新院区（运行）、中心院区（新增，"
            "由成都市第三人民医院主要运营）。生效日取记录日期，实际启用日待补。",
        )
        s.commit()
        file_request(
            s,
            user,
            TAG_DEPT,
            department_items(root),
            "资料包行政部门树（企业微信路径快照，候选基线）。心血管内科即已有的 XNK，不重复新建。"
            "设立日取记录日期 2026-10-16，非真实设立日；部门管理主分类不自动填，由人工补齐。",
        )
        s.commit()

        if s.scalar(select(Department.id).where(Department.code == "D0001")) is None:
            print(f"{TAG_HIS} 待部门申请确认后再运行一次本脚本生成")
            return
        file_request(
            s,
            user,
            TAG_HIS,
            his_items(root),
            "HIS 科室字典全部源代码登记入台账。只解释三类：高置信的部门身份、"
            "护理单元（对象未建模）、"
            "内科 / 外科等业务视图（统计分组）；服务单元、号别配置等候选留作待裁决。",
        )
        s.commit()


if __name__ == "__main__":
    main()
