"""剧本 16：同一个病案科室分类代码分别赋给一个部门和一个服务单元。

按旧日期回溯看到当时的分类；共同类别不使两者成为同一对象；部门分类不自动下发给其服务单元。
"""

from factories import classify, dept_create, unit_classify, unit_create, world


def _scheme(api, code="TEST_MR_DEPT", **kw):
    body = {
        "code": code,
        "name": "病案科室分类（测试）",
        "version": "测试版",
        "is_exclusive": True,
        "meaning_for_department": "病案统计科别参考",
        "meaning_for_unit": "病案统计科别",
        **kw,
    }
    r = api.as_("maintainer").post("/api/dictionary/classification-schemes", body)
    assert r.status_code == 200, r.text
    for c, name in (("17", "心血管内科"), ("18", "心血管重症")):
        r = api.as_("maintainer").post(
            f"/api/dictionary/classification-schemes/{code}/codes", {"code": c, "name": name}
        )
        assert r.status_code == 200, r.text


def _classes(api, day):
    csv = api.get("/api/export/classifications.csv", params={"as_of": day}).text
    return [line for line in csv.splitlines() if "TEST_MR_DEPT" in line]


def test_script16_shared_class_on_department_and_unit(api):
    _scheme(api)
    api.apply(
        *world(),
        dept_create(),
        unit_create("XNK-BY-OPD", "心血管内科门诊", "OPD", campus="BY", valid_from="2025-01-01"),
        unit_create("XNK-BY-IPD", "心血管内科病房", "IPD", campus="BY", valid_from="2025-01-01"),
    )
    api.apply(
        classify("XNK", "17", "2025-01-01", scheme="TEST_MR_DEPT"),
        unit_classify("XNK-BY-IPD", "TEST_MR_DEPT", "17", "2026-01-01"),
    )
    api.apply(unit_classify("XNK-BY-IPD", "TEST_MR_DEPT", "18", "2026-07-01"))

    assert _classes(api, "2025-06-01") == [
        "department,XNK,心血管内科,TEST_MR_DEPT,病案科室分类（测试）,17,心血管内科,2025-01-01,"
    ]
    assert _classes(api, "2026-03-01")[1] == (
        "service_unit,XNK-BY-IPD,心血管内科病房,TEST_MR_DEPT,病案科室分类（测试）,17,心血管内科,"
        "2026-01-01,2026-06-30"
    )
    assert _classes(api, "2026-08-01")[1].startswith(
        "service_unit,XNK-BY-IPD,心血管内科病房,TEST_MR_DEPT,病案科室分类（测试）,18,"
    )
    # 部门分类不下发：门诊单元没有分类
    assert not any("XNK-BY-OPD" in line for line in _classes(api, "2026-08-01"))

    units = api.get("/api/service-units", params={"as_of": "2026-08-01"}).json()
    ipd = next(u for u in units if u["code"] == "XNK-BY-IPD")
    detail = api.get(f"/api/service-units/{ipd['id']}", params={"as_of": "2026-08-01"}).json()
    assert [(c["code"], c["valid_to"]) for c in detail["classifications"]] == [
        ("18", None),
        ("17", "2026-06-30"),
    ]
    # 共同类别不是身份：部门与单元各自没有外部代码，也不互为同一对象
    assert detail["external_codes"] == []


def test_script16_scheme_meaning_limits_owner(api):
    _scheme(api, code="TEST_DEPT_ONLY", meaning_for_unit=None)
    api.apply(
        *world(), dept_create(), unit_create("U1", "门诊", campus="BY", valid_from="2025-01-01")
    )
    for item in (
        unit_classify("U1", "TEST_DEPT_ONLY", "17", "2026-01-01"),
        unit_classify("U1", "DEPT_MAIN_CLASS", "CLINICAL", "2026-01-01"),
    ):
        cr = api.draft(item)
        r = api.submit(cr["id"])
        assert r.status_code == 422
        assert "不适用于服务单元" in r.json()["message"]
