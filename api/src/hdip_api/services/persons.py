"""人员变更项的处理（迁移 0016，设计见 docs/HDIP 轻量人员模块设计：人员、任用、部门归属.md）。

与 apply.py 同一套机制：预演在 SAVEPOINT 里执行后回滚，确认时真正写入；跨项规则在申请全部
变更项应用后统一检查（_check_persons，由 apply_items 调用）。

- 人员只留身份与姓名版本；任用、工号、归属是带期间的行。
- 任用、工号、归属的结束日在到达前可改（hdip_guard_open_end）；改结束日的变更项都带“预期原结束日”，
  确认时与库里不一致就拒绝，不覆盖别的申请已确认的结果。
- 归属的完整期间须落在任用期间内，部门在此期间已设立且没有撤销 / 被替代段；筹备、暂停履职可以。
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.errors import ProblemItem
from hdip_api.models import (
    Department,
    DepartmentVersion,
    Institution,
    InstitutionVersion,
    Person,
    PersonAssignment,
    PersonDuty,
    PersonEngagement,
    PersonVersion,
    PersonWorkNo,
)
from hdip_api.schemas.items import (
    PersonAssign,
    PersonAssignmentSetEnd,
    PersonChangeWorkNo,
    PersonCreate,
    PersonDutyAssign,
    PersonDutyHandover,
    PersonDutySetEnd,
    PersonEngage,
    PersonEngagementSetEnd,
    PersonRevise,
    PersonTransfer,
)
from hdip_api.services import codes
from hdip_api.services.apply import (
    LIFECYCLE_LABELS,
    LIFECYCLE_TERMINAL,
    Ctx,
    ItemError,
    _check_option,
    _department,
    _institution,
    _json,
    _latest,
    _next_version,
    _require_issued,
    _today,
    is_void,
)

DAY = timedelta(days=1)


# ------------------------------------------------------------------ 查找与说明
def _person(s: Session, code: str, field_name: str) -> Person:
    obj = s.scalar(select(Person).where(Person.code == code))
    if obj is None:
        raise ItemError(f"人员代码 {code} 不存在", field_name)
    return obj


def _versions(s: Session, model, fk, obj_id: int) -> list:
    rows = s.scalars(select(model).where(fk == obj_id).order_by(model.version_no)).all()
    return [v for v in rows if not is_void(v)]


def person_name(s: Session, person_id: int, day: date | None = None) -> str:
    """某日的姓名；当天没有版本时取最早（尚未开始）或最新的一版。"""
    vs = _versions(s, PersonVersion, PersonVersion.person_id, person_id)
    if day is not None:
        for v in vs:
            if v.valid_from <= day and (v.valid_to is None or v.valid_to >= day):
                return v.name
        if vs and vs[0].valid_from > day:
            return vs[0].name
    return vs[-1].name if vs else ""


def person_label(s: Session, person_id: int, day: date | None = None) -> str:
    p = s.get(Person, person_id)
    return f"{person_name(s, person_id, day)}（{p.code}）"


def _person_start(s: Session, person_id: int) -> date | None:
    vs = _versions(s, PersonVersion, PersonVersion.person_id, person_id)
    return vs[0].valid_from if vs else None


def _dept_name(s: Session, dept_id: int, day: date | None = None) -> str:
    vs = _versions(s, DepartmentVersion, DepartmentVersion.department_id, dept_id)
    if day is not None:
        for v in vs:
            if v.valid_from <= day and (v.valid_to is None or v.valid_to >= day):
                return v.name
    return vs[-1].name if vs else ""


def _inst_name(s: Session, inst_id: int) -> str:
    vs = _versions(s, InstitutionVersion, InstitutionVersion.institution_id, inst_id)
    return vs[-1].name if vs else ""


def _period(a: date, b: date | None) -> str:
    return f"{a.isoformat()} 起" if b is None else f"{a.isoformat()} 至 {b.isoformat()}"


def assignment_snapshot(s: Session, a: PersonAssignment) -> dict:
    e = s.get(PersonEngagement, a.engagement_id)
    p = s.get(Person, e.person_id)
    d = s.get(Department, a.department_id)
    return {
        "id": a.id,
        "person": p.code,
        "person_name": person_name(s, p.id, a.valid_from),
        "department": d.code,
        "department_name": _dept_name(s, d.id, a.valid_from),
        "kind": a.kind,
        "valid_from": _json(a.valid_from),
        "valid_to": _json(a.valid_to),
    }


def engagement_snapshot(s: Session, e: PersonEngagement) -> dict:
    p = s.get(Person, e.person_id)
    inst = s.get(Institution, e.institution_id)
    return {
        "id": e.id,
        "person": p.code,
        "person_name": person_name(s, p.id, e.valid_from),
        "institution": inst.code,
        "engagement_type": e.engagement_type,
        "valid_from": _json(e.valid_from),
        "valid_to": _json(e.valid_to),
    }


# ------------------------------------------------------------------ 归属是否成立
DUTY_LABELS = {"HEAD": "部长", "DEPUTY": "副部长"}
MODE_LABELS = {"FORMAL": "", "ACTING": "（主持工作）", "CARETAKER": "（代管）"}
KIND_LABELS = {"PRIMARY": "主部门", "ADDITIONAL": "附加归属"}


def duty_label(d: PersonDuty) -> str:
    if d.duty == "HEAD" and d.mode != "FORMAL":
        return "主持工作" if d.mode == "ACTING" else "代管"
    return DUTY_LABELS[d.duty] + MODE_LABELS[d.mode]


def _span_problem(
    s: Session, e: PersonEngagement, dept_id: int, start: date, end: date | None, what: str
) -> tuple[str, list] | None:
    """一段归属或职务的完整期间：落在任用期间内；部门已设立、没有撤销 / 被替代段。"""
    dept = _dept_name(s, dept_id, start)
    if start < e.valid_from or (e.valid_to is not None and (end is None or end > e.valid_to)):
        return (
            f"{what}{dept}的期间（{_period(start, end)}）超出了任用期间"
            f"（{_period(e.valid_from, e.valid_to)}）",
            [("任用开始", e.valid_from, "info"), (f"{what}开始", start, "bad")]
            if start < e.valid_from
            else [("任用最后有效日", e.valid_to, "info")],
        )
    versions = _versions(s, DepartmentVersion, DepartmentVersion.department_id, dept_id)
    first = versions[0].valid_from
    if start < first:
        return (
            f"{dept}自 {first.isoformat()} 才设立，{what}不能从 {start.isoformat()} 开始",
            [("部门设立", first, "info"), (f"{what}开始", start, "bad")],
        )
    for v in versions:
        if v.lifecycle not in LIFECYCLE_TERMINAL:
            continue
        if end is None or end >= v.valid_from:
            return (
                f"{v.name}自 {v.valid_from.isoformat()} 起{LIFECYCLE_LABELS[v.lifecycle]}，"
                f"{what}不能延续到那时（{what}{_period(start, end)}）",
                [("部门" + LIFECYCLE_LABELS[v.lifecycle], v.valid_from, "bad")],
            )
    return None


def _overlaps(a_from: date, a_to: date | None, b_from: date, b_to: date | None) -> bool:
    return a_from <= (b_to or date.max) and b_from <= (a_to or date.max)


def assignment_problem(s: Session, a: PersonAssignment) -> tuple[str, list] | None:
    """归属的完整期间（见 _span_problem）；同一任用里主归属与附加归属不能是同一部门。"""
    if is_void(a):
        return None
    e = s.get(PersonEngagement, a.engagement_id)
    problem = _span_problem(s, e, a.department_id, a.valid_from, a.valid_to, "归属")
    if problem:
        return problem
    other = "ADDITIONAL" if a.kind == "PRIMARY" else "PRIMARY"
    for o in s.scalars(
        select(PersonAssignment).where(
            PersonAssignment.engagement_id == e.id,
            PersonAssignment.department_id == a.department_id,
            PersonAssignment.kind == other,
        )
    ):
        if not is_void(o) and _overlaps(a.valid_from, a.valid_to, o.valid_from, o.valid_to):
            return (
                f"{_dept_name(s, a.department_id, a.valid_from)}已是这项任用的{KIND_LABELS[o.kind]}"
                f"（{_period(o.valid_from, o.valid_to)}），主部门与附加归属不能是同一部门",
                [],
            )
    return None


def duty_problem(s: Session, d: PersonDuty) -> tuple[str, list] | None:
    if is_void(d):
        return None
    e = s.get(PersonEngagement, d.engagement_id)
    return _span_problem(s, e, d.department_id, d.valid_from, d.valid_to, "职务")


def _require_assignment_ok(s: Session, a: PersonAssignment, field_name: str) -> None:
    problem = assignment_problem(s, a)
    if problem:
        message, facts = problem
        raise ItemError(message, field_name, facts=facts)


def _changed_to(closed_change_id: int | None, now: str) -> str:
    """结束日与发起时不同：由某张申请改的写申请号；随所属任用截断等没有单独申请的，只说现在的值。"""
    return f"已被申请 #{closed_change_id} 改为{now}" if closed_change_id else f"现在是{now}"


def _locked_assignment(s: Session, assignment_id: int, expected: date | None) -> PersonAssignment:
    a = s.get(PersonAssignment, assignment_id, with_for_update=True)
    if a is None:
        raise ItemError(f"部门归属 #{assignment_id} 不存在", "assignment_id")
    if is_void(a):
        raise ItemError("这条归属已在生效前撤销，不能再调整", "assignment_id")
    if a.valid_to != expected:
        now = "长期有效" if a.valid_to is None else f"最后有效日 {a.valid_to.isoformat()}"
        raise ItemError(
            f"这条归属{_changed_to(a.closed_change_id, now)}，与发起时看到的不同",
            "assignment_id",
            hint="请刷新人员详情，按现在的情况重新发起。",
        )
    return a


def _set_end(ctx: Ctx, row, valid_to: date | None) -> None:
    row.valid_to = valid_to
    row.closed_change_id = ctx.change_id
    ctx.session.flush()


# ------------------------------------------------------------------ 提示（不阻止）
def dept_notices(s: Session, dept_id: int, start: date, end: date | None) -> list[str]:
    """归属期间与部门筹备、暂停履职段相交时提示：归属照常成立，只是提醒核对。"""
    out = []
    for v in _versions(s, DepartmentVersion, DepartmentVersion.department_id, dept_id):
        if v.lifecycle not in ("PREPARING", "SUSPENDED"):
            continue
        if v.valid_from <= (end or date.max) and start <= (v.valid_to or date.max):
            out.append(
                f"{v.name}在 {_period(v.valid_from, v.valid_to)}{LIFECYCLE_LABELS[v.lifecycle]}；"
                "归属照常成立，请核对"
            )
    return out


def _same_name_notice(s: Session, name: str, except_id: int) -> list[str]:
    others = sorted(
        {
            v.person_id
            for v in s.scalars(select(PersonVersion).where(PersonVersion.name == name))
            if v.person_id != except_id and not is_void(v)
        }
    )
    if not others:
        return []
    who = "、".join(person_label(s, pid) for pid in others[:5])
    return [f"已有 {len(others)} 位同名人员：{who}。系统不会合并，请确认不是同一人"]


# ------------------------------------------------------------------ 处理各类变更
def person_create(ctx: Ctx, item: PersonCreate) -> dict:
    s = ctx.session
    if s.scalar(select(Person.id).where(Person.code == item.code)):
        raise ItemError(f"人员代码 {item.code} 已被使用，代码永不复用", "code")
    _require_issued(s, "person", item.code, "code")
    p = Person(code=item.code, created_change_id=ctx.change_id)
    s.add(p)
    s.flush()
    v = PersonVersion(
        person_id=p.id,
        version_no=1,
        valid_from=item.valid_from,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
        name=item.name,
        # 人名首字按姓氏读音由前端生成；这里只在缺失时兜底
        pinyin=item.pinyin or codes.pinyin_of(item.name),
        revise_reason="INITIAL",
    )
    s.add(v)
    s.flush()
    after = {"code": p.code, "name": v.name, "pinyin": v.pinyin, "valid_from": _json(v.valid_from)}
    return {
        "target": f"人员 {p.code} {v.name}",
        "before": None,
        "after": after,
        "notices": _same_name_notice(s, v.name, p.id),
    }


def person_engage(ctx: Ctx, item: PersonEngage) -> dict:
    s = ctx.session
    p = _person(s, item.person_code, "person_code")
    inst = _institution(s, item.institution_code)
    _check_option(s, "engagement_type", item.engagement_type, "engagement_type")
    name = person_name(s, p.id, item.valid_from)

    start = _person_start(s, p.id)
    if start is not None and item.valid_from < start:
        raise ItemError(
            f"{name}的人员档案自 {start.isoformat()} 起，任用不能从更早的 "
            f"{item.valid_from.isoformat()} 开始",
            "valid_from",
            hint="把任用开始日改到人员档案开始日之后。",
            facts=[("人员档案开始", start, "info"), ("任用开始", item.valid_from, "bad")],
        )
    inst_versions = _versions(s, InstitutionVersion, InstitutionVersion.institution_id, inst.id)
    if inst_versions and item.valid_from < inst_versions[0].valid_from:
        raise ItemError(
            f"{inst_versions[0].name}自 {inst_versions[0].valid_from.isoformat()} 起才登记，"
            "任用不能更早开始",
            "valid_from",
        )
    end = item.valid_to
    for other in s.scalars(
        select(PersonEngagement).where(
            PersonEngagement.person_id == p.id, PersonEngagement.institution_id == inst.id
        )
    ):
        if is_void(other):
            continue
        if other.valid_from <= (end or date.max) and item.valid_from <= (
            other.valid_to or date.max
        ):
            raise ItemError(
                f"{name}在{_inst_name(s, inst.id)}的任用"
                f"（{_period(other.valid_from, other.valid_to)}）与新任用的期间重叠",
                "valid_from",
                hint="同一人在同一主体同一时期只能有一项任用。"
                + (
                    f"新任用须从 {(other.valid_to + DAY).isoformat()} 起。"
                    if other.valid_to is not None and other.valid_from <= item.valid_from
                    else ""
                ),
                facts=[
                    ("现有任用开始", other.valid_from, "info"),
                    ("新任用开始", item.valid_from, "bad"),
                ],
            )

    e = PersonEngagement(
        person_id=p.id,
        institution_id=inst.id,
        engagement_type=item.engagement_type,
        note=item.note,
        valid_from=item.valid_from,
        valid_to=end,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(e)
    s.flush()
    after = engagement_snapshot(s, e)

    if item.work_no:
        owner = s.scalar(
            select(PersonWorkNo.person_id).where(
                PersonWorkNo.institution_id == inst.id,
                PersonWorkNo.work_no == item.work_no,
                PersonWorkNo.person_id != p.id,
            )
        )
        if owner is not None:
            raise ItemError(
                f"工号 {item.work_no} 已属于{person_label(s, owner)}",
                "work_no",
                hint="同一主体内一个工号只属于一个人，离开后也不再发给别人。请核对工号。",
            )
        s.add(
            PersonWorkNo(
                engagement_id=e.id,
                person_id=p.id,
                institution_id=inst.id,
                work_no=item.work_no,
                revise_reason="INITIAL",
                valid_from=e.valid_from,
                valid_to=e.valid_to,
                change_id=ctx.change_id,
                recorded_by=ctx.user_id,
            )
        )
        s.flush()
        after["work_no"] = item.work_no

    if item.department_code:
        d = _department(s, item.department_code, "department_code")
        a = PersonAssignment(
            engagement_id=e.id,
            department_id=d.id,
            kind="PRIMARY",
            valid_from=e.valid_from,
            valid_to=e.valid_to,
            change_id=ctx.change_id,
            recorded_by=ctx.user_id,
        )
        s.add(a)
        s.flush()
        _require_assignment_ok(s, a, "department_code")
        ctx.new_assignments[a.id] = ctx.index
        after["department"] = d.code
        after["department_name"] = _dept_name(s, d.id, e.valid_from)
        notices = dept_notices(s, d.id, e.valid_from, e.valid_to)
    else:
        after["department"] = None
        notices = ["暂未分配主部门" + (f"：{item.note}" if item.note else "")]
    return {"target": f"人员 {p.code} {name}", "before": None, "after": after, "notices": notices}


def person_transfer(ctx: Ctx, item: PersonTransfer) -> dict:
    s = ctx.session
    a = _locked_assignment(s, item.assignment_id, item.expected_valid_to)
    d = _department(s, item.department_code, "department_code")
    day = item.effective_date
    before = assignment_snapshot(s, a)
    who = before["person_name"]
    if d.id == a.department_id:
        raise ItemError(f"{who}在这段期间已归属{before['department_name']}", "department_code")
    if a.valid_to is not None and day > a.valid_to:
        raise ItemError(
            f"调科日 {day.isoformat()} 在这条归属结束（{a.valid_to.isoformat()}）之后",
            "effective_date",
            facts=[("归属最后有效日", a.valid_to, "info"), ("调科日", day, "bad")],
        )
    if day <= a.valid_from:
        # 尚未开始的归属在它的开始日调科 = 撤销原计划、改为新部门（原行成为空期间）
        if not (day == a.valid_from and a.valid_from > _today(s)):
            raise ItemError(
                f"这条归属自 {a.valid_from.isoformat()} 起，调科日须晚于这一天",
                "effective_date",
                hint="已生效的归属不能从开始日起整段改到别的部门。",
                facts=[("归属开始", a.valid_from, "info"), ("调科日", day, "bad")],
            )
    old_end = a.valid_to
    _set_end(ctx, a, day - DAY)
    new = PersonAssignment(
        engagement_id=a.engagement_id,
        department_id=d.id,
        kind=a.kind,
        valid_from=day,
        valid_to=old_end,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(new)
    s.flush()
    _require_assignment_ok(s, new, "department_code")
    ctx.new_assignments[new.id] = ctx.index
    kept = [
        f"{who}在{before['department_name']}的职务（{duty_label(x)}）不随调科转移，"
        "需要时另行交接或结束"
        for x in s.scalars(
            select(PersonDuty).where(
                PersonDuty.engagement_id == a.engagement_id,
                PersonDuty.department_id == a.department_id,
            )
        )
        if not is_void(x) and (x.valid_to is None or x.valid_to >= day)
    ]
    return {
        "target": f"人员 {before['person']} {who}",
        "before": before,
        "after": assignment_snapshot(s, new),
        "notices": dept_notices(s, d.id, new.valid_from, new.valid_to) + kept,
    }


def person_assignment_set_end(ctx: Ctx, item: PersonAssignmentSetEnd) -> dict:
    s = ctx.session
    a = _locked_assignment(s, item.assignment_id, item.expected_valid_to)
    before = assignment_snapshot(s, a)
    end = item.valid_to
    if end == a.valid_to:
        raise ItemError("结束日没有变化", "valid_to")
    if end is not None and end < a.valid_from - DAY:
        raise ItemError(f"最后有效日不能早于归属开始日 {a.valid_from.isoformat()}", "valid_to")
    if end is not None and end == a.valid_from - DAY and a.valid_from <= _today(s):
        raise ItemError(
            f"这条归属已于 {a.valid_from.isoformat()} 生效，不能撤销，只能结束",
            "valid_to",
            hint=f"最后有效日最早填 {a.valid_from.isoformat()}。",
        )
    _set_end(ctx, a, end)
    ctx.new_assignments[a.id] = ctx.index
    e = s.get(PersonEngagement, a.engagement_id)
    gap = end is not None and (e.valid_to is None or end < e.valid_to)
    return {
        "target": f"人员 {before['person']} {before['person_name']}",
        "before": before,
        "after": assignment_snapshot(s, a),
        "notices": ["之后这项任用暂未分配主部门；需要时用“补归属”处理"] if gap else [],
    }


def person_revise(ctx: Ctx, item: PersonRevise) -> dict:
    s = ctx.session
    p = _person(s, item.code, "code")
    latest = _latest(s, PersonVersion, PersonVersion.person_id, p.id)
    before = {"name": latest.name, "pinyin": latest.pinyin, "valid_from": _json(latest.valid_from)}
    pinyin = item.pinyin
    if pinyin is None:
        pinyin = latest.pinyin if item.name == latest.name else codes.pinyin_of(item.name)
    new = _next_version(
        ctx,
        PersonVersion,
        "person_id",
        p.id,
        latest,
        item.effective_date,
        {"name": item.name, "pinyin": pinyin},
        extra={"revise_reason": item.reason},
    )
    after = {"name": new.name, "pinyin": new.pinyin, "valid_from": _json(new.valid_from)}
    return {
        "target": f"人员 {p.code} {new.name}",
        "before": before,
        "after": after | {"reason": item.reason},
        "notices": _same_name_notice(s, new.name, p.id) if new.name != latest.name else [],
    }


def _locked_engagement(s: Session, engagement_id: int) -> PersonEngagement:
    e = s.get(PersonEngagement, engagement_id, with_for_update=True)
    if e is None:
        raise ItemError(f"任用 #{engagement_id} 不存在", "engagement_id")
    if is_void(e):
        raise ItemError("这项任用已在生效前撤销，不能再调整", "engagement_id")
    return e


def _within(e: PersonEngagement, day: date, field_name: str) -> None:
    if day < e.valid_from or (e.valid_to is not None and day > e.valid_to):
        raise ItemError(
            f"{day.isoformat()} 不在任用期间（{_period(e.valid_from, e.valid_to)}）内",
            field_name,
            facts=[("任用开始", e.valid_from, "info"), ("你填的日期", day, "bad")],
        )


def person_change_work_no(ctx: Ctx, item: PersonChangeWorkNo) -> dict:
    s = ctx.session
    e = _locked_engagement(s, item.engagement_id)
    day = item.effective_date
    _within(e, day, "effective_date")
    rows = sorted(
        (
            r
            for r in s.scalars(
                select(PersonWorkNo).where(PersonWorkNo.engagement_id == e.id).with_for_update()
            )
            if not is_void(r)
        ),
        key=lambda r: r.valid_from,
    )
    if any(r.valid_from > day for r in rows):
        later = next(r for r in rows if r.valid_from > day)
        raise ItemError(
            f"这项任用自 {later.valid_from.isoformat()} 起已登记工号 {later.work_no}，"
            "不能在它之前再换号",
            "effective_date",
        )
    current = next((r for r in rows if r.valid_to is None or r.valid_to >= day), None)
    if (current.work_no if current else None) != item.expected_work_no:
        now = current.work_no if current else "（无）"
        raise ItemError(
            f"这项任用当前的工号是 {now}，与发起时看到的不同",
            "engagement_id",
            hint="请刷新人员详情，按现在的情况重新发起。",
        )
    if current is not None and current.work_no == item.work_no:
        raise ItemError("工号没有变化", "work_no")
    if current is None and item.work_no is None:
        raise ItemError("这项任用没有工号，无需清除", "work_no")
    who = person_name(s, e.person_id, day)
    before = {"work_no": current.work_no if current else None}
    if current is not None:
        if day <= current.valid_from:
            if not (day == current.valid_from and current.valid_from > _today(s)):
                raise ItemError(
                    f"工号 {current.work_no} 自 {current.valid_from.isoformat()} 起，"
                    "换号的生效日须晚于这一天",
                    "effective_date",
                    facts=[("当前工号开始", current.valid_from, "info"), ("生效日", day, "bad")],
                )
        _set_end(ctx, current, day - DAY)
    if item.work_no:
        owner = s.scalar(
            select(PersonWorkNo.person_id).where(
                PersonWorkNo.institution_id == e.institution_id,
                PersonWorkNo.work_no == item.work_no,
                PersonWorkNo.person_id != e.person_id,
            )
        )
        if owner is not None:
            raise ItemError(
                f"工号 {item.work_no} 已属于{person_label(s, owner)}",
                "work_no",
                hint="同一主体内一个工号只属于一个人，离开后也不再发给别人。请核对工号。",
            )
        s.add(
            PersonWorkNo(
                engagement_id=e.id,
                person_id=e.person_id,
                institution_id=e.institution_id,
                work_no=item.work_no,
                revise_reason=item.reason,
                valid_from=day,
                valid_to=e.valid_to,
                change_id=ctx.change_id,
                recorded_by=ctx.user_id,
            )
        )
        s.flush()
    p = s.get(Person, e.person_id)
    return {
        "target": f"人员 {p.code} {who}",
        "before": before,
        "after": {"work_no": item.work_no, "valid_from": _json(day), "reason": item.reason},
    }


def person_assign(ctx: Ctx, item: PersonAssign) -> dict:
    s = ctx.session
    e = _locked_engagement(s, item.engagement_id)
    d = _department(s, item.department_code, "department_code")
    end = item.valid_to if item.valid_to is not None else e.valid_to
    kind = item.assignment_kind
    for other in s.scalars(
        select(PersonAssignment).where(
            PersonAssignment.engagement_id == e.id, PersonAssignment.kind == kind
        )
    ):
        if is_void(other) or not _overlaps(item.valid_from, end, other.valid_from, other.valid_to):
            continue
        if kind == "PRIMARY":
            raise ItemError(
                f"这项任用在 {_period(other.valid_from, other.valid_to)} 已归属"
                f"{_dept_name(s, other.department_id, other.valid_from)}，同一时期只能有一个主部门",
                "valid_from",
                hint="要换部门请用“调科”；补主部门只用于暂未分配的期间；兼任请选“附加归属”。",
            )
        if other.department_id == d.id:
            raise ItemError(
                f"这项任用在 {_period(other.valid_from, other.valid_to)} 已有"
                f"{_dept_name(s, d.id, other.valid_from)}的附加归属",
                "valid_from",
            )
    a = PersonAssignment(
        engagement_id=e.id,
        department_id=d.id,
        kind=kind,
        valid_from=item.valid_from,
        valid_to=end,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(a)
    s.flush()
    _require_assignment_ok(s, a, "department_code")
    ctx.new_assignments[a.id] = ctx.index
    snap = assignment_snapshot(s, a)
    return {
        "target": f"人员 {snap['person']} {snap['person_name']}",
        "before": None,
        "after": snap,
        "notices": dept_notices(s, d.id, a.valid_from, a.valid_to),
    }


def person_engagement_set_end(ctx: Ctx, item: PersonEngagementSetEnd) -> dict:
    s = ctx.session
    e = _locked_engagement(s, item.engagement_id)
    today = _today(s)
    old, new = e.valid_to, item.valid_to
    who = person_name(s, e.person_id, e.valid_from)
    if old != item.expected_valid_to:
        now = "长期有效" if old is None else f"最后有效日 {old.isoformat()}"
        raise ItemError(
            f"这项任用{_changed_to(e.closed_change_id, now)}，与发起时看到的不同",
            "engagement_id",
            hint="请刷新人员详情，按现在的情况重新发起。",
        )
    if old is not None and old < today:
        raise ItemError(
            f"这项任用已于 {old.isoformat()} 结束，结束日不能再改",
            "valid_to",
            hint="如再次任用，请在人员详情点“建立任用（再次任用）”，这会新建一项任用。",
        )
    if new == old:
        raise ItemError("结束日没有变化", "valid_to")
    if new is not None and new < e.valid_from - DAY:
        raise ItemError(f"最后有效日不能早于任用开始日 {e.valid_from.isoformat()}", "valid_to")
    cancelling = new is not None and new == e.valid_from - DAY
    if cancelling and e.valid_from <= today:
        raise ItemError(
            f"这项任用已于 {e.valid_from.isoformat()} 生效，不能撤销，只能结束",
            "valid_to",
            hint=f"最后有效日最早填 {e.valid_from.isoformat()}。",
        )
    before = engagement_snapshot(s, e)
    shorter = new is not None and (old is None or new < old)
    handled: list[str] = []
    children = [
        *(
            ("归属", r)
            for r in s.scalars(
                select(PersonAssignment)
                .where(PersonAssignment.engagement_id == e.id)
                .with_for_update()
            )
        ),
        *(
            ("工号", r)
            for r in s.scalars(
                select(PersonWorkNo).where(PersonWorkNo.engagement_id == e.id).with_for_update()
            )
        ),
        *(
            ("职务", r)
            for r in s.scalars(
                select(PersonDuty).where(PersonDuty.engagement_id == e.id).with_for_update()
            )
        ),
    ]
    # 追溯结束（新结束日早于今天）时，结束日之后才开始、但已经生效的下属关系不能改成“从未生效”：
    # 那会改写已生效的历史。只有尚未开始的计划自动撤销；有冲突就整项不成立，逐条列出
    if shorter:
        blocked = [
            r
            for _, r in children
            if not is_void(r) and r.valid_from > new and r.valid_from <= today
        ]
        if blocked:
            raise ItemError(
                f"最后有效日 {new.isoformat()} 之后，还有已经生效的"
                + "、".join(_child_label(s, what, r) for what, r in children if r in blocked)
                + "，不能把它们改成从未生效",
                "valid_to",
                hint="把最后有效日改到这些关系开始之后；或先在另一张申请里按实际情况结束它们，"
                "确属误录的历史请单独纠错。",
                facts=[("新的最后有效日", new, "bad")]
                + [("已生效关系开始", r.valid_from, "info") for r in blocked[:3]],
            )
    for what, r in sorted(children, key=lambda x: x[1].valid_from):
        if is_void(r):
            continue
        if what == "归属":
            label = _dept_name(s, r.department_id, r.valid_from)
        elif what == "职务":
            label = f"{_dept_name(s, r.department_id, r.valid_from)}{duty_label(r)}"
        else:
            label = f"工号 {r.work_no}"
        if shorter:
            if r.valid_to is not None and r.valid_to <= new:
                continue
            if r.valid_from > new:
                _set_end(ctx, r, r.valid_from - DAY)
                handled.append(f"{label}（原定 {r.valid_from.isoformat()} 开始）撤销，从未生效")
            else:
                _set_end(ctx, r, new)
                handled.append(f"{label}止于 {new.isoformat()}")
        elif r.valid_to == old and (what == "工号" or (what == "归属" and item.extend_assignments)):
            _set_end(ctx, r, new)
            handled.append(f"{label}延至 {'长期' if new is None else new.isoformat()}")
        elif r.valid_to == old and what == "职务":
            # A1：职务不随任用延长；续任是另一次任命，须有自己的依据
            handled.append(f"{label}仍止于 {old.isoformat()}：职务不随任用延长，续任请另行登记")
        if what == "归属":
            ctx.new_assignments[r.id] = ctx.index
        elif what == "职务":
            ctx.new_duties[r.id] = ctx.index
    _set_end(ctx, e, new)
    after = engagement_snapshot(s, e) | {"handled": handled}
    if cancelling:
        notices = ["撤销尚未开始的任用：从未生效，记录保留；人员身份与代码不变"]
    elif shorter:
        notices = ["本次任用关系自次日起结束（不表示其他系统的离院处置已完成）"]
    else:
        notices = []
    if not shorter and not item.extend_assignments:
        notices.append("部门归属未随任用延长：延长后的期间暂未分配主部门")
    return {
        "target": f"人员 {s.get(Person, e.person_id).code} {who}",
        "before": before,
        "after": after,
        "notices": notices + handled,
    }


# ------------------------------------------------------------------ 部门职务（P3）
def duty_snapshot(s: Session, d: PersonDuty) -> dict:
    e = s.get(PersonEngagement, d.engagement_id)
    p = s.get(Person, e.person_id)
    dept = s.get(Department, d.department_id)
    return {
        "id": d.id,
        "person": p.code,
        "person_name": person_name(s, p.id, d.valid_from),
        "department": dept.code,
        "department_name": _dept_name(s, dept.id, d.valid_from),
        "duty": d.duty,
        "mode": d.mode,
        "label": duty_label(d),
        "valid_from": _json(d.valid_from),
        "valid_to": _json(d.valid_to),
        "basis_note": d.basis_note,
    }


def _duty_notices(s: Session, d: PersonDuty) -> list[str]:
    """代管的部门不是此人的归属部门，正常；这里只提示与其他职务并存的情况。"""
    out = []
    if d.duty == "HEAD" and d.mode != "FORMAL":
        formal = [
            x
            for x in s.scalars(
                select(PersonDuty).where(
                    PersonDuty.department_id == d.department_id,
                    PersonDuty.duty == "HEAD",
                    PersonDuty.mode == "FORMAL",
                )
            )
            if not is_void(x) and _overlaps(d.valid_from, d.valid_to, x.valid_from, x.valid_to)
        ]
        for x in formal:
            e = s.get(PersonEngagement, x.engagement_id)
            out.append(
                f"部长{person_label(s, e.person_id, x.valid_from)}在任"
                f"（{_period(x.valid_from, x.valid_to)}），期间由此人主持工作，"
                "部门负责人显示为主持工作者"
            )
    e = s.get(PersonEngagement, d.engagement_id)
    in_dept = any(
        a.department_id == d.department_id
        and not is_void(a)
        and _overlaps(d.valid_from, d.valid_to, a.valid_from, a.valid_to)
        for a in s.scalars(select(PersonAssignment).where(PersonAssignment.engagement_id == e.id))
    )
    if not in_dept and d.mode != "CARETAKER":
        out.append(
            f"此人不归属{_dept_name(s, d.department_id, d.valid_from)}；"
            "跨部门临时管理请选“代管”，长期在该部门任职请先调科或加附加归属"
        )
    return out


def _require_post_free(s: Session, dept_id: int, duty: str, mode: str, start, end) -> None:
    """同一部门同一天正式部长、主持工作者各最多一位：先用名称说清是谁占着，再由排他约束兜底。"""
    if duty != "HEAD":
        return
    formal = mode == "FORMAL"
    for x in s.scalars(
        select(PersonDuty).where(PersonDuty.department_id == dept_id, PersonDuty.duty == "HEAD")
    ):
        if is_void(x) or (x.mode == "FORMAL") != formal:
            continue
        if _overlaps(start, end, x.valid_from, x.valid_to):
            e = s.get(PersonEngagement, x.engagement_id)
            what = "正式部长" if formal else "主持工作的人（代理或代管）"
            dept = _dept_name(s, dept_id, max(start, x.valid_from))
            raise ItemError(
                f"{dept}已有{what}{person_label(s, e.person_id, x.valid_from)}"
                f"（{_period(x.valid_from, x.valid_to)}），同一时点只能有一位",
                "duty",
                hint="换人请用“交接”；部长在任时由他人主持工作，请选“主持工作”。"
                if formal
                else "先结束或交接现有的主持工作，再任命。",
                facts=[("现任开始", x.valid_from, "info"), ("新任命开始", start, "bad")],
            )


def _require_basis(note: str | None, what: str) -> str:
    if not note:
        raise ItemError(
            f"{what}须写明任职依据",
            "basis_note",
            hint="写明任命文件或会议纪要，如“院发〔2026〕12 号”。",
        )
    return note


def _new_duty(
    ctx: Ctx, engagement_id: int, dept_id: int, duty: str, mode: str, start, end, basis: str
):
    s = ctx.session
    _require_post_free(s, dept_id, duty, mode, start, end)
    d = PersonDuty(
        engagement_id=engagement_id,
        department_id=dept_id,
        duty=duty,
        mode=mode,
        valid_from=start,
        valid_to=end,
        basis_note=basis,
        change_id=ctx.change_id,
        recorded_by=ctx.user_id,
    )
    s.add(d)
    s.flush()
    problem = duty_problem(s, d)
    if problem:
        raise ItemError(problem[0], "department_code", facts=problem[1])
    ctx.new_duties[d.id] = ctx.index
    return d


def person_duty_assign(ctx: Ctx, item: PersonDutyAssign) -> dict:
    s = ctx.session
    e = _locked_engagement(s, item.engagement_id)
    dept = _department(s, item.department_code, "department_code")
    if item.duty == "DEPUTY" and item.mode == "CARETAKER":
        raise ItemError("代管只用于部长职务（临时管理另一个部门）", "mode")
    basis = _require_basis(item.basis_note, "任命部门职务")
    end = item.valid_to if item.valid_to is not None else e.valid_to
    d = _new_duty(ctx, e.id, dept.id, item.duty, item.mode, item.valid_from, end, basis)
    snap = duty_snapshot(s, d)
    return {
        "target": f"人员 {snap['person']} {snap['person_name']}",
        "before": None,
        "after": snap,
        "notices": _duty_notices(s, d),
    }


def _locked_duty(s: Session, duty_id: int, expected: date | None) -> PersonDuty:
    d = s.get(PersonDuty, duty_id, with_for_update=True)
    if d is None:
        raise ItemError(f"职务 #{duty_id} 不存在", "duty_id")
    if is_void(d):
        raise ItemError("这条职务已在生效前撤销，不能再调整", "duty_id")
    if d.valid_to != expected:
        now = "长期有效" if d.valid_to is None else f"最后有效日 {d.valid_to.isoformat()}"
        raise ItemError(
            f"这条职务{_changed_to(d.closed_change_id, now)}，与发起时看到的不同",
            "duty_id",
            hint="请刷新页面，按现在的情况重新发起。",
        )
    return d


def person_duty_set_end(ctx: Ctx, item: PersonDutySetEnd) -> dict:
    s = ctx.session
    d = _locked_duty(s, item.duty_id, item.expected_valid_to)
    before = duty_snapshot(s, d)
    end = item.valid_to
    if end == d.valid_to:
        raise ItemError("结束日没有变化", "valid_to")
    if end is not None and end < d.valid_from - DAY:
        raise ItemError(f"最后有效日不能早于职务开始日 {d.valid_from.isoformat()}", "valid_to")
    if end is not None and end == d.valid_from - DAY and d.valid_from <= _today(s):
        raise ItemError(
            f"这条职务已于 {d.valid_from.isoformat()} 生效，不能撤销，只能结束", "valid_to"
        )
    # 结束、提前、补填结束日、撤销计划：依据选填。推后或清空已有的结束日 = 延长任期，
    # 是另一项已确定的任职结果，须写依据（与“任用延长不自动续职”同一道理）
    if d.valid_to is not None and (end is None or end > d.valid_to):
        _require_basis(item.basis_note, "延长职务任期")
    _set_end(ctx, d, end)
    ctx.new_duties[d.id] = ctx.index
    # 结束的依据选填，只留在申请里（职务行上的依据是任命依据）
    return {
        "target": f"人员 {before['person']} {before['person_name']}",
        "before": before,
        "after": duty_snapshot(s, d) | {"end_basis_note": item.basis_note},
    }


def person_duty_handover(ctx: Ctx, item: PersonDutyHandover) -> dict:
    s = ctx.session
    d = _locked_duty(s, item.duty_id, item.expected_valid_to)
    basis = _require_basis(item.basis_note, "职务交接")
    to = _locked_engagement(s, item.to_engagement_id)
    day = item.effective_date
    before = duty_snapshot(s, d)
    if to.id == d.engagement_id:
        raise ItemError("接任者与原任职者是同一项任用", "to_engagement_id")
    if day <= d.valid_from and not (day == d.valid_from and d.valid_from > _today(s)):
        raise ItemError(
            f"这条职务自 {d.valid_from.isoformat()} 起，交接日须晚于这一天",
            "effective_date",
            facts=[("职务开始", d.valid_from, "info"), ("交接日", day, "bad")],
        )
    if d.valid_to is not None and day > d.valid_to:
        raise ItemError(
            f"交接日 {day.isoformat()} 在这条职务结束（{d.valid_to.isoformat()}）之后",
            "effective_date",
        )
    _set_end(ctx, d, day - DAY)
    ctx.new_duties[d.id] = ctx.index
    end = to.valid_to
    new = _new_duty(ctx, to.id, d.department_id, d.duty, d.mode, day, end, basis)
    after = duty_snapshot(s, new)
    return {
        "target": f"{before['department_name']} {before['label']}",
        "before": before,
        "after": after,
        "notices": _duty_notices(s, new),
    }


def _child_label(s: Session, what: str, r) -> str:
    """任用下属关系的一句说明（含开始日），用于提示。"""
    if what == "归属":
        name = f"{_dept_name(s, r.department_id, r.valid_from)}归属"
    elif what == "职务":
        name = f"{_dept_name(s, r.department_id, r.valid_from)}{duty_label(r)}职务"
    else:
        name = f"工号 {r.work_no}"
    return f"{name}（{r.valid_from.isoformat()} 起）"


def end_department_duties(ctx: Ctx, dept: Department, day: date) -> list[str]:
    """部门撤销 / 被替代：它的职务随之结束于 day 前一日；day 及以后才开始的，
    尚未开始的计划撤销，已经生效的（追溯退出时）阻止并列出，不改写已生效的历史。"""
    s = ctx.session
    today = _today(s)
    out = []
    rows = [
        d
        for d in s.scalars(
            select(PersonDuty).where(PersonDuty.department_id == dept.id).with_for_update()
        )
        if not is_void(d) and (d.valid_to is None or d.valid_to >= day)
    ]
    effective_after = [d for d in rows if day <= d.valid_from <= today]
    if effective_after:
        who = "、".join(
            f"{person_label(s, s.get(PersonEngagement, d.engagement_id).person_id, d.valid_from)}"
            f"的{duty_label(d)}职务（{d.valid_from.isoformat()} 起）"
            for d in effective_after
        )
        raise ItemError(
            f"部门退出日 {day.isoformat()} 之后，还有已经生效的{who}，不能把它们改成从未生效",
            "effective_date",
            hint="把退出日改到这些职务开始之后；或先在另一张申请里按实际情况结束这些职务。",
            facts=[("部门退出日", day, "bad")]
            + [("职务开始", d.valid_from, "info") for d in effective_after[:3]],
        )
    for d in rows:
        e = s.get(PersonEngagement, d.engagement_id)
        who = person_label(s, e.person_id, d.valid_from)
        if d.valid_from >= day:
            _set_end(ctx, d, d.valid_from - DAY)
            out.append(f"职务 {duty_label(d)}：{who}（计划撤销）")
        else:
            _set_end(ctx, d, day - DAY)
            out.append(f"职务 {duty_label(d)}：{who}")
    return out


HANDLERS = {
    "person.duty_assign": person_duty_assign,
    "person.duty_set_end": person_duty_set_end,
    "person.duty_handover": person_duty_handover,
    "person.create": person_create,
    "person.revise": person_revise,
    "person.change_work_no": person_change_work_no,
    "person.assign": person_assign,
    "person.engage": person_engage,
    "person.transfer": person_transfer,
    "person.engagement_set_end": person_engagement_set_end,
    "person.assignment_set_end": person_assignment_set_end,
}


# ------------------------------------------------------------------ 申请全部应用后的检查
def check_persons(ctx: Ctx) -> list[ProblemItem]:
    """本申请新写或改过的归属，以及本申请改过生命周期的部门下的全部归属（含未来才开始的），
    逐条按完整期间检查。部门撤销 / 被替代而仍有人员归属的，阻止确认并列出。"""
    s = ctx.session
    checks: dict[int, int] = dict(ctx.new_assignments)
    if ctx.touched_departments:
        for a in s.scalars(
            select(PersonAssignment).where(
                PersonAssignment.department_id.in_(ctx.touched_departments)
            )
        ):
            checks.setdefault(a.id, ctx.touched_departments[a.department_id])
    blocked: dict[int, tuple[list[str], list[str]]] = {}
    for assignment_id, index in sorted(checks.items()):
        a = s.get(PersonAssignment, assignment_id)
        problem = assignment_problem(s, a)
        if not problem:
            continue
        own, dependents = blocked.setdefault(index, ([], []))
        if assignment_id in ctx.new_assignments:
            own.append(problem[0])
        else:
            e = s.get(PersonEngagement, a.engagement_id)
            dependents.append(
                f"{person_label(s, e.person_id, a.valid_from)}"
                f"归属{_dept_name(s, a.department_id, a.valid_from)}"
                f"（{_period(a.valid_from, a.valid_to)}）"
            )
    for duty_id, index in sorted(ctx.new_duties.items()):
        problem = duty_problem(s, s.get(PersonDuty, duty_id))
        if problem:
            blocked.setdefault(index, ([], []))[0].append(problem[0])
    problems = []
    for index, (own, dependents) in sorted(blocked.items()):
        parts = list(own)
        if dependents:
            parts.append(
                f"这一项生效后，有 {len(dependents)} 条人员归属不再成立："
                + "；".join(dependents)
                + "。"
            )
        problems.append(
            ProblemItem(
                message="".join(parts),
                item_index=index,
                hint="在本申请里为这些人员逐个处理：调到承接部门，或结束归属。"
                if dependents
                else None,
            )
        )
    return problems
