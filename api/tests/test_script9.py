"""剧本 9：新设一个筹备中的部门，计划次年 1 月 1 日正式履职：之前不计入部门数，之后计入。"""

from factories import dept_create, dept_item, unit_create, world


def _counted(api, day):
    """部门数口径：当天已设立且组织生命周期为正式履职。"""
    rows = api.get("/api/departments", params={"as_of": day}).json()
    return sorted(
        r["code"]
        for r in rows
        if not r["not_yet_effective"] and r["version"]["lifecycle"] == "ACTIVE"
    )


def test_script9_preparing_department_not_counted_until_active(api):
    api.apply(*world())
    api.apply(dept_create())
    cr = api.as_("maintainer").draft(
        dept_create(code="XZKF", name="心脏康复中心", valid_from="2026-09-01",
                    lifecycle="PREPARING", institution_code="CD3"),
        dept_item("change_lifecycle", "XZKF", effective_date="2027-01-01", lifecycle="ACTIVE"),
        # 提前建好计划中的服务单元：自部门正式履职当天起
        unit_create(code="XZKF-GX-OPD", name="心脏康复门诊", dept="XZKF", valid_from="2027-01-01"),
        note="心脏康复中心筹建",
    )  # fmt: skip
    assert api.as_("maintainer").submit(cr["id"]).status_code == 200
    assert api.as_("confirmer").confirm(cr["id"]).json()["status"] == "confirmed"

    assert _counted(api, "2026-10-15") == ["XNK"]
    assert _counted(api, "2026-12-31") == ["XNK"]
    assert _counted(api, "2027-01-01") == ["XNK", "XZKF"]

    row = next(
        r for r in api.get("/api/departments", params={"as_of": "2026-10-15"}).json()
        if r["code"] == "XZKF"
    )  # fmt: skip
    assert row["version"]["lifecycle"] == "PREPARING"
    assert row["institution_name"] == "成都市第三人民医院"
    # 导出也按同一口径：status 为组织生命周期
    csv = api.get("/api/export/departments.csv", params={"as_of": "2026-10-15"}).text
    assert "XZKF,心脏康复中心,PREPARING,筹备" in csv


def test_unit_cannot_start_while_department_is_preparing(api):
    api.apply(*world())
    api.apply(dept_create(code="XZKF", name="心脏康复中心", valid_from="2026-09-01",
                          lifecycle="PREPARING"))  # fmt: skip
    cr = api.draft(unit_create(code="U1", dept="XZKF", valid_from="2026-11-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "筹备" in r.json()["message"]
