"""剧本 3：单元更名；再把一个单元从本部重新绑定到高新，身份不变。"""

from factories import dept_create, unit_create, unit_item, world


def test_script3_rename_then_rebind_keeps_identity(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="XNK-OPD", name="心内科门诊", campus="BY"))
    unit_id = api.get("/api/service-units", params={"as_of": "2026-11-01"}).json()[0]["id"]

    api.apply(unit_item("revise", "XNK-OPD", "2026-11-10", changes={"name": "心血管内科门诊"}))
    api.apply(unit_item("rebind", "XNK-OPD", "2026-12-01", campus_code="GX"))

    detail = api.get(f"/api/service-units/{unit_id}").json()
    assert detail["code"] == "XNK-OPD"
    got = [
        (v["version_no"], v["valid_from"], v["valid_to"], v["name"], v["campus_code"])
        for v in detail["versions"]
    ]
    assert got == [
        (3, "2026-12-01", None, "心血管内科门诊", "GX"),
        (2, "2026-11-10", "2026-11-30", "心血管内科门诊", "BY"),
        (1, "2026-11-01", "2026-11-09", "心内科门诊", "BY"),
    ]

    def on(day):
        rows = api.get("/api/service-units", params={"as_of": day}).json()
        return [(r["id"], r["version"]["name"], r["version"]["campus_code"]) for r in rows]

    assert on("2026-11-05") == [(unit_id, "心内科门诊", "BY")]
    assert on("2026-12-01") == [(unit_id, "心血管内科门诊", "GX")]


def test_rebind_needs_operate_relation_on_new_campus(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1", campus="BY"))
    cr = api.draft(unit_item("rebind", "U1", "2026-12-01", institution_code="OTHER"))
    assert "不存在" in api.submit(cr["id"]).json()["message"]

    api.apply(
        {
            "kind": "institution.create",
            "code": "OTHER",
            "valid_from": "2020-01-01",
            "fields": {"name": "另一主体"},
        }
    )
    cr = api.draft(unit_item("rebind", "U1", "2026-12-01", institution_code="OTHER"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "没有“运营”关系" in r.json()["message"]
