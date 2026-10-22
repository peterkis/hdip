"""PERS-06：登记时已填结束日的任用，结束日到达前可以提前、推后、清空，
归属按选择随之调整，任用 id 不变；
结束日过去后再改被拒；再次任用产生新任用 id，人员与代码不变，可沿用本人原工号。"""

from factories import dept_create, engage, engagement_end, register, world
from person_helpers import assignment_ids, days, engagement_id, notices, person, roster


def test_pers06_adjust_future_end(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    end = days(100)
    api.apply(
        *register("P000001", "王芳", "A", "2025-01-01", type_="REHIRE", valid_to=end, work_no="R01")
    )
    eid = engagement_id(api, "P000001")

    later = days(200)
    api.apply(engagement_end(eid, later, expected=end))
    d = person(api, "P000001")
    [e] = d["engagements"]
    assert (e["id"], e["valid_to"]) == (eid, later)
    assert e["assignments"][0]["valid_to"] == later and e["work_nos"][0]["valid_to"] == later

    # 推后但归属不跟着延长：提示暂未分配
    cr = api.draft(engagement_end(eid, days(300), expected=later, extend_assignments=False))
    assert any("暂未分配" in n for n in notices(cr))
    api.cancel(cr["id"])

    # 提前
    api.apply(engagement_end(eid, days(50), expected=later))
    assert [t for _, _, _, t in assignment_ids(person(api, "P000001"))] == [days(50)]
    # 清空（撤回结束日）
    api.apply(engagement_end(eid, None, expected=days(50)))
    [e] = person(api, "P000001")["engagements"]
    assert e["valid_to"] is None and e["assignments"][0]["valid_to"] is None
    # 过期草稿：按旧结束日发起的被拒
    cr = api.draft(engagement_end(eid, days(70), expected=days(50)))
    assert "与发起时看到的不同" in api.submit(cr["id"]).json()["problems"][0]["message"]


def test_pers06_passed_end_is_final_and_rehire_is_new_engagement(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    api.apply(
        *register("P000001", "王芳", "A", "2020-01-01", valid_to="2022-12-31", work_no="0007")
    )
    old = engagement_id(api, "P000001")
    cr = api.draft(engagement_end(old, "2023-06-30", expected="2022-12-31"))
    p = api.submit(cr["id"]).json()["problems"][0]
    assert "已于 2022-12-31 结束" in p["message"] and "再次任用" in p["hint"]
    api.cancel(cr["id"])

    api.apply(engage("P000001", "B", "2024-03-01", type_="REHIRE", work_no="0007"))
    d = person(api, "P000001")
    ids = [e["id"] for e in d["engagements"]]
    assert len(ids) == 2 and old in ids and d["code"] == "P000001"
    assert roster(api, "2024-03-01")[0]["engagements"][0]["department"]["code"] == "B"
    assert (
        roster(api, "2023-01-01", status="PLANNED")[0]["code"] == "P000001"
    )  # 离开期间：仅有计划任用
