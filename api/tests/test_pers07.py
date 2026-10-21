"""PERS-07：部门撤销 / 被替代时，当前与未来流入的人员归属都在承接清单里，未处置阻止确认；
在同一张组织变更申请里把人调到承接部门后整单成功。部门更名不迁人。"""

from factories import dept_create, dept_item, register, transfer, world
from person_helpers import assignment_ids, person
from reorg_helpers import dept, problem, reorganize

T = "2030-01-01"


def _before(api):
    api.apply(
        *world(),
        dept_create(code="A", name="甲科"),
        dept_create(code="B", name="乙科"),
        dept_create(code="C", name="丙科"),
    )
    api.apply(*register("P000001", "张伟", "B", "2020-01-01"))
    api.apply(*register("P000002", "赵敏", "A", "2020-01-01"))
    # 赵敏已预约 2030-03-01 调入乙科
    [(aid, _, _, _)] = assignment_ids(person(api, "P000002"))
    api.apply(transfer(aid, "B", "2030-03-01"))


def test_pers07_exit_lists_current_and_future_persons(api):
    _before(api)
    deps = api.get(f"/api/departments/{dept(api, 'B', T)['id']}/dependencies", params={"day": T})
    rows = {p["person_code"]: p for p in deps.json()["persons"]}
    assert set(rows) == {"P000001", "P000002"}
    assert rows["P000001"]["not_yet_effective"] is False
    assert rows["P000002"]["not_yet_effective"] is True
    assert rows["P000002"]["valid_from"] == "2030-03-01"

    # 不处置：阻止确认，两个人都列出
    cr = api.draft(reorganize("ABSORB", T, ["B"], ["C"]))
    p = api.submit(cr["id"]).json()["problems"]
    msg = " ".join(x["message"] for x in p)
    assert "张伟" in msg and "赵敏" in msg and "2 条人员归属" in msg
    api.cancel(cr["id"])

    # 撤销（变更生命周期）同样阻止
    cr = api.draft(dept_item("change_lifecycle", code="B", effective_date=T, lifecycle="REVOKED"))
    assert "人员归属" in problem(api.submit(cr["id"]))
    api.cancel(cr["id"])

    # 同一张申请里明确承接：张伟自 T 调丙科；赵敏的预约改为调入丙科（在预约开始日更正）
    zhang = rows["P000001"]
    zhao = rows["P000002"]
    api.apply(
        reorganize("ABSORB", T, ["B"], ["C"]),
        transfer(zhang["assignment_id"], "C", T, zhang["valid_to"]),
        transfer(zhao["assignment_id"], "C", "2030-03-01", zhao["valid_to"]),
    )
    on = lambda code, day: [  # noqa: E731
        (d, f, t) for _, d, f, t in assignment_ids(person(api, code, day))
    ]
    assert on("P000001", T) == [("B", "2020-01-01", "2029-12-31"), ("C", T, None)]
    assert on("P000002", T) == [("A", "2020-01-01", "2030-02-28"), ("C", "2030-03-01", None)]


def test_pers07_rename_does_not_move_people(api):
    api.apply(*world(), dept_create(code="A", name="甲科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    api.apply(dept_item("revise", code="A", effective_date=T, changes={"name": "甲一科"}))
    before = person(api, "P000001", "2029-12-31")["engagements"][0]["assignments"]
    after = person(api, "P000001", T)["engagements"][0]["assignments"]
    assert [a["id"] for a in before] == [a["id"] for a in after]
    assert before[0]["department"]["name"] == "甲科"
    assert after[0]["department"]["name"] == "甲一科"


def test_pers07_late_transfer_into_exited_department_is_rejected(api):
    """两张申请都已提交：先确认部门退出，再确认调入——后者在确认时重新检查，被拒，不留悬空归属。"""
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))
    api.apply(dept_create(code="C", name="丙科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    move = api.draft(transfer(aid, "B", "2030-02-01"))
    assert api.submit(move["id"]).status_code == 200
    api.apply(reorganize("ABSORB", T, ["B"], ["C"]))
    r = api.confirm(move["id"])
    assert r.status_code == 422
    assert "被替代" in r.json()["message"]
    assert [d for _, d, _, _ in assignment_ids(person(api, "P000001"))] == ["A"]
