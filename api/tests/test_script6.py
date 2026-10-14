"""剧本 6：把一个服务单元拆成两个。"""

from factories import dept_create, split, successor, unit_create, world


def test_script6_split_one_unit_into_two(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="XNK-GX-OPD", name="心内科高新门诊"))
    done = api.as_("maintainer").draft(
        split(
            "XNK-GX-OPD",
            "2027-01-01",
            successor("XNK-GX-OPD-GEN", "心内科高新普通门诊"),
            successor("XNK-GX-HF", "心衰门诊单元", campus="GX"),
        ),
        note="按院务会决定拆分",
    )
    assert api.as_("maintainer").submit(done["id"]).status_code == 200
    cr = api.as_("confirmer").confirm(done["id"]).json()
    assert cr["status"] == "confirmed"
    outcome = cr["outcomes"][0]
    assert [p["name"] for p in outcome["before"]["predecessors"]] == ["心内科高新门诊"]
    assert [x["name"] for x in outcome["after"]["successors"]] == [
        "心内科高新普通门诊",
        "心衰门诊单元",
    ]

    def codes(day):
        rows = api.get(
            "/api/service-units", params={"as_of": day, "include_future": "false"}
        ).json()
        return sorted(r["code"] for r in rows)

    assert codes("2026-12-31") == ["XNK-GX-OPD"]
    assert codes("2027-01-01") == ["XNK-GX-HF", "XNK-GX-OPD-GEN"]

    units = {
        r["code"]: r["id"]
        for r in api.get("/api/service-units", params={"as_of": "2027-01-01"}).json()
    }
    old_id = api.get(
        "/api/service-units", params={"as_of": "2026-12-31", "include_future": "false"}
    ).json()[0]["id"]
    old = api.get(f"/api/service-units/{old_id}").json()
    assert old["retired_after"] == "2026-12-31"
    assert sorted(s["successor_code"] for s in old["successors"]) == ["XNK-GX-HF", "XNK-GX-OPD-GEN"]
    assert {s["lineage_type"] for s in old["successors"]} == {"SPLIT"}

    new = api.get(f"/api/service-units/{units['XNK-GX-HF']}").json()
    # 后继是新身份，不继承前身历史
    assert new["id"] != old_id
    assert [v["version_no"] for v in new["versions"]] == [1]
    assert new["versions"][0]["valid_from"] == "2027-01-01"
    assert [p["predecessor_code"] for p in new["predecessors"]] == ["XNK-GX-OPD"]

    # 演变关系导出
    csv = api.get("/api/export/service-unit-lineage.csv", params={"as_of": "2027-01-01"}).text
    assert csv.count("SPLIT") == 2
    assert (
        api.get("/api/export/service-unit-lineage.csv", params={"as_of": "2026-12-31"}).text.count(
            "SPLIT"
        )
        == 0
    )
