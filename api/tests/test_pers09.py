"""PERS-09：同一任用重叠主归属被拒；归属越出任用被拒；落入部门撤销后被拒；
暂未分配提示并可补归属；部门暂停履职时既有归属保留，暂停期间调入只提示。"""

from factories import assign, dept_create, dept_item, register, transfer, world
from person_helpers import assignment_ids, engagement_id, notices, person, roster


def test_pers09_unassigned_then_assign(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    cr = api.draft(*register("P000001", "李娜", None, "2026-01-01"))
    cr["items"][1]["note"] = "待定岗"
    cr = api.put(f"/api/change-requests/{cr['id']}", {"items": cr["items"], "note": None}).json()
    assert "暂未分配主部门：待定岗" in notices(cr)
    api.submit(cr["id"])
    api.confirm(cr["id"])
    assert roster(api, "2026-02-01")[0]["engagements"][0]["department"] is None

    eid = engagement_id(api, "P000001")
    api.apply(assign(eid, "A", "2026-03-01"))
    assert roster(api, "2026-02-28")[0]["engagements"][0]["department"] is None
    assert roster(api, "2026-03-01")[0]["engagements"][0]["department"]["code"] == "A"

    # 已有主部门的期间不能再补一个
    cr = api.draft(assign(eid, "A", "2026-06-01"))
    p = api.submit(cr["id"]).json()["problems"][0]
    assert "同一时期只能有一个主部门" in p["message"]


def test_pers09_assignment_cannot_outlive_engagement(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    api.apply(*register("P000001", "王芳", None, "2025-01-01", valid_to="2027-06-30"))
    eid = engagement_id(api, "P000001")
    cr = api.draft(assign(eid, "A", "2025-01-01", "2028-12-31"))
    assert "超出了任用期间" in api.submit(cr["id"]).json()["problems"][0]["message"]
    api.cancel(cr["id"])
    # 不写结束日：到任用结束为止
    api.apply(assign(eid, "A", "2025-01-01"))
    [(_, _, _, end)] = assignment_ids(person(api, "P000001"))
    assert end == "2027-06-30"


def test_pers09_suspended_department_keeps_people_and_only_notices(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="S", name="暂停科"))
    api.apply(*register("P000001", "张伟", "S", "2020-01-01"))
    api.apply(*register("P000002", "刘洋", "A", "2020-01-01"))
    # 部门暂停履职：已有的人员归属不阻止，也不结束任用
    api.apply(
        dept_item("change_lifecycle", code="S", effective_date="2026-01-01", lifecycle="SUSPENDED")
    )
    assert roster(api, "2026-02-01", q="张伟")[0]["engagements"][0]["department"]["code"] == "S"
    # 暂停期间调入：只提示
    [(aid, _, _, _)] = assignment_ids(person(api, "P000002"))
    cr = api.draft(transfer(aid, "S", "2026-03-01"))
    assert any("暂停履职" in n for n in notices(cr))
    assert api.submit(cr["id"]).status_code == 200
    assert api.confirm(cr["id"]).status_code == 200


def test_pers09_same_name_notice(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    cr = api.draft(*register("P000002", "张伟", "A", "2021-01-01"))
    assert any("已有 1 位同名人员：张伟（P000001）" in n for n in notices(cr))
