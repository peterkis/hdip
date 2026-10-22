"""PERS-05：最后有效日 E 结束任用——E 当天有效、E+1 无；跨 E 的归属止于 E，E 后才开始的计划撤销，
E 前已结束的不动；此人在其他主体的任用不受影响；确认时新出现的计划也一并处理。"""

from datetime import date, timedelta

from factories import (
    dept_create,
    engage,
    engagement_end,
    inst_create,
    register,
    transfer,
    world,
)
from person_helpers import assignment_ids, days, engagement_id, notices, person, roster


def _next(day: str) -> str:
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat()


def test_pers05_end_engagement(api):
    api.apply(
        *world(),
        inst_create(code="ZX2", name="成都市中心医院（模拟）"),
        dept_create(code="A", name="甲科"),
        dept_create(code="B", name="乙科"),
        dept_create(code="C", name="丙科"),
    )
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", work_no="0007"))
    api.apply(engage("P000001", "A", "2024-01-01", inst="ZX2"))  # 另一主体的任用
    eid = next(
        e["id"] for e in person(api, "P000001")["engagements"] if e["institution_code"] == "CD3"
    )
    [(a1, _, _, _)] = [x for x in assignment_ids(person(api, "P000001")) if x[2] == "2020-01-01"]
    api.apply(transfer(a1, "B", "2025-01-01"))  # 甲科止于 2024-12-31
    end = days(60)
    b = next(x for x in assignment_ids(person(api, "P000001")) if x[1] == "B")
    api.apply(transfer(b[0], "C", days(90)))  # E 之后才开始的计划

    cr = api.draft(engagement_end(eid, end))
    assert api.submit(cr["id"]).status_code == 200
    # 提交后又预约了一次调科（E 前）：确认时同样按最新数据处理，不留越界归属
    c = next(x for x in assignment_ids(person(api, "P000001")) if x[1] == "C")
    assert c[2] == days(90)
    r = api.confirm(cr["id"])
    assert r.status_code == 200, r.text
    assert any("止于" in n for n in notices(r.json()))

    rows = [(d, f, t) for _, d, f, t in assignment_ids(person(api, "P000001"))]
    assert ("A", "2020-01-01", "2024-12-31") in rows  # 早已结束的不动
    assert ("B", "2025-01-01", end) in rows  # 跨 E 的止于 E
    assert all(d != "C" for d, _, _ in rows)  # E 后的计划撤销（空期间不列出）
    assert ("A", "2024-01-01", None) in rows  # 另一主体的任用与归属不受影响

    on_end = roster(api, end)[0]
    assert {e["institution_name"] for e in on_end["engagements"]} == {
        "成都市第三人民医院",
        "成都市中心医院（模拟）",
    }
    after = roster(api, _next(end))[0]
    assert [e["institution_name"] for e in after["engagements"]] == ["成都市中心医院（模拟）"]
    work = person(api, "P000001")["engagements"]
    cd3 = next(e for e in work if e["institution_code"] == "CD3")
    assert cd3["valid_to"] == end and cd3["work_nos"][0]["valid_to"] == end


def test_pers05_ended_in_past_can_be_recorded_late(api):
    """迟报：结束日填过去的日期也可以（原来没有结束日）。"""
    api.apply(*world(), dept_create(code="A", name="甲科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    eid = engagement_id(api, "P000001")
    api.apply(engagement_end(eid, "2025-06-30"))
    assert roster(api, "2025-06-30")[0]["status"] == "ENGAGED"
    assert roster(api, "2025-07-01", status="NONE")[0]["code"] == "P000001"
