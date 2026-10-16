"""剧本 17：历史代码复用——同一外部代码在不同期间指向不同对象，按日期还原当时指向谁；
同一代码在不同院区按条件指向不同对象。"""

from factories import (
    dept_create,
    ext_assign,
    ext_register,
    ledger,
    setup_ledger,
    unit_create,
    world,
)


def _setup(api):
    setup_ledger(api)
    api.apply(
        *world(),
        dept_create(),
        dept_create(code="SJNK", name="神经内科"),
        unit_create("XNK-BY-OPD", "心血管内科门诊", "OPD", campus="BY", valid_from="2025-01-01"),
        unit_create("XNK-GX-OPD", "心内科高新门诊", "OPD", campus="GX", valid_from="2026-11-01"),
    )


def test_script17_code_reuse_over_time(api):
    _setup(api)
    api.apply(
        ext_register("0399", "心内门诊（旧）"),
        ext_assign(
            "0399", service_unit_code="XNK-BY-OPD", valid_from="2025-01-01", valid_to="2025-12-31"
        ),
        ext_assign(
            "0399",
            department_code="SJNK",
            valid_from="2026-01-01",
            evidence_note="2026 年起 HIS 把 0399 复用给神经内科",
        ),
    )
    assert ledger(api, as_of="2025-06-01")["0399"] == ("mapped", ["XNK-BY-OPD"])
    assert ledger(api, as_of="2026-06-01")["0399"] == ("mapped", ["SJNK"])

    detail = api.get(
        f"/api/external-codes/{api.get('/api/external-codes').json()['rows'][0]['id']}"
    ).json()
    assert [(a["target_type"], a["valid_from"], a["valid_to"]) for a in detail["assignments"]] == [
        ("department", "2026-01-01", None),
        ("service_unit", "2025-01-01", "2025-12-31"),
    ]


def test_script17_campus_condition(api):
    _setup(api)
    api.apply(
        ext_register("0500", "心内门诊"),
        ext_assign(
            "0500", service_unit_code="XNK-BY-OPD", campus_code="BY", valid_from="2025-01-01"
        ),
        ext_assign(
            "0500", service_unit_code="XNK-GX-OPD", campus_code="GX", valid_from="2026-11-01"
        ),
    )
    assert ledger(api, as_of="2026-06-01")["0500"] == ("mapped", ["XNK-BY-OPD"])
    status, targets = ledger(api, as_of="2026-12-01")["0500"]
    assert status == "mapped" and sorted(targets) == ["XNK-BY-OPD", "XNK-GX-OPD"]

    # 同一时点不能一部分按院区区分、一部分不区分
    cr = api.draft(ext_assign("0500", department_code="XNK", valid_from="2026-12-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "院区" in r.json()["message"]


def test_script17_backdated_adjudication(api):
    """待裁决的记录后来裁决：新增一条开始日在过去的解释，不覆盖任何已有事实。"""
    _setup(api)
    api.apply(ext_register("0600", "心内待核"))
    assert ledger(api, as_of="2025-06-01")["0600"] == ("pending", [])
    api.apply(ext_assign("0600", department_code="XNK", valid_from="2025-01-01"))
    assert ledger(api, as_of="2025-06-01")["0600"] == ("mapped", ["XNK"])
