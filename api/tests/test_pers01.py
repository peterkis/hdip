"""PERS-01：新人登记为一张申请（人员 + 任用 + 主部门）；同名不合并；目标部门无效时整张不成立。"""

from factories import dept_create, dept_item, register, world
from person_helpers import person, roster


def test_pers01_register_new_person(api):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))

    cr = api.draft(*register("P000001", "张伟", "XNK", "2020-01-01", work_no="0007"))
    # 申请页：一句话说明用名称；任用并进“登记”那一行
    assert cr["item_summaries"] == [
        "登记人员“张伟”，自 2020-01-01 起",
        "“张伟”在成都市第三人民医院任用（合同（人事代理）），主部门“心血管内科”，"
        "工号 0007，自 2020-01-01 起",
    ]
    views = cr["item_views"]
    assert views[1]["covered_by"] == 0
    texts = [p["text"] for p in views[0]["parts"]]
    assert texts[:2] == ["张伟", "登记"] and "心血管内科" in texts and "· 工号 0007" in texts
    r = api.submit(cr["id"])
    assert r.status_code == 200, r.text
    # 确认前：正式数据里没有这个人
    assert roster(api, scope="all") == []
    r = api.confirm(cr["id"])
    assert r.status_code == 200, r.text

    [row] = roster(api)
    assert (row["code"], row["name"], row["status"]) == ("P000001", "张伟", "ENGAGED")
    [e] = row["engagements"]
    assert e["work_no"] == "0007"  # 前导零原样保留
    assert e["department"]["code"] == "XNK"
    d = person(api, "P000001")
    [eng] = d["engagements"]
    assert eng["engagement_type"] == "CONTRACT" and eng["valid_to"] is None
    assert [(a["department"]["code"], a["valid_from"]) for a in eng["assignments"]] == [
        ("XNK", "2020-01-01")
    ]
    assert d["versions"][0]["revise_reason"] == "INITIAL"
    assert d["pinyin"] == "ZW"

    # 第二个“张伟”：同名独立登记，不合并
    api.apply(*register("P000002", "张伟", "XNK", "2021-03-01"))
    hits = roster(api, q="张伟", scope="all")
    assert sorted(h["code"] for h in hits) == ["P000001", "P000002"]


def test_pers01_invalid_department_rolls_back_everything(api):
    api.apply(*world(), dept_create(code="RV", name="已撤销科"))
    api.apply(
        dept_item("change_lifecycle", code="RV", effective_date="2025-01-01", lifecycle="REVOKED")
    )

    cr = api.draft(*register("P000001", "李娜", "RV", "2026-01-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    [p] = r.json()["problems"]
    assert p["item_index"] == 1 and "撤销" in p["message"]
    api.cancel(cr["id"])
    assert roster(api, scope="all") == []


def test_pers01_person_code_must_be_reserved(api):
    api.apply(*world(), dept_create())
    r = api.strict().post(
        "/api/change-requests", {"items": register("P000099", "王芳", "XNK", "2020-01-01")}
    )
    cr = r.json()
    r = api.strict().submit(cr["id"])
    assert r.status_code == 422
    assert "不是系统分配的代码" in r.json()["problems"][0]["message"]
