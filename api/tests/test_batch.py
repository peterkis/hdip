"""批量操作：待裁决代码的候选（按源名称）与一张申请里的批量变更。

候选只是建议：名称相同 > 别名 / 简称 > 曾用名 > 源名称包含对象名称 > 名称相近；
已映射的代码不给候选。
批量变更就是一张申请里的多个变更项：整体确认，任何一项不通过则整张不能提交，并指出是第几项。
"""

from factories import (
    classify,
    dept_create,
    dept_item,
    ext_assign,
    ext_register,
    setup_ledger,
    unit_create,
    world,
)

DAY = "2026-12-01"


def _suggest(api):
    page = api.get(
        "/api/external-codes", params={"as_of": DAY, "status": "pending", "suggest": True}
    ).json()
    return {
        r["code"]: [(s["target_type"], s["code"], s["match"]) for s in r["suggestions"]]
        for r in page["rows"]
    }


def test_suggestions_by_source_name(api):
    api.apply(
        *world(),
        dept_create(code="XNK", name="心内科", short_name="心内"),
        dept_create(code="NFM", name="内分泌代谢病科"),
        dept_create(code="FSK", name="放射科"),
        dept_item("alias_add", "FSK", value="影像科"),
        unit_create(
            code="XNK-MZ", name="心内科门诊", dept="XNK", campus="BY", valid_from="2020-01-01"
        ),
    )
    api.apply(
        dept_item("revise", "XNK", effective_date="2026-01-01", changes={"name": "心血管内科"})
    )
    setup_ledger(api)
    api.apply(
        ext_register("A1", "心血管内科"),
        ext_register("A2", "心内科门诊"),
        ext_register("A3", "影像科"),
        ext_register("A4", "心内科"),
        ext_register("A5", "心内科门诊专家"),
        ext_register("A6", "内分泌科专家"),
        ext_register("A7", "收费处"),
        ext_register("A8", "放射科"),
        ext_assign("A8", "2020-01-01", department_code="FSK"),
    )
    got = _suggest(api)
    assert got["A1"] == [("department", "XNK", "exact")]
    assert got["A2"] == [("service_unit", "XNK-MZ", "exact")]
    assert got["A3"] == [("department", "FSK", "alias")]
    assert got["A4"] == [("department", "XNK", "former_name")]
    # 包含：先取最长的名称（单元“心内科门诊”），简称“心内”不参与包含匹配
    assert got["A5"][0] == ("service_unit", "XNK-MZ", "contains")
    assert got["A6"] == [("department", "NFM", "similar")]
    assert got["A7"] == []
    assert "A8" not in got  # 已映射，不在待裁决里

    # 不要求候选时不计算
    plain = api.get("/api/external-codes", params={"as_of": DAY, "status": "pending"}).json()
    assert all(r["suggestions"] == [] for r in plain["rows"])


def test_batch_assign_is_one_request_and_names_the_failing_item(api):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科", valid_from="2026-01-01"))
    setup_ledger(api)
    api.apply(*(ext_register(f"B{i}", f"心内专家{i}") for i in range(5)))
    items = [ext_assign(f"B{i}", "2026-02-01", department_code="XNK") for i in range(5)]
    items[3] = ext_assign("B3", "2025-01-01", department_code="XNK")  # 早于部门设立日
    cr = api.draft(*items, note="批量裁决外部代码 5 条")
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert r.json()["message"].startswith("第 4 项")
    assert [p["item_index"] for p in r.json()["problems"]] == [3]

    items[3] = ext_assign("B3", "2026-02-01", department_code="XNK")
    api.apply(*items)
    page = api.get("/api/external-codes", params={"as_of": DAY, "status": "mapped"}).json()
    assert page["total"] == 5


def test_batch_classify_and_parent_in_one_request(api):
    api.apply(
        *(
            dept_create(code=c, name=n)
            for c, n in [("A", "甲科"), ("B", "乙科"), ("C", "丙科"), ("P", "上级部")]
        )
    )
    api.apply(
        *(classify(c, "CLINICAL", "2026-01-01") for c in "ABC"),
        *(
            dept_item(
                "set_parent", c, view_code="ADMIN", parent_code="P", effective_date="2026-01-01"
            )
            for c in "AB"
        ),
    )
    rows = {r["code"]: r for r in api.get("/api/departments", params={"as_of": DAY}).json()}
    assert [rows[c]["main_class"]["code"] for c in "ABC"] == ["CLINICAL"] * 3
    assert rows["A"]["parent"]["code"] == "P" and rows["C"]["parent"] is None
