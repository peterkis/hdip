"""剧本 8：把一个院区的单元改挂到新建部门下，再按旧日期回溯，看到的仍是改挂前的部门。"""

from factories import dept_create, unit_create, unit_item, world


def test_script8_move_units_to_new_department_and_look_back(api):
    api.apply(*world())
    api.apply(
        dept_create(),
        unit_create(code="XNK-GX-OPD"),
        unit_create(code="XNK-GX-IPD", name="心内科高新病房", unit_type="IPD"),
        unit_create(code="XNK-BY-OPD", name="心内科本院门诊", campus="BY"),
    )
    # 一张申请：新建部门 + 改挂高新院区的两个单元，整体成立
    api.apply(
        dept_create(code="XNK-GX", name="高新心血管内科"),
        unit_item("change_department", "XNK-GX-OPD", "2027-01-01", department_code="XNK-GX"),
        unit_item("change_department", "XNK-GX-IPD", "2027-01-01", department_code="XNK-GX"),
    )

    def depts_on(day):
        rows = api.get("/api/service-units", params={"as_of": day}).json()
        return {r["code"]: r["version"]["department_code"] for r in rows}

    assert depts_on("2026-12-31") == {
        "XNK-BY-OPD": "XNK",
        "XNK-GX-IPD": "XNK",
        "XNK-GX-OPD": "XNK",
    }
    assert depts_on("2027-01-01") == {
        "XNK-BY-OPD": "XNK",
        "XNK-GX-IPD": "XNK-GX",
        "XNK-GX-OPD": "XNK-GX",
    }
    # 身份不变
    ids = {r["code"]: r["id"] for r in api.get("/api/service-units").json()}
    later = {
        r["code"]: r["id"]
        for r in api.get("/api/service-units", params={"as_of": "2027-01-01"}).json()
    }
    assert ids == later


def test_change_department_is_atomic_with_new_department(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    # 引用一个不存在的部门：整张申请不成立，新建部门也不会落库
    cr = api.draft(
        dept_create(code="NEW", name="新部门"),
        unit_item("change_department", "U1", "2027-01-01", department_code="NOPE"),
    )
    assert api.submit(cr["id"]).status_code == 422
    assert [d["code"] for d in api.get("/api/departments").json()] == ["XNK"]
