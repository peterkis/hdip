"""剧本 2：为心内科在高新院区设立门诊、住院两个服务单元（同部门同院区多单元）。"""

from factories import dept_create, unit_create, world


def test_script2_one_department_two_units_in_one_campus(api):
    api.apply(*world())
    cr = api.as_("maintainer").draft(
        dept_create(),
        unit_create(),
        unit_create(code="XNK-GX-IPD", name="心内科高新病房", unit_type="IPD"),
        note="高新院区心内科开科",
    )
    assert api.as_("maintainer").submit(cr["id"]).status_code == 200
    done = api.as_("confirmer").confirm(cr["id"]).json()
    assert done["status"] == "confirmed"
    assert done["submitted_by"]["username"] == "maintainer"
    assert done["confirmed_by"]["username"] == "confirmer"

    units = api.get("/api/service-units", params={"as_of": "2026-11-01"}).json()
    assert [(u["code"], u["unit_type"]) for u in units] == [
        ("XNK-GX-IPD", "IPD"),
        ("XNK-GX-OPD", "OPD"),
    ]
    assert {u["version"]["department_name"] for u in units} == {"心血管内科"}
    assert {u["version"]["campus_code"] for u in units} == {"GX"}
    assert {u["version"]["institution_code"] for u in units} == {"CD3"}

    # 一个部门，不因院区或单元类型拆成多个部门
    depts = api.get("/api/departments", params={"as_of": "2026-11-01"}).json()
    assert [(d["code"], d["unit_count"]) for d in depts] == [("XNK", 2)]
    # 生效前查不到在用单元
    assert api.get("/api/departments", params={"as_of": "2026-10-31"}).json()[0]["unit_count"] == 0
