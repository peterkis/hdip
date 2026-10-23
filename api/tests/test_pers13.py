"""PERS-13：部门负责人与职务（按院内实际）：
- 医务部部长甲交给乙：旧日期甲、新日期乙，部门身份不变；
- 部长在任时可由他人主持工作（外出学习、派驻期间），两者并存，负责人显示主持工作者；
- 院感部空缺期间副部长丙主持工作（“副部长（主持工作）”= 副部长 + 主持工作两条）；之后由乙代管；
- 同一部门同一天第二位正式部长、第二位主持工作者被拒；
- 乙的任用结束后职务随之结束；部门退出时职务自动结束；不产生账号。"""

from factories import (
    dept_create,
    duty_assign,
    duty_handover,
    engagement_end,
    register,
    world,
)
from person_helpers import days, dept_id, duties, engagement_id, notices, person
from reorg_helpers import reorganize
from sqlalchemy import text


def _setup(api):
    api.apply(
        *world(),
        dept_create(code="YWB", name="医务部"),
        dept_create(code="YGB", name="院感部"),
        dept_create(code="XNK", name="心血管内科"),
    )
    for code, name, dept in [
        ("P000001", "甲", "YWB"),
        ("P000002", "乙", "YWB"),
        ("P000003", "丙", "YGB"),
        ("P000004", "丁", "YWB"),
    ]:
        api.apply(*register(code, name, dept, "2020-01-01"))
    return {c: engagement_id(api, c) for c in ("P000001", "P000002", "P000003", "P000004")}


def test_pers13_handover_and_presiding(api, owner_engine):
    with owner_engine.connect() as c:
        users = c.scalar(text("SELECT count(*) FROM app_user"))
    e = _setup(api)
    ywb, ygb = dept_id(api, "YWB"), dept_id(api, "YGB")
    dept_before = api.get(f"/api/departments/{ywb}").json()

    api.apply(duty_assign(e["P000001"], "YWB", valid_from="2020-01-01"))
    head = api.get(f"/api/departments/{ywb}/duties", params={"as_of": "2025-01-01"}).json()[0]
    api.apply(duty_handover(head["duty_id"], e["P000002"], "2026-01-01"))
    assert duties(api, ywb, "2025-12-31") == [("部长", "甲")]
    assert duties(api, ywb, "2026-01-01") == [("部长", "乙")]
    assert api.get(f"/api/departments/{ywb}").json()["code"] == dept_before["code"]

    # 部长乙外出学习期间丁主持工作：并存
    cr = api.draft(duty_assign(e["P000004"], "YWB", "HEAD", "ACTING", "2026-03-01", "2026-08-31"))
    assert any("部长乙（P000002）在任" in n for n in notices(cr))
    api.submit(cr["id"])
    api.confirm(cr["id"])
    assert set(duties(api, ywb, "2026-05-01")) == {("部长", "乙"), ("主持工作", "丁")}
    # 同一天第二位正式部长、第二位主持工作者被拒
    for item, holder in (
        (duty_assign(e["P000001"], "YWB", "HEAD", "FORMAL", "2026-05-01"), "正式部长乙（P000002）"),
        (
            duty_assign(e["P000001"], "YWB", "HEAD", "ACTING", "2026-05-01", "2026-05-31"),
            "主持工作的人（代理或代管）丁（P000004）",
        ),
    ):
        cr = api.draft(item)
        r = api.submit(cr["id"])
        assert r.status_code == 422 and holder in r.json()["problems"][0]["message"]
        api.cancel(cr["id"])

    # 院感部：空缺期间副部长丙主持工作，之后乙代管（乙的主部门仍是医务部）
    api.apply(
        duty_assign(e["P000003"], "YGB", "DEPUTY", "FORMAL", "2025-01-01"),
        duty_assign(e["P000003"], "YGB", "HEAD", "ACTING", "2025-01-01", "2025-12-31"),
        duty_assign(e["P000002"], "YGB", "HEAD", "CARETAKER", "2026-01-01"),
    )
    assert set(duties(api, ygb, "2025-06-01")) == {("主持工作", "丙"), ("副部长", "丙")}
    assert set(duties(api, ygb, "2026-06-01")) == {("代管", "乙"), ("副部长", "丙")}
    yi = person(api, "P000002", "2026-06-01")
    assert yi["engagements"][0]["assignments"][0]["department"]["code"] == "YWB"
    assert {d["label"] for d in yi["engagements"][0]["duties"]} == {"部长", "代管"}

    # 乙的任用结束：职务随之结束，之后不再显示为负责人
    end = days(400)
    api.apply(engagement_end(e["P000002"], end))
    later = days(401)
    assert ("部长", "乙") not in duties(api, ywb, later)
    assert ("代管", "乙") not in duties(api, ygb, later)

    with owner_engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM app_user")) == users


def test_pers13_non_member_duty_notice_and_department_exit(api):
    e = _setup(api)
    cr = api.draft(duty_assign(e["P000003"], "XNK", "DEPUTY", "FORMAL", "2025-01-01"))
    assert any("此人不归属心血管内科" in n for n in notices(cr))
    api.submit(cr["id"])
    api.confirm(cr["id"])
    # 部门被替代：职务自动结束（不阻止），预演里列出
    cr = api.draft(reorganize("ABSORB", "2030-01-01", ["XNK"], ["YWB"]))
    r = api.submit(cr["id"])
    assert r.status_code == 200, r.text
    after = next(o["after"] for o in r.json()["outcomes"] if o["kind"] == "department.reorganize")
    assert "职务 副部长：丙（P000003）" in str(after)
    api.confirm(cr["id"])
    assert duties(api, dept_id(api, "XNK"), "2030-01-01") == []
    assert duties(api, dept_id(api, "XNK"), "2029-12-31") == [("副部长", "丙")]
