"""PERS-04：D 日调科——D−1 在原部门、D 在新部门，无重叠；目标部门无效时原状不变；
D 等于尚未开始的归属开始日时直接改为新部门（不产生倒置期间）；过期草稿不覆盖。"""

from factories import dept_create, dept_item, register, transfer, world
from person_helpers import assignment_ids, days, person, roster


def _base(api):
    api.apply(
        *world(),
        dept_create(code="A", name="神经内科"),
        dept_create(code="B", name="心血管内科"),
        dept_create(code="RV", name="已撤销科"),
    )
    api.apply(
        dept_item("change_lifecycle", code="RV", effective_date="2025-01-01", lifecycle="REVOKED")
    )


def test_pers04_transfer_on_day(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, end)] = assignment_ids(person(api, "P000001"))
    api.apply(transfer(aid, "B", "2026-01-01", end))
    dept = lambda day: roster(api, day)[0]["engagements"][0]["department"]["name"]  # noqa: E731
    assert dept("2025-12-31") == "神经内科" and dept("2026-01-01") == "心血管内科"
    rows = assignment_ids(person(api, "P000001"))
    assert [(d, f, t) for _, d, f, t in rows] == [
        ("A", "2020-01-01", "2025-12-31"),
        ("B", "2026-01-01", None),
    ]


def test_pers04_invalid_target_leaves_everything_unchanged(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    cr = api.draft(transfer(aid, "RV", "2026-01-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422 and "撤销" in r.json()["problems"][0]["message"]
    api.cancel(cr["id"])
    assert [(d, t) for _, d, _, t in assignment_ids(person(api, "P000001"))] == [("A", None)]


def test_pers04_transfer_on_start_day_of_planned_assignment(api):
    _base(api)
    start = days(20)
    api.apply(*register("P000001", "赵敏", "A", start))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    api.apply(transfer(aid, "B", start))
    a = person(api, "P000001")["engagements"][0]["assignments"]
    assert [(x["department"]["code"], x["void"]) for x in a] == [("A", True), ("B", False)]
    assert roster(api, start)[0]["engagements"][0]["department"]["code"] == "B"
