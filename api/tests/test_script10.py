"""剧本 10：部门更名：按旧日期查询显示旧名称；曾用名、别名都可检索。"""

from factories import dept_create, dept_item, unit_create, world


def test_script10_rename_keeps_identity_and_history(api):
    api.apply(*world())
    api.apply(dept_create(name="心内科", valid_from="1995-03-01"))
    api.apply(unit_create(code="XNK-BY-OPD", campus="BY", valid_from="2020-01-01"))
    api.apply(
        dept_item("revise", effective_date="2018-07-01",
                  changes={"name": "心血管内科", "short_name": "心内"}),
        dept_item("alias_add", alias_kind="ALIAS", value="心血管科", valid_from="2018-07-01"),
    )  # fmt: skip

    def name_on(day):
        rows = api.get("/api/departments", params={"as_of": day}).json()
        return rows[0]["version"]["name"]

    assert name_on("2017-06-30") == "心内科"
    assert name_on("2018-07-01") == "心血管内科"
    dept = api.get("/api/departments").json()[0]
    detail = api.get(f"/api/departments/{dept['id']}").json()
    assert [v["name"] for v in detail["versions"]] == ["心血管内科", "心内科"]
    assert [a["value"] for a in detail["aliases"]] == ["心血管科"]

    # 曾用名、别名、编码都能检索到同一个部门
    for q in ("心内科", "心血管科", "xnk"):
        found = api.get("/api/departments", params={"q": q}).json()
        assert [r["code"] for r in found] == ["XNK"], q

    # 服务单元按日期显示当时的部门名称（D1 解决了“历史日期显示当前名称”的局限）
    units_2018 = api.get(
        "/api/service-units", params={"as_of": "2018-01-01", "include_future": "false"}
    ).json()
    assert units_2018 == []  # 单元 2020 年才开始
    unit = api.get("/api/service-units", params={"as_of": "2020-06-01"}).json()[0]
    assert unit["version"]["department_name"] == "心血管内科"
