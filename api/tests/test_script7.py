"""剧本 7：把两个服务单元合并成一个。"""

from factories import dept_create, merge, successor, unit_create, world


def test_script7_merge_two_units_into_one(api):
    api.apply(*world())
    api.apply(
        dept_create(),
        dept_create(code="XWK", name="心血管外科"),
        unit_create(code="XNK-GX-IPD", name="心内科高新病房", unit_type="IPD"),
        unit_create(code="XWK-GX-IPD", name="心外科高新病房", unit_type="IPD", dept="XWK"),
    )
    cr = api.apply(
        merge(
            ["XNK-GX-IPD", "XWK-GX-IPD"],
            "2027-01-01",
            successor("XXG-GX-IPD", "心血管中心高新住院单元", unit_type="IPD"),
        )
    )
    assert cr["outcomes"][0]["target"].endswith("XXG-GX-IPD 心血管中心高新住院单元")

    rows = api.get(
        "/api/service-units", params={"as_of": "2027-01-01", "include_future": "false"}
    ).json()
    assert [r["code"] for r in rows] == ["XXG-GX-IPD"]
    new = api.get(f"/api/service-units/{rows[0]['id']}").json()
    assert sorted(p["predecessor_code"] for p in new["predecessors"]) == [
        "XNK-GX-IPD",
        "XWK-GX-IPD",
    ]
    assert {p["lineage_type"] for p in new["predecessors"]} == {"MERGE"}
    # 两个前身都在前一日退出，代码不释放
    for p in new["predecessors"]:
        old = api.get(f"/api/service-units/{p['predecessor_id']}").json()
        assert old["retired_after"] == "2026-12-31"
