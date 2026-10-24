"""人员的只读查询（人员设计第 7 节）：名册、查重检索、详情、部门的人员、承接清单、导出行。

- 状态（有效任用 / 计划中 / 无效任用）按查看日期从任用派生，不存储。
- 人数按人员去重：一人多项任用仍是一行。
- 敏感字段按 core/permissions.PERSON_FIELD_PERMISSIONS 统一隐去（值置空、列入 masked_fields）。
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from functools import cached_property

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.errors import NotFound
from hdip_api.core.permissions import PERSON_FIELD_PERMISSIONS, masked_fields
from hdip_api.models import (
    AppUser,
    ChangeRequest,
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
from hdip_api.schemas.read import (
    DepartmentDutyRow,
    DepartmentLeaderRow,
    DepartmentPersonRow,
    DeptRef,
    DutyRegister,
    DutyRegisterRow,
    EngagementEndChange,
    PersonAssignmentOut,
    PersonDetail,
    PersonDutyOut,
    PersonEngagementBrief,
    PersonEngagementOut,
    PersonRow,
    PersonVersionOut,
    PersonWorkNoOut,
)
from hdip_api.services.apply import is_void
from hdip_api.services.persons import duty_label
from hdip_api.services.queries import _pick, _versions_by, covers


def _period(a: date, b: date | None) -> str:
    return f"{a.isoformat()} 起" if b is None else f"{a.isoformat()} 至 {b.isoformat()}"


def _live(rows):
    return [r for r in rows if not is_void(r)]


@dataclass
class _World:
    """一次查询用到的人员与组织数据（规模小，整表读入）。"""

    persons: dict[int, Person]
    versions: dict[int, list[PersonVersion]]
    engagements: dict[int, list[PersonEngagement]]
    work_nos: dict[int, list[PersonWorkNo]]
    assignments: dict[int, list[PersonAssignment]]
    duties: dict[int, list[PersonDuty]]
    departments: dict[int, Department]
    dept_versions: dict[int, list[DepartmentVersion]]
    institutions: dict[int, Institution]
    inst_versions: dict[int, list[InstitutionVersion]]

    @cached_property
    def engagement_of(self) -> dict[int, PersonEngagement]:
        return {e.id: e for es in self.engagements.values() for e in es}

    @classmethod
    def load(cls, s: Session) -> "_World":
        by = lambda rows, key: _group(rows, key)  # noqa: E731
        return cls(
            persons={p.id: p for p in s.scalars(select(Person))},
            versions=_versions_by(s, PersonVersion, "person_id"),
            engagements=by(s.scalars(select(PersonEngagement)), "person_id"),
            work_nos=by(s.scalars(select(PersonWorkNo)), "engagement_id"),
            assignments=by(s.scalars(select(PersonAssignment)), "engagement_id"),
            duties=by(s.scalars(select(PersonDuty)), "engagement_id"),
            departments={d.id: d for d in s.scalars(select(Department))},
            dept_versions=_versions_by(s, DepartmentVersion, "department_id"),
            institutions={i.id: i for i in s.scalars(select(Institution))},
            inst_versions=_versions_by(s, InstitutionVersion, "institution_id"),
        )

    # ------------------------------------------------ 名称
    def name(self, person_id: int, day: date) -> PersonVersion | None:
        v, _, _ = _pick(self.versions[person_id], day)
        if v is None:
            live = sorted(_live(self.versions[person_id]), key=lambda x: x.version_no)
            v = live[-1] if live else None
        return v

    def dept_version(self, dept_id: int, day: date) -> DepartmentVersion:
        v, _, _ = _pick(self.dept_versions[dept_id], day)
        return v or max(self.dept_versions[dept_id], key=lambda x: x.version_no)

    def dept_ref(self, dept_id: int, day: date) -> DeptRef:
        return DeptRef(
            id=dept_id,
            code=self.departments[dept_id].code,
            name=self.dept_version(dept_id, day).name,
        )

    def inst_name(self, inst_id: int, day: date) -> str:
        v, _, _ = _pick(self.inst_versions[inst_id], day)
        return (v or max(self.inst_versions[inst_id], key=lambda x: x.version_no)).name

    # ------------------------------------------------ 状态
    def live_engagements(self, person_id: int) -> list[PersonEngagement]:
        return sorted(_live(self.engagements[person_id]), key=lambda e: e.valid_from)

    def status(self, person_id: int, day: date) -> str:
        es = self.live_engagements(person_id)
        if any(covers(e.valid_from, e.valid_to, day) for e in es):
            return "ENGAGED"
        if any(e.valid_from > day for e in es):
            return "PLANNED"
        return "NONE"

    def on_or_first(self, rows, day: date):
        """当天有效的一行；没有时取当天之后最早开始的一行。"""
        live = sorted(_live(rows), key=lambda r: r.valid_from)
        for r in live:
            if covers(r.valid_from, r.valid_to, day):
                return r
        return next((r for r in live if r.valid_from > day), None)

    def on(self, rows, day: date):
        return next((r for r in _live(rows) if covers(r.valid_from, r.valid_to, day)), None)

    def brief(self, e: PersonEngagement, day: date, hidden: set[str]) -> PersonEngagementBrief:
        anchor = max(day, e.valid_from)
        if e.valid_to is not None and anchor > e.valid_to:
            anchor = e.valid_to
        # 任用当天有效：只取当天的归属与工号（没有就是暂未分配）；任用尚未开始：取最早的计划
        pick = self.on_or_first if e.valid_from > day else self.on
        a = pick([x for x in self.assignments[e.id] if x.kind == "PRIMARY"], anchor)
        w = pick(self.work_nos[e.id], anchor)
        return PersonEngagementBrief(
            id=e.id,
            institution_id=e.institution_id,
            institution_name=self.inst_name(e.institution_id, anchor),
            engagement_type=e.engagement_type,
            valid_from=e.valid_from,
            valid_to=e.valid_to,
            not_yet_effective=e.valid_from > day,
            work_no=None if (w is None or "work_no" in hidden) else w.work_no,
            assignment_id=a.id if a else None,
            department=self.dept_ref(a.department_id, anchor) if a else None,
        )


def _group(rows, key: str) -> dict[int, list]:
    out: dict[int, list] = defaultdict(list)
    for r in rows:
        out[getattr(r, key)].append(r)
    return out


def _hidden(user: AppUser) -> set[str]:
    return masked_fields(user, PERSON_FIELD_PERMISSIONS)


# ------------------------------------------------------------------ 检索
def _match(w: _World, person_id: int, q: str, day: date) -> tuple[bool, str | None]:
    """q 命中这个人吗；命中的不是当前姓名 / 拼音码 / 代码时说明命中了什么。"""
    q = q.strip().lower()
    if not q:
        return True, None
    p = w.persons[person_id]
    current = w.name(person_id, day)
    if q in p.code.lower() or (
        current and (q in current.name.lower() or q in (current.pinyin or "").lower())
    ):
        return True, None
    versions = sorted(w.versions[person_id], key=lambda v: v.version_no)
    for i, v in enumerate(versions):
        if q in v.name.lower() or q in (v.pinyin or "").lower():
            nxt = versions[i + 1] if i + 1 < len(versions) else None
            kind = "误录" if nxt is not None and nxt.revise_reason == "CORRECTION" else "曾用名"
            return True, f"{kind} {v.name}（{_period(v.valid_from, v.valid_to)}）"
    for e in w.engagements[person_id]:
        for n in w.work_nos[e.id]:
            if q in n.work_no.lower():
                if covers(n.valid_from, n.valid_to, day):
                    return True, f"工号 {n.work_no}"
                return True, f"旧工号 {n.work_no}（{_period(n.valid_from, n.valid_to)}）"
    return False, None


def list_persons(
    s: Session,
    user: AppUser,
    day: date,
    *,
    q: str = "",
    scope: str = "as_of",
    status: str | None = None,
    institution_id: int | None = None,
    department_id: int | None = None,
    include_future: bool = False,
) -> list[PersonRow]:
    """名册（scope=as_of）：默认只列查看日期有有效任用的人，include_future 加上仅有计划的人；
    status 指定时按状态筛。查重（scope=all）：不看日期，含历史、未来、无有效任用的人。"""
    w = _World.load(s)
    hidden = _hidden(user)
    rows: list[PersonRow] = []
    for pid, p in sorted(w.persons.items(), key=lambda x: x[1].code):
        st = w.status(pid, day)
        if scope != "all":
            if status is not None:
                if st != status:
                    continue
            elif st == "NONE" or (st == "PLANNED" and not include_future):
                continue
        ok, matched = _match(w, pid, q, day)
        if not ok:
            continue
        es = w.live_engagements(pid)
        if scope != "all":
            es = [
                e
                for e in es
                if covers(e.valid_from, e.valid_to, day)
                or (e.valid_from > day and (include_future or st == "PLANNED"))
            ]
        briefs = [w.brief(e, day, hidden) for e in es]
        if institution_id is not None and not any(
            b.institution_id == institution_id for b in briefs
        ):
            continue
        if department_id is not None and not any(
            b.department and b.department.id == department_id for b in briefs
        ):
            continue
        v = w.name(pid, day)
        rows.append(
            PersonRow(
                id=pid,
                code=p.code,
                name=v.name if v else "",
                pinyin=v.pinyin if v else None,
                status=st,
                engagements=briefs,
                matched=matched,
                masked_fields=sorted(hidden),
            )
        )
    return rows


def _end_changes(s: Session, engagement_ids: set[int]) -> dict[int, list[EngagementEndChange]]:
    """从已确认申请的前后结果里还原每项任用结束日的登记与逐次调整（不另建日志表）。"""
    out: dict[int, list[EngagementEndChange]] = defaultdict(list)
    if not engagement_ids:
        return out
    rows = s.scalars(
        select(ChangeRequest)
        .where(
            ChangeRequest.status == "confirmed",
            ChangeRequest.results.contains([{"kind": "person.engagement_set_end"}])
            | ChangeRequest.results.contains([{"kind": "person.engage"}]),
        )
        .order_by(ChangeRequest.confirmed_at, ChangeRequest.id)
    )
    for cr in rows:
        for o in cr.results or []:
            before, after = o.get("before") or {}, o.get("after") or {}
            if o.get("kind") == "person.engage":
                eid = after.get("id")
                if eid in engagement_ids and after.get("valid_to"):
                    out[eid].append(
                        EngagementEndChange(
                            change_id=cr.id,
                            confirmed_at=cr.confirmed_at,
                            action="REGISTER",
                            from_valid_to=None,
                            to_valid_to=after["valid_to"],
                        )
                    )
                continue
            if (
                o.get("kind") != "person.engagement_set_end"
                or before.get("id") not in engagement_ids
            ):
                continue
            old, new = before.get("valid_to"), after.get("valid_to")
            if new is None:
                action = "CLEAR"
            elif new < after["valid_from"]:
                action = "CANCEL"
            elif old is None:
                action = "END"
            else:
                action = "EARLIER" if new < old else "LATER"
            out[before["id"]].append(
                EngagementEndChange(
                    change_id=cr.id,
                    confirmed_at=cr.confirmed_at,
                    action=action,
                    from_valid_to=old,
                    to_valid_to=new,
                    handled=after.get("handled", []),
                )
            )
    return out


def get_person(s: Session, user: AppUser, person_id: int, day: date) -> PersonDetail:
    w = _World.load(s)
    p = w.persons.get(person_id)
    if p is None:
        raise NotFound("人员不存在")
    hidden = _hidden(user)
    v = w.name(person_id, day)

    def assignment_out(a: PersonAssignment) -> PersonAssignmentOut:
        anchor = day if covers(a.valid_from, a.valid_to, day) else a.valid_from
        dv = w.dept_version(a.department_id, anchor)
        return PersonAssignmentOut(
            id=a.id,
            kind=a.kind,
            department=w.dept_ref(a.department_id, anchor),
            department_lifecycle=dv.lifecycle,
            valid_from=a.valid_from,
            valid_to=a.valid_to,
            change_id=a.change_id,
            closed_change_id=a.closed_change_id,
            void=is_void(a),
        )

    engagements = []
    end_changes = _end_changes(s, {e.id for e in w.engagements[person_id]})
    for e in sorted(w.engagements[person_id], key=lambda x: (x.valid_from, x.id), reverse=True):
        engagements.append(
            PersonEngagementOut(
                id=e.id,
                institution_id=e.institution_id,
                institution_code=w.institutions[e.institution_id].code,
                institution_name=w.inst_name(e.institution_id, e.valid_from),
                engagement_type=e.engagement_type,
                note=e.note,
                valid_from=e.valid_from,
                valid_to=e.valid_to,
                change_id=e.change_id,
                closed_change_id=e.closed_change_id,
                void=is_void(e),
                work_nos=[
                    PersonWorkNoOut(
                        id=n.id,
                        work_no=None if "work_no" in hidden else n.work_no,
                        revise_reason=n.revise_reason,
                        valid_from=n.valid_from,
                        valid_to=n.valid_to,
                        change_id=n.change_id,
                        closed_change_id=n.closed_change_id,
                        void=is_void(n),
                    )
                    for n in sorted(w.work_nos[e.id], key=lambda x: (x.valid_from, x.id))
                ],
                assignments=[
                    assignment_out(a)
                    for a in sorted(w.assignments[e.id], key=lambda x: (x.valid_from, x.id))
                ],
                end_changes=end_changes.get(e.id, []),
                duties=[
                    PersonDutyOut(
                        id=d.id,
                        department=w.dept_ref(
                            d.department_id,
                            day if covers(d.valid_from, d.valid_to, day) else d.valid_from,
                        ),
                        duty=d.duty,
                        mode=d.mode,
                        label=duty_label(d),
                        valid_from=d.valid_from,
                        valid_to=d.valid_to,
                        basis_note=d.basis_note,
                        change_id=d.change_id,
                        closed_change_id=d.closed_change_id,
                        void=is_void(d),
                    )
                    for d in sorted(w.duties[e.id], key=lambda x: (x.valid_from, x.id))
                ],
            )
        )
    return PersonDetail(
        id=p.id,
        code=p.code,
        name=v.name if v else "",
        pinyin=v.pinyin if v else None,
        status=w.status(person_id, day),
        created_at=p.created_at,
        created_change_id=p.created_change_id,
        versions=[
            PersonVersionOut(
                version_no=x.version_no,
                valid_from=x.valid_from,
                valid_to=x.valid_to,
                name=x.name,
                pinyin=x.pinyin,
                revise_reason=x.revise_reason,
                change_id=x.change_id,
                recorded_at=x.recorded_at,
                void=is_void(x),
            )
            for x in sorted(w.versions[person_id], key=lambda x: -x.version_no)
        ],
        engagements=engagements,
        masked_fields=sorted(hidden),
    )


# ------------------------------------------------------------------ 部门的人员
def department_persons(
    s: Session,
    department_id: int,
    day: date,
    *,
    from_day: bool = False,
    include_future: bool = False,
) -> list[DepartmentPersonRow]:
    """归属该部门的人员。

    默认：查看日期当天的主归属（include_future 加上之后才开始的）。
    from_day=True（承接清单）：与 day 及以后相交的全部归属，含预约调入的。
    """
    w = _World.load(s)
    if department_id not in w.departments:
        raise NotFound("部门不存在")
    engagement_of = w.engagement_of
    rows: list[DepartmentPersonRow] = []
    for es in w.assignments.values():
        for a in _live(es):
            if a.department_id != department_id:
                continue
            current = covers(a.valid_from, a.valid_to, day)
            later = a.valid_from > day
            if from_day:
                if not (current or later):
                    continue
            elif not (current or (later and include_future)):
                continue
            e = engagement_of[a.engagement_id]
            anchor = max(day, a.valid_from)
            v = w.name(e.person_id, anchor)
            rows.append(
                DepartmentPersonRow(
                    person_id=e.person_id,
                    person_code=w.persons[e.person_id].code,
                    person_name=v.name if v else "",
                    engagement_id=e.id,
                    engagement_type=e.engagement_type,
                    institution_name=w.inst_name(e.institution_id, anchor),
                    assignment_id=a.id,
                    kind=a.kind,
                    valid_from=a.valid_from,
                    valid_to=a.valid_to,
                    not_yet_effective=later,
                )
            )
    return sorted(rows, key=lambda r: (r.not_yet_effective, r.person_code, r.valid_from))


def _duty_row(w: _World, d: PersonDuty, day: date) -> DepartmentDutyRow:
    e = w.engagement_of[d.engagement_id]
    v = w.name(e.person_id, max(day, d.valid_from))
    return DepartmentDutyRow(
        duty_id=d.id,
        person_id=e.person_id,
        person_code=w.persons[e.person_id].code,
        person_name=v.name if v else "",
        engagement_id=e.id,
        duty=d.duty,
        mode=d.mode,
        label=duty_label(d),
        valid_from=d.valid_from,
        valid_to=d.valid_to,
        not_yet_effective=d.valid_from > day,
        basis_note=d.basis_note,
    )


_DUTY_ORDER = {"HEAD": 0, "DEPUTY": 1}


def _duty_sort(r: DepartmentDutyRow):
    return (r.not_yet_effective, _DUTY_ORDER[r.duty], r.mode != "FORMAL")


def _duties_on(w: _World, day: date, include_future: bool):
    """查看日期有效的职务（include_future 加上之后才开始的），不含生效前撤销的。"""
    for ds in w.duties.values():
        for d in _live(ds):
            if covers(d.valid_from, d.valid_to, day) or (include_future and d.valid_from > day):
                yield d


def department_duties(
    s: Session, department_id: int, day: date, *, include_future: bool = False
) -> list[DepartmentDutyRow]:
    """查看日期该部门的职务（含代管者；include_future 加上之后才开始的）。"""
    w = _World.load(s)
    if department_id not in w.departments:
        raise NotFound("部门不存在")
    rows = [
        _duty_row(w, d, day)
        for d in _duties_on(w, day, include_future)
        if d.department_id == department_id
    ]
    return sorted(rows, key=_duty_sort)


# ------------------------------------------------------------------ 部门任职台账（A1）
def duty_register(
    s: Session,
    user: AppUser,
    day: date,
    *,
    q: str = "",
    department_id: int | None = None,
    duty: str | None = None,
    mode: str | None = None,
    include_future: bool = False,
) -> DutyRegister:
    """全院部门任职：一行一条职务；负责人一览按部门列出当天的部长职务（空 = 空缺）。

    q 匹配人员（姓名、曾用名、拼音码、代码、工号）或任职部门名称。台账、部门详情、人员详情
    读的是同一批职务行，规则相同。"""
    w = _World.load(s)
    if department_id is not None and department_id not in w.departments:
        raise NotFound("部门不存在")
    needle = q.strip().lower()
    rows: list[DutyRegisterRow] = []
    for d in _duties_on(w, day, include_future):
        if department_id is not None and d.department_id != department_id:
            continue
        if (duty and d.duty != duty) or (mode and d.mode != mode):
            continue
        e = w.engagement_of[d.engagement_id]
        anchor = max(day, d.valid_from)
        dept = w.dept_ref(d.department_id, anchor)
        if needle and needle not in dept.name.lower() and not _match(w, e.person_id, q, day)[0]:
            continue
        primary = w.on([x for x in w.assignments[e.id] if x.kind == "PRIMARY"], anchor)
        base = _duty_row(w, d, day)
        rows.append(
            DutyRegisterRow(
                **base.model_dump(),
                department=dept,
                institution_name=w.inst_name(e.institution_id, anchor),
                engagement_type=e.engagement_type,
                primary_department=w.dept_ref(primary.department_id, anchor) if primary else None,
                change_id=d.change_id,
            )
        )
    rows.sort(key=lambda r: (r.department.code, *_duty_sort(r), r.person_code))
    current = [r for r in rows if not r.not_yet_effective]

    heads: dict[int, list[DepartmentDutyRow]] = defaultdict(list)
    for d in _duties_on(w, day, False):
        if d.duty == "HEAD":
            heads[d.department_id].append(_duty_row(w, d, day))
    leaders = []
    for dept_id, _dept in sorted(w.departments.items(), key=lambda x: x[1].code):
        if department_id is not None and dept_id != department_id:
            continue
        v, later, _ = _pick(w.dept_versions[dept_id], day)
        active = v is not None and not later and v.lifecycle == "ACTIVE"
        if active or heads.get(dept_id):
            leaders.append(
                DepartmentLeaderRow(
                    department=w.dept_ref(dept_id, day),
                    heads=sorted(heads.get(dept_id, []), key=_duty_sort),
                )
            )
    return DutyRegister(
        as_of=day,
        record_count=len(current),
        person_count=len({r.person_id for r in current}),
        planned_count=len(rows) - len(current),
        rows=rows,
        leaders=leaders,
    )


# ------------------------------------------------------------------ 导出
def export_persons(s: Session, user: AppUser, day: date, **filters):
    """与名册同口径（同日期、同筛选），一人一行；默认只含当天有有效任用的人。"""
    for r in list_persons(s, user, day, **filters):
        yield {
            "person_code": r.code,
            "name": r.name,
            "pinyin": r.pinyin,
            "relation_status": r.status,
        }


def export_relations(s: Session, user: AppUser, day: date, **filters):
    """与名册同口径：名册里每人的每项任用一行，附当天（计划中的取最早计划）的主归属；
    暂未分配时部门列为空。不带筛选时 = 当天有效的任用。"""
    w = _World.load(s)
    engagement_of = w.engagement_of
    assignment_of = {a.id: a for rows in w.assignments.values() for a in rows}
    for r in list_persons(s, user, day, **filters):
        for b in r.engagements:
            e = engagement_of[b.id]
            a = assignment_of[b.assignment_id] if b.assignment_id else None
            yield {
                "person_code": r.code,
                "name": r.name,
                "institution_code": w.institutions[e.institution_id].code,
                "institution_name": b.institution_name,
                "engagement_type": e.engagement_type,
                "work_no": b.work_no,
                "engagement_valid_from": e.valid_from,
                "engagement_valid_to": e.valid_to,
                "assignment_kind": a.kind if a else None,
                "department_code": b.department.code if b.department else None,
                "department_name": b.department.name if b.department else None,
                "assignment_valid_from": a.valid_from if a else None,
                "assignment_valid_to": a.valid_to if a else None,
                "not_yet_effective": b.not_yet_effective,
            }


def export_duties(s: Session, user: AppUser, day: date, **filters):
    """与部门任职台账同日期、同筛选、同粒度：一行一条职务。"""
    for r in duty_register(s, user, day, **filters).rows:
        yield {
            "department_code": r.department.code,
            "department_name": r.department.name,
            "duty": r.duty,
            "mode": r.mode,
            "label": r.label,
            "person_code": r.person_code,
            "name": r.person_name,
            "institution_name": r.institution_name,
            "engagement_type": r.engagement_type,
            "primary_department_code": r.primary_department.code if r.primary_department else None,
            "primary_department_name": r.primary_department.name if r.primary_department else None,
            "valid_from": r.valid_from,
            "valid_to": r.valid_to,
            "not_yet_effective": r.not_yet_effective,
            "basis_note": r.basis_note,
            "change_id": r.change_id,
        }
