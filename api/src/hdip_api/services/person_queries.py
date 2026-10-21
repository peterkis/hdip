"""人员的只读查询（人员设计第 7 节）：名册、查重检索、详情、部门的人员、承接清单、导出行。

- 状态（有有效任用 / 仅有计划 / 无有效任用）按查看日期从任用派生，不存储。
- 人数按人员去重：一人多项任用仍是一行。
- 敏感字段按 core/permissions.PERSON_FIELD_PERMISSIONS 统一隐去（值置空、列入 masked_fields）。
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from hdip_api.core.errors import NotFound
from hdip_api.core.permissions import PERSON_FIELD_PERMISSIONS, masked_fields
from hdip_api.models import (
    AppUser,
    Department,
    DepartmentVersion,
    Institution,
    InstitutionVersion,
    Person,
    PersonAssignment,
    PersonEngagement,
    PersonVersion,
    PersonWorkNo,
)
from hdip_api.schemas.read import (
    DepartmentPersonRow,
    DeptRef,
    PersonAssignmentOut,
    PersonDetail,
    PersonEngagementBrief,
    PersonEngagementOut,
    PersonRow,
    PersonVersionOut,
    PersonWorkNoOut,
)
from hdip_api.services.apply import is_void
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
    departments: dict[int, Department]
    dept_versions: dict[int, list[DepartmentVersion]]
    institutions: dict[int, Institution]
    inst_versions: dict[int, list[InstitutionVersion]]

    @classmethod
    def load(cls, s: Session) -> "_World":
        by = lambda rows, key: _group(rows, key)  # noqa: E731
        return cls(
            persons={p.id: p for p in s.scalars(select(Person))},
            versions=_versions_by(s, PersonVersion, "person_id"),
            engagements=by(s.scalars(select(PersonEngagement)), "person_id"),
            work_nos=by(s.scalars(select(PersonWorkNo)), "engagement_id"),
            assignments=by(s.scalars(select(PersonAssignment)), "engagement_id"),
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
        a = pick(self.assignments[e.id], anchor)
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
    engagement_of = {e.id: e for es in w.engagements.values() for e in es}
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


# ------------------------------------------------------------------ 导出
def export_persons(s: Session, user: AppUser, day: date):
    """当天有有效任用的人员，一人一行。"""
    for r in list_persons(s, user, day):
        yield {
            "person_code": r.code,
            "name": r.name,
            "pinyin": r.pinyin,
            "relation_status": r.status,
        }


def export_relations(s: Session, user: AppUser, day: date):
    """当天有效的任用 × 当天的主归属，一行一项任用；暂未分配时部门列为空。"""
    w = _World.load(s)
    hidden = _hidden(user)
    for pid, p in sorted(w.persons.items(), key=lambda x: x[1].code):
        v = w.name(pid, day)
        for e in w.live_engagements(pid):
            if not covers(e.valid_from, e.valid_to, day):
                continue
            a = next(
                (x for x in _live(w.assignments[e.id]) if covers(x.valid_from, x.valid_to, day)),
                None,
            )
            n = next(
                (x for x in _live(w.work_nos[e.id]) if covers(x.valid_from, x.valid_to, day)),
                None,
            )
            yield {
                "person_code": p.code,
                "name": v.name if v else "",
                "institution_code": w.institutions[e.institution_id].code,
                "institution_name": w.inst_name(e.institution_id, day),
                "engagement_type": e.engagement_type,
                "work_no": None if (n is None or "work_no" in hidden) else n.work_no,
                "engagement_valid_from": e.valid_from,
                "engagement_valid_to": e.valid_to,
                "assignment_kind": a.kind if a else None,
                "department_code": w.departments[a.department_id].code if a else None,
                "department_name": w.dept_version(a.department_id, day).name if a else None,
                "assignment_valid_from": a.valid_from if a else None,
                "assignment_valid_to": a.valid_to if a else None,
            }
