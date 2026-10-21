"""PERS-03：更名与更正误录分开标记；代码不变；旧日期显示旧姓名；曾用名、误录值都能检索并标出；
实习转正换工号，旧号仍能找到此人；申请退回后复制为新草稿再确认，代码沿用。"""

from factories import change_work_no, dept_create, person_revise, register, world
from person_helpers import days, engagement_id, person, roster


def test_pers03_rename_keeps_identity(api):
    api.apply(*world(), dept_create())
    api.apply(*register("P000001", "张伟", "XNK", "2020-01-01"))
    api.apply(person_revise("P000001", "张为", "2025-01-01"))

    assert person(api, "P000001", "2024-12-31")["name"] == "张伟"
    d = person(api, "P000001", "2025-01-01")
    assert (d["code"], d["name"], d["pinyin"]) == ("P000001", "张为", "ZW")
    assert [v["revise_reason"] for v in d["versions"]] == ["RENAME", "INITIAL"]
    [hit] = roster(api, q="张伟", scope="all")
    assert hit["code"] == "P000001" and hit["matched"].startswith("曾用名 张伟")


def test_pers03_correction_is_marked_as_typo(api):
    api.apply(*world(), dept_create())
    api.apply(*register("P000001", "李那", "XNK", "2020-01-01"))
    today = days(0)
    api.apply(person_revise("P000001", "李娜", today, reason="CORRECTION"))
    assert person(api, "P000001", "2024-01-01")["name"] == "李那"
    assert person(api, "P000001")["name"] == "李娜"
    [hit] = roster(api, q="李那", scope="all")
    assert hit["matched"].startswith("误录 李那")
    # 内容没变化的修订被拒
    cr = api.draft(person_revise("P000001", "李娜", days(10), reason="CORRECTION"))
    assert "内容没有变化" in api.submit(cr["id"]).json()["problems"][0]["message"]


def test_pers03_future_typo_is_corrected_in_place(api):
    """尚未入职的人：在开始日当天更正，不留误录期间（原版本为空期间）。"""
    api.apply(*world(), dept_create())
    start = days(30)
    api.apply(*register("P000001", "赵民", "XNK", start))
    api.apply(person_revise("P000001", "赵敏", start, reason="CORRECTION"))
    d = person(api, "P000001", start)
    assert d["name"] == "赵敏"
    assert [v["void"] for v in d["versions"]] == [False, True]


def test_pers03_intern_gets_new_work_no(api):
    api.apply(*world(), dept_create())
    api.apply(*register("P000001", "王芳", "XNK", "2024-07-01", type_="INTERN", work_no="S001"))
    api.apply(*register("P000002", "刘洋", "XNK", "2020-01-01", work_no="1088"))
    eid = engagement_id(api, "P000001")

    # 别人的号不能用
    cr = api.draft(change_work_no(eid, "S001", "1088", "2025-07-01"))
    assert "已属于刘洋（P000002）" in api.submit(cr["id"]).json()["problems"][0]["message"]
    api.cancel(cr["id"])
    # 发起时看到的工号与现在不同：拒绝
    cr = api.draft(change_work_no(eid, "S999", "2001", "2025-07-01"))
    assert "与发起时看到的不同" in api.submit(cr["id"]).json()["problems"][0]["message"]
    api.cancel(cr["id"])

    api.apply(change_work_no(eid, "S001", "2001", "2025-07-01"))
    on = lambda day: roster(api, day, q="王芳")[0]["engagements"][0]["work_no"]  # noqa: E731
    assert on("2025-06-30") == "S001" and on("2025-07-01") == "2001"
    [hit] = roster(api, q="S001", scope="all")
    assert hit["code"] == "P000001" and hit["matched"].startswith("旧工号 S001")
    nos = person(api, "P000001")["engagements"][0]["work_nos"]
    assert [(n["work_no"], n["revise_reason"]) for n in nos] == [
        ("S001", "INITIAL"),
        ("2001", "CHANGE"),
    ]


def test_pers03_returned_request_copied_and_confirmed_keeps_code(api):
    api.apply(*world(), dept_create())
    cr = api.draft(*register("P000001", "孙磊", "XNK", "2020-01-01"))
    assert api.submit(cr["id"]).status_code == 200
    r = api.as_("confirmer").post(
        f"/api/change-requests/{cr['id']}/return", {"reason": "工号待人事确认"}
    )
    assert r.status_code == 200
    copy = api.post(f"/api/change-requests/{cr['id']}/copy").json()
    assert copy["items"][0]["code"] == "P000001"
    assert api.submit(copy["id"]).status_code == 200
    assert api.confirm(copy["id"]).status_code == 200
    assert [r["code"] for r in roster(api)] == ["P000001"]
