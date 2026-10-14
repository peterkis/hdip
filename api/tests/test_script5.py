"""剧本 5：查指定日期哪些单元在运营、归哪个主体。

“在运营”= 当天有有效版本（含暂停，以状态标出）；尚未生效的计划单元、已退出的单元不算。
"""

from factories import dept_create, unit_create, unit_item, world


def _on(api, day, **params):
    rows = api.get(
        "/api/service-units", params={"as_of": day, "include_future": "false", **params}
    ).json()
    return {r["code"]: (r["version"]["institution_code"], r["version"]["status"]) for r in rows}


def test_script5_units_operating_on_a_date_and_their_operator(api):
    api.apply(
        *world(),
        {
            "kind": "institution.create",
            "code": "ZX",
            "valid_from": "2020-01-01",
            "fields": {"name": "成都市第三人民医院中心医院"},
        },
    )
    # 2027 起高新院区的主要运营方由 CD3 换成 ZX（关闭旧关系 + 新建）
    rel = next(
        r["id"]
        for r in api.get("/api/operator-relations", params={"as_of": "2026-11-01"}).json()
        if r["campus_code"] == "GX"
    )
    api.apply(
        dept_create(),
        unit_create(code="GX-OPD", valid_from="2026-11-01"),
        unit_create(code="GX-IPD", unit_type="IPD", valid_from="2026-11-01"),
        unit_create(code="BY-OPD", campus="BY", valid_from="2026-11-01"),
        unit_create(code="BY-ED", unit_type="ED", campus="BY", valid_from="2027-03-01"),  # 计划中
    )
    api.apply(
        unit_item("change_status", "GX-IPD", "2026-12-01", status="SUSPENDED"),
        {"kind": "service_unit.retire", "code": "BY-OPD", "valid_to": "2026-12-31"},
    )
    api.apply(
        {
            "kind": "service_unit.rebind",
            "code": "GX-OPD",
            "effective_date": "2027-01-01",
            "institution_code": "ZX",
        },
        {
            "kind": "service_unit.rebind",
            "code": "GX-IPD",
            "effective_date": "2027-01-01",
            "institution_code": "ZX",
        },
        {"kind": "operator_relation.close", "relation_id": rel, "valid_to": "2026-12-31"},
        {
            "kind": "operator_relation.create",
            "institution_code": "ZX",
            "campus_code": "GX",
            "relation_type": "OPERATE",
            "is_primary": True,
            "valid_from": "2027-01-01",
        },
    )

    assert _on(api, "2026-10-31") == {}
    assert _on(api, "2026-11-15") == {
        "BY-OPD": ("CD3", "ACTIVE"),
        "GX-IPD": ("CD3", "ACTIVE"),
        "GX-OPD": ("CD3", "ACTIVE"),
    }
    assert _on(api, "2026-12-31") == {
        "BY-OPD": ("CD3", "ACTIVE"),  # 最后有效日当天仍在
        "GX-IPD": ("CD3", "SUSPENDED"),  # 暂停也算，标出状态
        "GX-OPD": ("CD3", "ACTIVE"),
    }
    assert _on(api, "2027-01-01") == {
        "GX-IPD": ("ZX", "SUSPENDED"),
        "GX-OPD": ("ZX", "ACTIVE"),
    }
    assert _on(api, "2027-03-01") == {
        "BY-ED": ("CD3", "ACTIVE"),
        "GX-IPD": ("ZX", "SUSPENDED"),
        "GX-OPD": ("ZX", "ACTIVE"),
    }
    # 按主体筛
    zx = next(i["id"] for i in api.get("/api/institutions").json() if i["code"] == "ZX")
    assert set(_on(api, "2027-01-01", institution_id=zx)) == {"GX-IPD", "GX-OPD"}
    # 同一天导出与查询一致
    csv = api.get("/api/export/service-units.csv", params={"as_of": "2026-12-31"}).text
    lines = csv.lstrip("﻿").strip().split("\r\n")
    assert len(lines) == 1 + 3
