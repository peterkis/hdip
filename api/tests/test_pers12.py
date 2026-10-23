"""PERS-12：一项主归属与一项附加归属并存；结束附加归属不影响主归属；调科不带走附加归属；
主部门与附加归属不能是同一部门；部门人数按人去重；部门退出时附加归属同样要处置。"""

from factories import assign, assignment_end, dept_create, register, transfer, world
from person_helpers import assignment_ids, dept_id, engagement_id, person, roster
from reorg_helpers import reorganize


def _rows(api, code, day=None):
    d = person(api, code, day)
    return [
        (a["kind"], a["department"]["code"], a["valid_from"], a["valid_to"])
        for e in d["engagements"]
        for a in e["assignments"]
        if not a["void"]
    ]


def test_pers12_primary_and_additional(api):
    api.apply(
        *world(),
        dept_create(code="A", name="心血管内科"),
        dept_create(code="B", name="医务部"),
        dept_create(code="C", name="内分泌科"),
    )
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    eid = engagement_id(api, "P000001")
    r = api.draft(assign(eid, "B", "2026-01-01") | {"assignment_kind": "ADDITIONAL"})
    assert r["item_summaries"][0].startswith("“张伟”附加归属“医务部”")
    api.submit(r["id"])
    api.confirm(r["id"])

    # 名册与导出只看主部门；部门人员区块两边都有，按人去重
    assert roster(api, "2026-01-01")[0]["engagements"][0]["department"]["code"] == "A"
    b = api.get(f"/api/departments/{dept_id(api, 'B')}/persons", params={"as_of": "2026-01-01"})
    assert [(p["person_code"], p["kind"]) for p in b.json()] == [("P000001", "ADDITIONAL")]

    # 主部门与附加归属不能是同一部门
    cr = api.draft(assign(eid, "A", "2026-02-01") | {"assignment_kind": "ADDITIONAL"})
    assert "不能是同一部门" in api.submit(cr["id"]).json()["problems"][0]["message"]
    api.cancel(cr["id"])

    # 调科不带走附加归属；调到附加归属所在的部门被拒
    primary = next(a for a in assignment_ids(person(api, "P000001")) if a[1] == "A")
    cr = api.draft(transfer(primary[0], "B", "2026-06-01"))
    assert "不能是同一部门" in api.submit(cr["id"]).json()["problems"][0]["message"]
    api.cancel(cr["id"])
    api.apply(transfer(primary[0], "C", "2026-06-01"))
    rows = _rows(api, "P000001")
    assert ("ADDITIONAL", "B", "2026-01-01", None) in rows
    assert ("PRIMARY", "C", "2026-06-01", None) in rows

    # 结束附加归属不影响主归属
    extra = next(a for a in assignment_ids(person(api, "P000001")) if a[1] == "B")
    api.apply(assignment_end(extra[0], "2026-12-31"))
    assert roster(api, "2027-01-01")[0]["engagements"][0]["department"]["code"] == "C"


def test_pers12_department_exit_counts_additional(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    api.apply(dept_create(code="C", name="丙科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    eid = engagement_id(api, "P000001")
    api.apply(assign(eid, "B", "2024-01-01") | {"assignment_kind": "ADDITIONAL"})
    cr = api.draft(reorganize("ABSORB", "2030-01-01", ["B"], ["C"]))
    msg = " ".join(p["message"] for p in api.submit(cr["id"]).json()["problems"])
    assert "张伟" in msg and "人员归属" in msg
