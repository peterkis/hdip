"""剧本 12：部门在新院区开展服务（新建或重新绑定服务单元）：部门 ID、管理编码不变。"""

from factories import dept_create, unit_create, unit_item, world


def test_script12_department_identity_unchanged_by_campus(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="XNK-BY-OPD", campus="BY"))
    before = api.get("/api/departments").json()[0]

    api.apply(
        unit_create(code="XNK-GX-OPD", name="心内科高新门诊", valid_from="2026-12-01"),
        unit_item("rebind", "XNK-BY-OPD", "2027-01-01", campus_code="GX"),
    )
    after = api.get("/api/departments", params={"as_of": "2027-01-01"}).json()[0]
    assert (after["id"], after["code"]) == (before["id"], before["code"])
    detail = api.get(f"/api/departments/{after['id']}", params={"as_of": "2027-01-01"}).json()
    # 部门本身没有新版本：院区变化记在服务单元上
    assert [v["version_no"] for v in detail["versions"]] == [1]
    assert sorted(u["version"]["campus_code"] for u in detail["units"]) == ["GX", "GX"]
