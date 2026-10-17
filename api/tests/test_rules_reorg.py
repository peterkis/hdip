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
