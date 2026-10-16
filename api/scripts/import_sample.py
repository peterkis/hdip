"""把院方整理的“统一部门服务单元分类映射”资料包导入为开发库的样例数据。

用法（在 api/ 下）：uv run python scripts/import_sample.py <资料包目录> [--user solo]

资料包是候选基线（DRAFT_NOT_PRODUCTION），所以这里只做两件事：
1. 配置（维护人可直接维护，不经申请）：来源系统与字典、外部分类方案及其正式代码表。
2. 业务数据一律生成变更申请并提交，由确认人在页面上确认，脚本不代为确认：
   - 院区：本部院区更名（运行）、新增中心院区（筹建）及其运营关系；高新院区保持筹建；
   - 部门：资料包的行政部门树（心血管内科与已有的 XNK 是同一部门，不重复新建）；
   - 服务单元与 HIS 科室字典：资料包的服务单元都在本部院区（Peter 确认）；护理单元不是服务单元、
     没有确定所属部门的单元不导入；HIS 全部源代码登记入台账，只解释证据明确的几类，其余待裁决。
   部门与院区申请确认后再运行一次本脚本，才会生成服务单元与 HIS 字典申请（它引用这些部门）。

脚本可重复运行：已有的配置跳过，已生成过的申请（按说明里的标记识别）不再生成。
资料包要求不自动补值的字段（组织生效日、启停状态、企业微信原生 ID 等）不推断：开始日按
Peter 指定——部门、服务单元及其关系 2020-01-01，筹建的中心院区 2027-12-27；已有对象不能
追溯，所以涉及它们的开始日取较晚的一个。
资料包里的脚本一概不运行，只读取 02_机器可读/ 下的 CSV。
"""

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import func, select

from hdip_api.core.db import SessionLocal
from hdip_api.core.errors import BusinessError
from hdip_api.models import (
    AppUser,
    Campus,
    CampusVersion,
    ChangeRequest,
    ClassificationCode,
    ClassificationScheme,
    CodeNamespace,
    Department,
    DepartmentVersion,
    Institution,
    InstitutionVersion,
    OperatorRelation,
    SourceSystem,
)
from hdip_api.schemas.items import ITEMS_ADAPTER
from hdip_api.services import workflow

RECORDED_ON = "2026-10-16"  # 资料包的记录日期
START = date(2020, 1, 1)  # Peter 指定：部门、服务单元及其关系的开始日
PLANNED_CAMPUS_START = date(2027, 12, 27)  # Peter 指定：筹建院区的开始日
CAMPUS = "BY"  # 资料包的服务单元都属于本部院区
# 资料包单元类型 → 既有单元类型码；没有对应的归为 OTHER，原类型名写进范围说明
# （码值不新增、不另作解释）
UNIT_TYPES = {
    "OUTPATIENT": "OPD",
    "INPATIENT": "IPD",
    "EMERGENCY": "ED",
    "EXAM": "EXAM",
    "LAB": "LAB",
    "PHARMACY": "PHARMACY",
    "OPERATION": "OR",
}
INSTITUTION = "CD3"
# 资料包里的心血管内科 D0042 就是库里已有的 XNK
SAME_DEPARTMENT = {"D0042": "XNK"}

TAG_CAMPUS = "[样例导入:院区]"
TAG_DEPT = "[样例导入:部门]"
TAG_HIS = "[样例导入:服务单元与HIS科室字典]"

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


class Starts:
    """已有对象的开始日：新内容的开始日不能早于它们，取 START 与之中较晚的一个。"""

    def __init__(self, s) -> None:
        self.s = s

    def _min(self, col, where) -> date | None:
        return self.s.scalar(select(func.min(col)).where(where))

    def department(self, code: str) -> date:
        d = self.s.scalar(select(Department).where(Department.code == code))
        if d is None:  # 本批新建的部门
            return START
        return max(
            START, self._min(DepartmentVersion.valid_from, DepartmentVersion.department_id == d.id)
        )

    def institution(self, code: str) -> date:
        i = self.s.scalar(select(Institution).where(Institution.code == code))
        return max(
            START,
            self._min(InstitutionVersion.valid_from, InstitutionVersion.institution_id == i.id),
        )

    def campus_operated(self, code: str) -> date:
        """院区存在且主体对它有“运营”关系的最早日期（单元的开始日不能早于它）。"""
        c = self.s.scalar(select(Campus).where(Campus.code == code))
        i = self.s.scalar(select(Institution).where(Institution.code == INSTITUTION))
        first_version = self._min(CampusVersion.valid_from, CampusVersion.campus_id == c.id)
        first_operate = self._min(
            OperatorRelation.valid_from,
            (OperatorRelation.campus_id == c.id)
            & (OperatorRelation.institution_id == i.id)
            & (OperatorRelation.relation_type == "OPERATE"),
        )
        return max(START, first_version, first_operate)


def iso(d: date) -> str:
    return d.isoformat()


def campus_items(starts: Starts) -> list[dict]:
    return [
        # 更名是纠正称呼，在记录日生效（本部院区自 2020-01-01 起已有版本，不能往前插）
        {
            "kind": "campus.revise",
            "code": "BY",
            "effective_date": RECORDED_ON,
            "changes": {"name": "本部院区"},
        },
        {
            "kind": "campus.create",
            "code": "ZX",
            "valid_from": iso(PLANNED_CAMPUS_START),
            "operating_status": "PLANNING",
            "fields": {"name": "中心院区", "node_role": "CITY_CENTER"},
        },
        {
            "kind": "operator_relation.create",
            "institution_code": INSTITUTION,
            "campus_code": "ZX",
            "relation_type": "OPERATE",
            "is_primary": True,
            "valid_from": iso(max(PLANNED_CAMPUS_START, starts.institution(INSTITUTION))),
        },
    ]


def dept_code_map(root: Path) -> dict[str, str]:
    """资料包部门 ID → 本系统部门代码。"""
    return {
        r["department_id"]: SAME_DEPARTMENT.get(r["department_code"], r["department_code"])
        for r in load(root, "departments")
    }


def department_items(root: Path, starts: Starts) -> list[dict]:
    rows = load(root, "departments")
    code_of = dept_code_map(root)
    items: list[dict] = []
    for r in rows:
        if r["department_code"] in SAME_DEPARTMENT:
            continue
        items.append(
            {
                "kind": "department.create",
                "code": r["department_code"],
                "name": r["department_name"],
                "valid_from": iso(START),
                "lifecycle": "ACTIVE",
                "institution_code": INSTITUTION,
                "basis_note": f"企业微信行政路径：{r['source_path']}（样例导入）",
            }
        )
    for r in rows:
        if r["parent_department_id"]:
            child, parent = code_of[r["department_id"]], code_of[r["parent_department_id"]]
            day = max(starts.department(child), starts.department(parent))
            items.append(
                {
                    "kind": "department.set_parent",
                    "code": child,
                    "view_code": "ADMIN",
                    "parent_code": parent,
                    "effective_date": iso(day),
                }
            )
    return items


def unit_items(root: Path, starts: Starts) -> tuple[list[dict], dict[str, tuple[str, date]]]:
    """导入有所属部门、且不是护理单元的服务单元。返回变更项与“HIS 源代码 → (单元代码, 开始日)”。"""
    code_of = dept_code_map(root)
    campus_from = starts.campus_operated(CAMPUS)
    items, by_his = [], {}
    for r in load(root, "service_units"):
        if r["unit_type_code"] == "NURSING" or not r["primary_department_id"]:
            continue
        dept = code_of[r["primary_department_id"]]
        day = max(campus_from, starts.department(dept))
        unit_type = UNIT_TYPES.get(r["unit_type_code"], "OTHER")
        note = None if unit_type != "OTHER" else f"资料包类型：{r['unit_type_name']}"
        items.append(
            {
                "kind": "service_unit.create",
                "code": r["service_unit_code"],
                "unit_type": unit_type,
                "valid_from": iso(day),
                "fields": {
                    "name": r["service_unit_name"],
                    "department_code": dept,
                    "campus_code": CAMPUS,
                    "institution_code": INSTITUTION,
                    "scope_note": note,
                },
            }
        )
        if r["source_his_code"]:
            by_his[r["source_his_code"].strip()] = (r["service_unit_code"], day)
    return items, by_his


def his_items(root: Path, starts: Starts, units_by_his: dict[str, tuple[str, date]]) -> list[dict]:
    """登记全部源代码；只解释证据明确的几类，其余留作待裁决。"""
    departments = dept_code_map(root)
    units = {r["service_unit_id"]: r for r in load(root, "service_units")}
    roles: dict[str, list[dict]] = {}
    for m in load(root, "source_mappings"):
        if m["source_system"] == "HIS":
            roles.setdefault(m["source_key"], []).append(m)

    register, assign = [], []
    ref = {"system_code": "HIS", "namespace_code": "DEPT_DICT"}
    identity_roles = (
        "DEPARTMENT_IDENTITY",
        "EXECUTION_ROLE_SPLIT",
        "SERVICE_IDENTITY",
        "RECONCILIATION_IDENTITY",
    )
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
        identity = [m for m in roles.get(code, []) if m["mapping_role"] in identity_roles]
        if len(identity) != 1:
            continue  # 多重角色（如执行职能拆分）待人工裁决
        m = identity[0]
        base = {"kind": "external_code.assign", **ref, "external_code": code}
        if m["mapping_role"] == "DEPARTMENT_IDENTITY" and m["confidence"] == "HIGH":
            dept = departments[m["target_id"]]
            assign.append(
                base
                | {
                    "target_type": "department",
                    "department_code": dept,
                    "valid_from": iso(starts.department(dept)),
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
                    "valid_from": iso(START),
                    "evidence_note": (
                        "HIS 临床属性为护理单元；本平台护理单元未建模（服务单元 ≠ 护理单元）"
                    ),
                }
            )
        elif m["mapping_role"] == "SERVICE_IDENTITY" and code in units_by_his:
            unit_code, day = units_by_his[code]
            assign.append(
                base
                | {
                    "target_type": "service_unit",
                    "service_unit_code": unit_code,
                    "valid_from": iso(day),
                    "evidence_note": (
                        "单元由该 HIS 记录构建（资料包 construction_basis = HIS_SOURCE_FUNCTION）"
                    ),
                }
            )
        elif m["mapping_role"] == "RECONCILIATION_IDENTITY" and m["target_type"] == "BUSINESS_VIEW":
            assign.append(
                base
                | {
                    "target_type": "unmodeled",
                    "unmodeled_type": "STAT_GROUP",
                    "valid_from": iso(START),
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
        starts = Starts(s)

        file_request(
            s,
            user,
            TAG_CAMPUS,
            campus_items(starts),
            "三个直属院区：本部院区（原“本院院区”更名，运行）、高新院区（筹建，不变）、"
            "中心院区（新增，筹建，自 2027-12-27 起，由成都市第三人民医院主要运营）。",
        )
        s.commit()
        file_request(
            s,
            user,
            TAG_DEPT,
            department_items(root, starts),
            "资料包行政部门树（企业微信路径快照，候选基线）。心血管内科即已有的 XNK，不重复新建。"
            "开始日按 2020-01-01；部门管理主分类不自动填，由人工补齐。",
        )
        s.commit()

        if s.scalar(select(Department.id).where(Department.code == "D0001")) is None:
            print(f"{TAG_HIS} 待部门申请确认后再运行一次本脚本生成")
            return
        units, units_by_his = unit_items(root, starts)
        file_request(
            s,
            user,
            TAG_HIS,
            units + his_items(root, starts, units_by_his),
            f"资料包服务单元 {len(units)} 个，均在本部院区，开始日不早于本部院区有运营关系之日；"
            "护理单元不是服务单元，未定所属部门的单元暂不导入；类型无既有码值的归为“其他”，原类型写在范围说明。"
            "HIS 科室字典全部源代码登记入台账，解释：高置信的部门身份、由该记录构建的服务单元、"
            "护理单元（对象未建模）、内科 / 外科等业务视图（统计分组）；其余候选待裁决。",
        )
        s.commit()


if __name__ == "__main__":
    main()
