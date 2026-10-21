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
        self.assignment_ns = dict(
            s.execute(
                select(ExternalCodeAssignment.id, CodeNamespace.name)
                .join(ExternalCode, ExternalCode.id == ExternalCodeAssignment.external_code_id)
                .join(CodeNamespace, CodeNamespace.id == ExternalCode.namespace_id)
            ).all()
        )
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


# ------------------------------------------------------------------ 结构化的行（申请页按原型逐行呈现）
# 一行 = 若干片段：名称标签（chip：普通 / new 新设 / out 退出 / ref 关联对象，如隶属的上级部门）、
# 状态标签（tag，带色调）、箭头、普通文字；
# meta 是靠右弱化显示的代码与院区。新设部门的主分类、隶属并进它的“新设”那一行（covered_by 指向那一行）。
Part = dict[str, str]


def _p(kind: str, text: str, tone: str | None = None) -> Part:
    return {"kind": kind, "text": text, **({"tone": tone} if tone else {})}


def _unit_facts(s: Session) -> dict[str, tuple[str, date]]:
    """单元代码 → (最新一版的院区名, 最新一版的开始日)。"""
    campus = {c.id: c.code for c in s.scalars(select(Campus))}
    campus_names = _latest_names(s, Campus, CampusVersion, "campus_id")
    out: dict[str, tuple[str, date]] = {}
    best: dict[str, int] = {}
    rows = s.execute(
        select(
            ServiceUnit.code,
            ServiceUnitVersion.version_no,
            ServiceUnitVersion.campus_id,
            ServiceUnitVersion.valid_from,
        ).join(ServiceUnitVersion, ServiceUnitVersion.service_unit_id == ServiceUnit.id)
    )
    for code, no, campus_id, start in rows:
        if no > best.get(code, 0):
            best[code] = no
            out[code] = (campus_names.get(campus[campus_id], ""), start)
    return out


def item_views(s: Session, items: list[dict]) -> list[dict]:
    n = _Names(s, items)
    units = _unit_facts(s)
    created = {
        i["code"]: idx for idx, i in enumerate(items) if i.get("kind") == "department.create"
    }
    # 新设部门的主分类、隶属：并进“新设”那一行（每条一组片段，前面加“·”）
    extra: dict[str, list[list[Part]]] = {}
    has_parent: set[str] = set()
    covered: dict[int, int] = {}
    for idx, i in enumerate(items):
        k = i.get("kind")
        code = i.get("code")
        if code in created and k == "department.classify" and i.get("class_code"):
            cls = n.classes.get(
                (i.get("scheme_code", "DEPT_MAIN_CLASS"), i["class_code"]), i["class_code"]
            )
            extra.setdefault(code, []).append([_p("text", f"· {cls}")])
            covered[idx] = created[code]
        elif code in created and k == "department.set_parent":
            has_parent.add(code)
            extra.setdefault(code, []).append(
                [_p("text", "· 隶属"), _parent_chip(n, i["parent_code"])]
                if i.get("parent_code")
                else [_p("text", "· 一级部门")]
            )
            covered[idx] = created[code]
    views = []
    for idx, i in enumerate(items):
        try:
            parts, meta = _view(n, units, extra, has_parent, i)
        except (KeyError, TypeError, ValueError):
            parts, meta = [_p("text", KIND_LABELS.get(i.get("kind", ""), ""))], None
        views.append({"parts": parts, "meta": meta, "covered_by": covered.get(idx)})
    return views


def _parent_chip(n: _Names, code: str) -> Part:
    """隶属的上级部门是本行的关联对象（宾语），不论是否在同一申请里新设，都用关联对象标签：
    新设与否由它自己那一行的“新设”说明，不在这里重复（否则主语、宾语同色，分不清层次）。"""
    return _p("ref", n.dept.get(code, code))


def _view(
    n: _Names, units: dict, extra: dict, has_parent: set[str], i: dict
) -> tuple[list[Part], str | None]:
    k = i.get("kind", "")
    day = lambda key="effective_date": _day(i[key]) if i.get(key) else ""  # noqa: E731
    dept_chip = lambda code: _p("new" if code in n.new_depts else "chip", n.dept.get(code, code))  # noqa: E731
    match k:
        case "department.create":
            more = extra.get(i["code"], [])
            if i["code"] not in has_parent:
                more = [*more, [_p("text", "· 一级部门")]]
            return [
                _p("new", i["name"]),
                _p("tag", "新设", "green"),
                _p("text", f"自 {day('valid_from')}"),
                *[p for group in more for p in group],
            ], i["code"]
        case "department.reorganize":
            src = [p["code"] for p in i["sources"]]
            if i["event_type"] == "SPLIT_OFF":
                res = "、".join(n.dept.get(p["code"], p["code"]) for p in i["results"])
                return [
                    _p("chip", n.dept.get(src[0], src[0])),
                    _p("tag", "存续", "blue"),
                    _p("text", f"分设出 {res}，自 {day()}"),
                ], src[0]
            return [
                *[_p("out", n.dept.get(c, c)) for c in src],
                _p("tag", "被替代", "brown"),
                _p("text", f"最后有效日 {_before(i['effective_date'])}"),
            ], " · ".join(src)
        case "department.revise":
            new = i.get("changes", {}).get("name")
            if new:
                return [
                    dept_chip(i["code"]),
                    _p("arrow", "→"),
                    _p("text", "更名为"),
                    _p("chip", new),
                    _p("text", f"自 {day()}"),
                ], i["code"]
            return [dept_chip(i["code"]), _p("text", f"修订属性，自 {day()}")], i["code"]
        case "department.change_lifecycle":
            return [
                dept_chip(i["code"]),
                _p("arrow", "→"),
                _p("tag", LIFECYCLE.get(i["lifecycle"], ""), "gray"),
                _p("text", f"自 {day()}"),
            ], i["code"]
        case "department.classify":
            cls = n.classes.get(
                (i.get("scheme_code", "DEPT_MAIN_CLASS"), i.get("class_code")), i.get("class_code")
            )
            return [
                dept_chip(i["code"]),
                _p("text", "管理主分类"),
                _p("arrow", "→"),
                _p("tag", cls or "结束", "blue"),
                _p("text", f"自 {day()}"),
            ], i["code"]
        case "department.set_parent":
            if i.get("parent_code"):
                return [
                    dept_chip(i["code"]),
                    _p("arrow", "→"),
                    _p("text", "改为隶属"),
                    _parent_chip(n, i["parent_code"]),
                    _p("text", f"自 {day()}"),
                ], i["code"]
            return [
                dept_chip(i["code"]),
                _p("arrow", "→"),
                _p("text", f"改为一级部门，自 {day()}"),
            ], i["code"]
        case "department.relation_create":
            other = (
                dept_chip(i["to_code"])
                if i.get("to_code")
                else _p("chip", n.campus.get(i.get("campus_code"), ""))
            )
            return [
                dept_chip(i["from_code"]),
                _p("text", DEPT_RELATION.get(i["relation_kind"], "")),
                _p("arrow", "→"),
                other,
                _p("text", f"{i['scope']} · 自 {day('valid_from')}"),
            ], None
        case "service_unit.create":
            f = i["fields"]
            return [
                _p("new", f["name"]),
                _p("tag", "新建", "green"),
                _p("text", f"{n.dept.get(f['department_code'], '')} · 自 {day('valid_from')}"),
            ], f"{i['code']} · {n.campus.get(f['campus_code'], '')}"
        case "service_unit.change_department":
            campus = units.get(i["code"], ("", None))[0]
            return [
                _p("chip", n.u(i["code"])),
                _p("arrow", "→"),
                dept_chip(i["department_code"]),
                _p("text", f"自 {day()}"),
            ], f"{i['code']} · {campus}"
        case "service_unit.retire":
            campus, start = units.get(i["code"], ("", None))
            last = date.fromisoformat(_day(i["valid_to"]))
            if start and last < start:
                return [
                    _p("chip", n.u(i["code"])),
                    _p("arrow", "→"),
                    _p("tag", "取消计划", "yellow"),
                    _p("text", f"原定 {start.isoformat()} 开始，取消后从未生效"),
                ], f"{i['code']} · {campus}"
            return [
                _p("out", n.u(i["code"])),
                _p("tag", "永久退出", "gray"),
                _p("text", f"最后有效日 {last.isoformat()}"),
            ], f"{i['code']} · {campus}"
        case "external_code.assignment_close":
            code, src = n.assignments.get(i["assignment_id"], (f"#{i['assignment_id']}", ""))
            ns = n.assignment_ns.get(i["assignment_id"])
            return [
                _p("chip", (f"{ns} · " if ns else "") + f"{code} {src or ''}".strip()),
                _p("arrow", "→"),
                _p("text", f"解释结束于 {_day(i['valid_to'])}"),
                _p("tag", "之后待裁决", "yellow"),
            ], None
        case "external_code.register":
            return [
                _p("new", f"{i['external_code']} {i.get('source_name') or ''}".strip()),
                _p("tag", "登记", "green"),
            ], n.namespaces.get(i["namespace_code"], i["namespace_code"])
        case "external_code.assign":
            if i["target_type"] == "department":
                target = dept_chip(i.get("department_code"))
            elif i["target_type"] == "service_unit":
                target = _p("chip", n.u(i.get("service_unit_code", "")))
            else:
                target = _p(
                    "tag", f"对象未建模 · {UNMODELED.get(i.get('unmodeled_type'), '')}", "gray"
                )
            return [
                _p("chip", i["external_code"]),
                _p("arrow", "→"),
                target,
                _p("text", f"自 {day('valid_from')}"),
            ], n.namespaces.get(i["namespace_code"], i["namespace_code"])
    return [_p("text", describe(n, i))], None
