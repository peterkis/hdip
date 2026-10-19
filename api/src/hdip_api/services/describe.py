# ruff: noqa: E501  （一句话说明的模板串较长，拆行反而难读）
"""变更项的一句话说明：用名称说清“谁、怎么变、从哪天起”，代码只作补充。

预演失败时没有前后内容，申请页也要让人看懂每一项在做什么；所以不依赖预演，直接按变更项与当前数据
拼出说明。同一张申请里新建的对象（部门、院区、单元……）取变更项里写的名称。
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.models import (
    Campus,
    CampusVersion,
    ClassificationCode,
    ClassificationScheme,
    CodeNamespace,
    Department,
    DepartmentVersion,
    ExternalCode,
    ExternalCodeAssignment,
    Institution,
    InstitutionVersion,
    ServiceUnit,
    ServiceUnitVersion,
)
from hdip_api.schemas.items import KIND_LABELS, REORG_LABELS

RELATION = {"OPERATE": "运营", "REGISTER": "登记", "MANAGE": "管理", "CHARGE": "收费"}
DEPT_RELATION = {
    "PROFESSIONAL_MGMT": "专业管理",
    "COLLABORATION": "协作",
    "CAMPUS_MGMT": "院区管理",
}
LIFECYCLE = {"ACTIVE": "正式履职", "SUSPENDED": "暂停履职", "REVOKED": "撤销"}
STATUS = {"PLANNING": "筹建", "TRIAL_RUNNING": "试运行", "RUNNING": "运行", "SUSPENDED": "停用"}
UNMODELED = {
    "NURSING_UNIT": "护理单元",
    "WARD": "病区",
    "LOCATION": "地点",
    "STAT_GROUP": "统计分组",
    "COMPOSITE": "旧系统复合记录",
    "OTHER": "其他",
}


def _latest_names(s: Session, identity, version, fk: str) -> dict[str, str]:
    """代码 → 最新一版的名称（按版本号取最大）。"""
    names: dict[str, str] = {}
    best: dict[str, int] = {}
    rows = s.execute(
        select(identity.code, version.name, version.version_no).join(
            version, getattr(version, fk) == identity.id
        )
    )
    for code, name, no in rows:
        if no > best.get(code, 0):
            best[code], names[code] = no, name
    return names


class _Names:
    def __init__(self, s: Session, items: list[dict]) -> None:
        self.dept = _latest_names(s, Department, DepartmentVersion, "department_id")
        self.unit = _latest_names(s, ServiceUnit, ServiceUnitVersion, "service_unit_id")
        self.campus = _latest_names(s, Campus, CampusVersion, "campus_id")
        self.inst = _latest_names(s, Institution, InstitutionVersion, "institution_id")
        self.classes = {
            (sc, c): n
            for sc, c, n in s.execute(
                select(
                    ClassificationScheme.code, ClassificationCode.code, ClassificationCode.name
                ).join(ClassificationCode, ClassificationCode.scheme_id == ClassificationScheme.id)
            )
        }
        self.assignments = {
            a_id: (code, src)
            for a_id, code, src in s.execute(
                select(ExternalCodeAssignment.id, ExternalCode.code, ExternalCode.source_name).join(
                    ExternalCode, ExternalCode.id == ExternalCodeAssignment.external_code_id
                )
            )
        }
        self.namespaces = {ns.code: ns.name for ns in s.scalars(select(CodeNamespace))}
        self.new_depts: set[str] = set()
        # 同一张申请里新建的对象
        for i in items:
            k = i.get("kind")
            if k == "department.create":
                self.dept[i["code"]] = i["name"]
                self.new_depts.add(i["code"])
            elif k == "service_unit.create":
                self.unit[i["code"]] = i["fields"]["name"]
            elif k == "campus.create":
                self.campus[i["code"]] = i["fields"]["name"]
            elif k == "institution.create":
                self.inst[i["code"]] = i["fields"]["name"]

    def d(self, code: str | None) -> str:
        if not code:
            return "（一级部门，无上级）"
        name = self.dept.get(code, code)
        return f"{name}（新设）" if code in self.new_depts else name

    def u(self, code: str) -> str:
        return self.unit.get(code, code)


def _day(v) -> str:
    return v if isinstance(v, str) else v.isoformat()


def _before(v) -> str:
    return (date.fromisoformat(_day(v)) - timedelta(days=1)).isoformat()


def describe(n: _Names, i: dict) -> str:
    k = i.get("kind", "")
    since = lambda key="effective_date": f"，自 {_day(i[key])} 起" if i.get(key) else ""  # noqa: E731
    match k:
        case "institution.create":
            return f"新建主体“{i['fields']['name']}”{since('valid_from')}"
        case "institution.revise":
            return f"修订主体“{n.inst.get(i['code'], i['code'])}”的资料{since()}"
        case "campus.create":
            return f"新建院区“{i['fields']['name']}”（{STATUS.get(i.get('operating_status'), '')}）{since('valid_from')}"
        case "campus.revise":
            return f"修订院区“{n.campus.get(i['code'], i['code'])}”的资料{since()}"
        case "campus.change_status":
            return f"院区“{n.campus.get(i['code'], i['code'])}”改为{STATUS.get(i['operating_status'], '')}{since()}"
        case "operator_relation.create":
            return (
                f"{n.inst.get(i['institution_code'], i['institution_code'])} —"
                f"{RELATION.get(i['relation_type'], '')}{'（主要）' if i.get('is_primary') else ''}→ "
                f"{n.campus.get(i['campus_code'], i['campus_code'])}{since('valid_from')}"
            )
        case "operator_relation.close":
            return f"关闭运营关系 #{i['relation_id']}，最后有效日 {_day(i['valid_to'])}"
        case "department.create":
            return f"新设部门“{i['name']}”{since('valid_from')}"
        case "department.revise":
            new = i.get("changes", {}).get("name")
            what = f"更名为“{new}”" if new else "修订属性"
            return f"部门“{n.d(i['code'])}”{what}{since()}"
        case "department.change_lifecycle":
            return f"部门“{n.d(i['code'])}”改为{LIFECYCLE.get(i['lifecycle'], '')}{since()}"
        case "department.classify":
            cls = n.classes.get(
                (i.get("scheme_code", "DEPT_MAIN_CLASS"), i.get("class_code")), i.get("class_code")
            )
            return (
                f"部门“{n.d(i['code'])}”的管理主分类设为“{cls}”{since()}"
                if i.get("class_code")
                else f"结束部门“{n.d(i['code'])}”的分类{since()}"
            )
        case "department.set_parent":
            parent = n.d(i.get("parent_code")) if i.get("parent_code") else "一级部门（无上级）"
            return f"部门“{n.d(i['code'])}”的行政上级改为“{parent}”{since()}"
        case "department.relation_create":
            other = (
                n.d(i.get("to_code"))
                if i.get("to_code")
                else n.campus.get(i.get("campus_code"), "")
            )
            return f"{n.d(i['from_code'])} —{DEPT_RELATION.get(i['relation_kind'], '')}→ {other}：{i['scope']}{since('valid_from')}"
        case "department.reorganize":
            src = "、".join(n.d(p["code"]) for p in i["sources"])
            res = "、".join(n.d(p["code"]) for p in i["results"])
            return f"{REORG_LABELS.get(i['event_type'], '')}：{src} → {res}{since()}"
        case "service_unit.create":
            f = i["fields"]
            return f"新建服务单元“{f['name']}”（{n.d(f['department_code'])} · {n.campus.get(f['campus_code'], f['campus_code'])}）{since('valid_from')}"
        case "service_unit.change_department":
            return f"服务单元“{n.u(i['code'])}”改挂到“{n.d(i['department_code'])}”{since()}"
        case "service_unit.retire":
            return f"服务单元“{n.u(i['code'])}”永久退出，最后有效日 {_day(i['valid_to'])}"
        case "service_unit.revise" | "service_unit.rebind" | "service_unit.change_status":
            return f"{KIND_LABELS.get(k, k)}：“{n.u(i['code'])}”{since()}"
        case "service_unit.split":
            succ = "、".join(x["fields"]["name"] for x in i["successors"])
            return f"拆分服务单元“{n.u(i['code'])}” → {succ}{since()}"
        case "service_unit.merge":
            src = "、".join(n.u(c) for c in i["codes"])
            return f"合并服务单元 {src} → “{i['successor']['fields']['name']}”{since()}"
        case "external_code.register":
            return f"登记 {n.namespaces.get(i['namespace_code'], i['namespace_code'])} 的代码 {i['external_code']}“{i.get('source_name') or ''}”"
        case "external_code.assign":
            target = (
                f"部门“{n.d(i.get('department_code'))}”"
                if i["target_type"] == "department"
                else f"服务单元“{n.u(i.get('service_unit_code', ''))}”"
                if i["target_type"] == "service_unit"
                else f"对象未建模（{UNMODELED.get(i.get('unmodeled_type'), '')}）"
            )
            return f"代码 {i['external_code']} 解释为{target}{since('valid_from')}"
        case "external_code.assignment_close":
            code, src = n.assignments.get(i["assignment_id"], (f"#{i['assignment_id']}", ""))
            return (
                f"结束代码 {code}“{src or ''}”的解释，最后有效日 {_day(i['valid_to'])}（历史保留）"
            )
    return KIND_LABELS.get(k, k)


def describe_items(s: Session, items: list[dict]) -> list[str]:
    names = _Names(s, items)
    out = []
    for i in items:
        try:
            out.append(describe(names, i))
        except (KeyError, TypeError, ValueError):  # 旧申请或不完整的项：退回到类型名
            out.append(KIND_LABELS.get(i.get("kind", ""), ""))
    return out
