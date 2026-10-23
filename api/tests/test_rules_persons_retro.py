"""追溯结束不改写已生效的历史（2026-10-23 收尾）：
任用追溯结束、部门追溯退出时，结束日之后才开始的下属关系——
尚未开始的计划自动撤销；已经生效的不能改成“从未生效”，整项不成立并逐条列出对象与日期。"""

from factories import (
    change_work_no,
    dept_create,
    dept_item,
    duty_assign,
    engagement_end,
    register,
    transfer,
    world,
)
from person_helpers import assignment_ids, days, dept_id, duties, engagement_id, person
from reorg_helpers import reorganize


def _base(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", work_no="0007"))
    return engagement_id(api, "P000001")


def _problem(api, *items):
    cr = api.draft(*items)
    r = api.submit(cr["id"])
    assert r.status_code == 422, r.text
    api.cancel(cr["id"])
    return r.json()["problems"][0]


def _snapshot(api):
    d = person(api, "P000001")
    return [
        (x["id"], x["valid_from"], x["valid_to"], x["void"])
        for e in d["engagements"]
        for x in [*e["assignments"], *e["work_nos"], *e.get("duties", [])]
    ] + [(e["id"], e["valid_from"], e["valid_to"]) for e in d["engagements"]]


def test_retro_end_blocks_effective_assignment(api):
    eid = _base(api)
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    api.apply(transfer(aid, "B", "2024-01-01"))
    before = _snapshot(api)
    p = _problem(api, engagement_end(eid, "2023-06-30"))
    assert "乙科归属（2024-01-01 起）" in p["message"] and "不能把它们改成从未生效" in p["message"]
    assert [f["date"] for f in p["facts"]][:2] == ["2023-06-30", "2024-01-01"]
    assert _snapshot(api) == before  # 整单不成立，原样不动


def test_retro_end_blocks_effective_work_no(api):
    eid = _base(api)
    api.apply(change_work_no(eid, "0007", "1001", "2024-01-01"))
    p = _problem(api, engagement_end(eid, "2023-06-30"))
    assert "工号 1001（2024-01-01 起）" in p["message"]


def test_retro_end_blocks_effective_duty(api):
    eid = _base(api)
    api.apply(duty_assign(eid, "A", valid_from="2024-01-01"))
    p = _problem(api, engagement_end(eid, "2023-06-30"))
    assert "甲科部长职务（2024-01-01 起）" in p["message"]


def test_retro_end_still_truncates_overlapping_and_cancels_future_plans(api):
    """跨过新结束日的照常截断；之后才开始、尚未生效的计划照常撤销。"""
    eid = _base(api)
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    api.apply(transfer(aid, "B", days(30)))  # 尚未开始的计划调科
    end = days(10)
    api.apply(engagement_end(eid, end))
    a = person(api, "P000001")["engagements"][0]["assignments"]
    assert [(x["department"]["code"], x["valid_to"], x["void"]) for x in a] == [
        ("A", end, False),
        ("B", a[1]["valid_to"], True),
    ]


def _dept_with_duty(api):
    eid = _base(api)
    api.apply(dept_create(code="D", name="丁科"), dept_create(code="E", name="戊科"))
    api.apply(duty_assign(eid, "D", "HEAD", "CARETAKER", "2024-01-01"))
    return eid


def test_retro_department_revoke_blocks_effective_duty(api):
    _dept_with_duty(api)
    p = _problem(
        api,
        dept_item("change_lifecycle", code="D", effective_date="2023-01-01", lifecycle="REVOKED"),
    )
    assert "部门退出日 2023-01-01 之后" in p["message"]
    assert "张伟（P000001）的代管职务（2024-01-01 起）" in p["message"]
    assert duties(api, dept_id(api, "D"), "2024-06-01") == [("代管", "张伟")]


def test_retro_reorganize_blocks_effective_duty(api):
    _dept_with_duty(api)
    p = _problem(api, reorganize("ABSORB", "2023-01-01", ["D"], ["E"]))
    assert "代管职务（2024-01-01 起）" in p["message"]


def test_department_exit_cancels_future_duty_plan(api):
    """退出日之后才开始、尚未生效的职务计划照常撤销；退出日前已生效的职务止于前一日。"""
    eid = _base(api)
    api.apply(dept_create(code="D", name="丁科"), dept_create(code="E", name="戊科"))
    api.apply(
        duty_assign(eid, "D", "HEAD", "CARETAKER", "2024-01-01", days(20)),
        duty_assign(eid, "D", "DEPUTY", "FORMAL", days(60)),
    )
    exit_day = days(40)
    api.apply(reorganize("ABSORB", exit_day, ["D"], ["E"]))
    rows = person(api, "P000001")["engagements"][0]["duties"]
    assert [(r["label"], r["void"]) for r in rows] == [("代管", False), ("副部长", True)]
