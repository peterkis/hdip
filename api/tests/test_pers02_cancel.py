"""PERS-02（撤销部分）：入职前撤销计划——任用与归属显示“生效前已撤销”，不产生倒置期间，
人员身份与代码保留；已生效的任用不能撤销，只能结束。"""

from datetime import date, timedelta

from factories import dept_create, engagement_end, register, world
from person_helpers import days, engagement_id, person, roster


def test_pers02_cancel_planned_engagement(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    start = days(30)
    api.apply(*register("P000001", "赵敏", "A", start, work_no="3001"))
    eid = engagement_id(api, "P000001")
    before = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    api.apply(engagement_end(eid, before))
    d = person(api, "P000001")
    [e] = d["engagements"]
    assert e["void"] and e["assignments"][0]["void"] and e["work_nos"][0]["void"]
    assert d["status"] == "NONE"
    assert roster(api, start, include_future=True) == []
    assert [r["code"] for r in roster(api, scope="all")] == ["P000001"]


def test_pers02_started_engagement_cannot_be_cancelled(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    eid = engagement_id(api, "P000001")
    cr = api.draft(engagement_end(eid, "2019-12-31"))
    assert "不能撤销，只能结束" in api.submit(cr["id"]).json()["problems"][0]["message"]
