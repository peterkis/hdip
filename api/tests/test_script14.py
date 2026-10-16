"""剧本 14：行政隶属调整后，外部身份映射（HIS、病案等）原样不变。"""

from factories import dept_create, ext_assign, ext_register, ledger, set_parent, setup_ledger


def test_script14_hierarchy_change_keeps_identity_mapping(api):
    setup_ledger(api)
    api.apply(
        dept_create(code="XXZX", name="信息中心"),
        dept_create(code="KJB", name="科教部"),
        dept_create(code="TSS", name="图书室"),
        set_parent("TSS", "XXZX", "2026-01-01"),
        ext_register("1901", "图书室"),
        ext_assign("1901", department_code="TSS", valid_from="2026-01-01"),
    )
    before = ledger(api, as_of="2026-06-01")
    assert before["1901"] == ("mapped", ["TSS"])

    # 图书室改隶科教部：身份映射不随隶属变化
    api.apply(set_parent("TSS", "KJB", "2027-01-01"))
    assert ledger(api, as_of="2027-06-01")["1901"] == ("mapped", ["TSS"])

    tss = next(r for r in api.get("/api/departments").json() if r["code"] == "TSS")
    detail = api.get(f"/api/departments/{tss['id']}", params={"as_of": "2027-06-01"}).json()
    assert [p["code"] for p in detail["path"]] == ["KJB", "TSS"]
    assert [(c["code"], c["valid_from"], c["valid_to"]) for c in detail["external_codes"]] == [
        ("1901", "2026-01-01", None)
    ]
    # 上级部门不因下级的映射得到任何外部代码
    kjb = next(r for r in api.get("/api/departments").json() if r["code"] == "KJB")
    kjb_detail = api.get(f"/api/departments/{kjb['id']}", params={"as_of": "2027-06-01"}).json()
    assert kjb_detail["external_codes"] == []
