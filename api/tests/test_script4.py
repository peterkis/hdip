"""剧本 4：单元暂停再恢复；永久退出后试图复用其代码被拒。"""

from factories import dept_create, unit_create, unit_item, world


def test_script4_suspend_resume_retire_and_code_not_reused(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    api.apply(unit_item("change_status", "U1", "2026-11-10", status="SUSPENDED"))
    api.apply(unit_item("change_status", "U1", "2026-11-20", status="ACTIVE"))

    def status_on(day):
        rows = api.get("/api/service-units", params={"as_of": day}).json()
        return rows[0]["version"]["status"] if rows else None

    assert status_on("2026-11-09") == "ACTIVE"
    assert status_on("2026-11-15") == "SUSPENDED"
    assert status_on("2026-11-20") == "ACTIVE"

    api.apply({"kind": "service_unit.retire", "code": "U1", "valid_to": "2026-12-31"})
    assert status_on("2026-12-31") == "ACTIVE"  # 最后有效日当天仍有效
    assert status_on("2027-01-01") is None
    unit_id = api.get("/api/service-units", params={"as_of": "2026-12-31"}).json()[0]["id"]
    assert api.get(f"/api/service-units/{unit_id}").json()["retired_after"] == "2026-12-31"

    # 退出是终态
    cr = api.draft(unit_item("change_status", "U1", "2027-02-01", status="SUSPENDED"))
    assert "永久退出" in api.submit(cr["id"]).json()["message"]
    # 代码永不复用
    cr = api.draft(unit_create(code="U1", name="新单元", valid_from="2027-01-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "代码永不复用" in r.json()["message"]
