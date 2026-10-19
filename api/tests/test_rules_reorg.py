"""部门组织变更的反例。"""

from factories import dept_create, dept_item, ext_assign, ext_register, setup_ledger, world
from reorg_helpers import problem, reorganize

T = "2027-01-01"


def test_superseded_cannot_be_set_by_hand(api):
    api.apply(dept_create())
    r = api.post(
        "/api/change-requests",
        {"items": [dept_item("change_lifecycle", effective_date=T, lifecycle="SUPERSEDED")]},
    )
    assert r.status_code == 422


def test_new_result_must_be_created_in_the_same_request(api):
    api.apply(
        dept_create(code="A", name="甲科"),
        dept_create(code="B", name="乙科"),
        dept_create(code="C", name="丙科"),
    )
    cr = api.draft(reorganize("SPLIT", T, ["A"], ["B", "C"]))
    assert "须在本申请里新建" in problem(api.submit(cr["id"]))


def test_shape_follows_event_type(api):
    r = api.post("/api/change-requests", {"items": [reorganize("MERGE", T, ["A"], ["B"])]})
    assert r.status_code == 422
    assert "至少 2 个原部门" in r.text


def test_basis_required(api):
    r = api.post(
        "/api/change-requests", {"items": [reorganize("ABSORB", T, ["A"], ["B"], basis=" ")]}
    )
    assert r.status_code == 422


def test_exited_department_keeps_no_open_code_and_cannot_get_new_ones(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    setup_ledger(api)
    api.apply(ext_register("D1", "甲科"), ext_assign("D1", "2020-01-01", department_code="A"))
    # 未结束指向退出部门的解释：不能确认
    cr = api.draft(reorganize("ABSORB", T, ["A"], ["B"]))
    assert "外部编码解释指向它" in problem(api.submit(cr["id"]))
    # 退出后不能再把代码解释到它（只能另行解释到承接部门）
    a_id = api.get("/api/departments", params={"as_of": "2026-12-01"}).json()
    a_id = next(d["id"] for d in a_id if d["code"] == "A")
    link = api.get(f"/api/departments/{a_id}", params={"as_of": "2026-12-01"}).json()[
        "external_codes"
    ][0]
    api.apply(
        reorganize("ABSORB", T, ["A"], ["B"]),
        {
            "kind": "external_code.assignment_close",
            "assignment_id": link["assignment_id"],
            "valid_to": "2026-12-31",
        },
    )
    # 退出后不能再把代码解释到它；外部系统重新分配时只能解释到承接部门
    cr = api.draft(ext_assign("D1", T, department_code="A"))
    assert "已退出" in problem(api.submit(cr["id"]))
    api.apply(ext_assign("D1", T, department_code="B", evidence_note="HIS 重新分配记录（模拟）"))


def test_planned_unit_in_reorganization(api):
    """组织变更生效日之后才开始的单元：改挂在它的开始日直接更正那一版；或取消计划（从未生效）。"""
    from factories import unit_create, unit_item

    api.apply(
        *world(),
        dept_create(code="A", name="甲科"),
        unit_create(code="P1", name="甲科高新门诊", dept="A", campus="GX", valid_from="2030-03-01"),
        unit_create(
            code="P2",
            name="甲科高新病房",
            unit_type="IPD",
            dept="A",
            campus="GX",
            valid_from="2030-03-01",
        ),
    )
    day = "2030-01-01"
    # 早于单元开始日退出：拒绝，并给出怎么改
    cr = api.draft(
        dept_create(code="B", name="乙科", valid_from=day),
        dept_create(code="C", name="丙科", valid_from=day),
        reorganize("SPLIT", day, ["A"], ["B", "C"]),
        unit_item("change_department", "P1", "2030-03-01", department_code="B"),
        {"kind": "service_unit.retire", "code": "P2", "valid_to": "2029-12-31"},
    )
    r = api.submit(cr["id"])
    p = next(x for x in r.json()["problems"] if x["item_index"] == 4)
    assert "不能在开始之前退出" in p["message"] and "2030-02-28" in p["hint"]
    assert [f["tone"] for f in p["facts"]] == ["info", "bad"]

    api.apply(
        dept_create(code="B", name="乙科", valid_from=day),
        dept_create(code="C", name="丙科", valid_from=day),
        reorganize("SPLIT", day, ["A"], ["B", "C"]),
        unit_item("change_department", "P1", "2030-03-01", department_code="B"),
        {"kind": "service_unit.retire", "code": "P2", "valid_to": "2030-02-28"},  # 取消计划
    )
    units = {
        u["code"]: u for u in api.get("/api/service-units", params={"as_of": "2030-03-01"}).json()
    }
    assert units["P1"]["version"]["department_code"] == "B"
    assert "P2" not in units


def test_preview_lists_all_problems_and_keeps_passing_outcomes(api):
    """预演逐项试算：两处问题一次列出，通过的项仍有前后内容；每项有带名称的一句话说明。"""
    api.apply(dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    cr = api.draft(
        dept_item("revise", "A", effective_date="2019-01-01", changes={"name": "甲科二"}),
        dept_item("revise", "B", effective_date="2026-12-01", changes={"name": "乙科新"}),
        dept_item("revise", "B", effective_date="2019-01-01", changes={"name": "乙科三"}),
    )
    d = api.get(f"/api/change-requests/{cr['id']}").json()
    assert [p["item_index"] for p in d["problems"]] == [0, 2]
    assert [o["index"] for o in d["outcomes"]] == [1]
    assert d["item_summaries"][1] == "部门“乙科”更名为“乙科新”，自 2026-12-01 起"


def test_reorganization_draft_cannot_lose_its_event(api):
    """含组织变更事件的草稿，更新时不能去掉事件而保留其他项（防止原子变更被拆散）。"""
    api.apply(dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    items = [
        reorganize("ABSORB", T, ["A"], ["B"]),
        dept_item("revise", "B", effective_date=T, changes={"name": "乙科新"}),
    ]
    cr = api.draft(*items)
    r = api.put(f"/api/change-requests/{cr['id']}", {"items": items[1:], "note": None})
    assert r.status_code == 422 and "组织变更" in r.json()["message"]
    # 整体替换（仍含事件）可以
    r = api.put(f"/api/change-requests/{cr['id']}", {"items": items[:1], "note": None})
    assert r.status_code == 200
