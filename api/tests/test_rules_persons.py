"""人员规则的反例（人员设计第 3、5 节）。"""

import pytest
from factories import assignment_end, dept_create, engage, register, transfer, world
from person_helpers import assignment_ids, days, person, roster
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _base(api):
    api.apply(*world(), dept_create(code="A", name="甲科"), dept_create(code="B", name="乙科"))


def _submit_problem(api, *items):
    cr = api.draft(*items)
    r = api.submit(cr["id"])
    assert r.status_code == 422, r.text
    api.cancel(cr["id"])
    return r.json()["problems"]


def test_overlapping_engagement_in_same_institution_is_rejected(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [p] = _submit_problem(api, engage("P000001", "B", "2025-01-01"))
    assert "重叠" in p["message"]


def test_engagement_cannot_start_before_person_record(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", valid_to="2022-12-31"))
    [p] = _submit_problem(api, engage("P000001", "B", "2019-01-01", valid_to="2019-12-31"))
    assert "人员档案自 2020-01-01 起" in p["message"]


def test_work_no_belongs_to_one_person_forever(api):
    _base(api)
    api.apply(
        *register("P000001", "张伟", "A", "2020-01-01", valid_to="2022-12-31", work_no="0007")
    )
    # 张伟离开后，0007 也不能发给别人
    [p] = _submit_problem(api, *register("P000002", "赵敏", "A", "2024-01-01", work_no="0007"))
    assert "已属于张伟（P000001）" in p["message"]
    # 本人再次任用可沿用原号
    api.apply(engage("P000001", "B", "2024-01-01", work_no="0007"))
    hits = roster(api, q="0007", scope="all")
    assert [h["code"] for h in hits] == ["P000001"]


def test_assignment_must_fall_within_department_existence(api):
    api.apply(*world(), dept_create(code="N", name="新科", valid_from="2028-01-01"))
    [p] = _submit_problem(api, *register("P000001", "张伟", "N", "2027-01-01"))
    assert "2028-01-01 才设立" in p["message"]


def test_preparing_or_suspended_department_is_allowed(api):
    """筹备、暂停履职的部门可以有人员归属（P-6）。"""
    api.apply(*world(), dept_create(code="P", name="筹备科", lifecycle="PREPARING"))
    api.apply(*register("P000001", "张伟", "P", "2020-01-01"))
    d = person(api, "P000001")
    assert d["engagements"][0]["assignments"][0]["department_lifecycle"] == "PREPARING"


def test_transfer_with_stale_expected_end_is_rejected(api):
    _base(api)
    api.apply(dept_create(code="C", name="丙科"))
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    stale = api.draft(transfer(aid, "C", "2030-01-01"))
    api.apply(transfer(aid, "B", "2029-01-01"))  # 另一张申请先调走了
    assert api.submit(stale["id"]).status_code == 422
    assert "与发起时看到的不同" in api.submit(stale["id"]).json()["problems"][0]["message"]


def test_stale_end_message_without_change_id(api):
    """归属结束日随任用一起登记、没有单独的结束申请时，提示不写“申请 #None”（U3R-09，R08-2）。"""
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", valid_to="2030-12-31"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    [p] = _submit_problem(api, assignment_end(aid, "2029-12-31", expected=None))
    assert "#None" not in p["message"]
    assert "这条归属现在是最后有效日 2030-12-31，与发起时看到的不同" == p["message"]


def test_transfer_day_must_be_after_start_once_effective(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    [p] = _submit_problem(api, transfer(aid, "B", "2020-01-01"))
    assert "调科日须晚于这一天" in p["message"]


def test_started_assignment_cannot_be_cancelled_only_ended(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01"))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    [p] = _submit_problem(api, assignment_end(aid, "2019-12-31"))
    assert "不能撤销，只能结束" in p["message"]
    # 结束后为暂未分配
    api.apply(assignment_end(aid, "2025-12-31"))
    row = roster(api, "2026-01-01")[0]
    assert row["engagements"][0]["department"] is None


def test_planned_assignment_can_be_cancelled(api):
    _base(api)
    start = days(40)
    api.apply(*register("P000001", "张伟", "A", start))
    [(aid, _, _, _)] = assignment_ids(person(api, "P000001"))
    from datetime import date, timedelta

    before = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    api.apply(assignment_end(aid, before))
    a = person(api, "P000001")["engagements"][0]["assignments"][0]
    assert a["void"] is True


def test_assignment_cannot_outlive_engagement(api):
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", valid_to=days(100)))
    [(aid, _, end, _)] = [(a, d, t, f) for a, d, f, t in assignment_ids(person(api, "P000001"))]
    [p] = _submit_problem(api, assignment_end(aid, None, expected=end))
    assert "超出了任用期间" in p["message"]


def test_period_guard_allows_future_end_change_but_not_past(api, owner_engine):
    """数据库保护：结束日未到可以改，已过去不能改；端点不可改。组织表的“只写一次”保护不变。"""
    _base(api)
    api.apply(*register("P000001", "张伟", "A", "2020-01-01", valid_to=days(100)))
    api.apply(*register("P000002", "赵敏", "A", "2020-01-01", valid_to="2021-12-31"))
    cid = api.get("/api/change-requests").json()[0]["id"]
    with owner_engine.begin() as c:
        c.execute(
            text(
                "UPDATE person_engagement SET valid_to = valid_to + 30, closed_change_id = :c "
                "WHERE person_id = (SELECT id FROM person WHERE code = 'P000001')"
            ),
            {"c": cid},
        )
    for sql in (
        # 已过去的结束日
        "UPDATE person_engagement SET valid_to = '2022-06-30', closed_change_id = :c "
        "WHERE person_id = (SELECT id FROM person WHERE code = 'P000002')",
        # 改结束日不记申请
        "UPDATE person_engagement SET valid_to = valid_to + 1, closed_change_id = NULL "
        "WHERE person_id = (SELECT id FROM person WHERE code = 'P000001')",
        # 端点不可改
        "UPDATE person_assignment SET department_id = department_id + 1",
    ):
        with pytest.raises(DBAPIError):
            with owner_engine.begin() as c:
                c.execute(text(sql), {"c": cid})

    # 组织表仍是“结束日只写一次”：未来的结束日写上后也不能再改
    first = "(SELECT min(id) FROM operator_relation)"
    with owner_engine.begin() as c:
        c.execute(text(f"UPDATE operator_relation SET valid_to = '2040-01-01' WHERE id = {first}"))
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as c:
            c.execute(
                text(f"UPDATE operator_relation SET valid_to = '2041-01-01' WHERE id = {first}")
            )
