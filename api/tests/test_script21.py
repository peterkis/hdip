"""剧本 21：领导查看某日全院服务布局，点选一个部门，核对它在各院区的单元，并跳转到某个单元的详情。

组织总览只读、不新增写入：服务布局图与矩阵由前端从服务单元列表（所属部门、院区、运营主体、
类型、状态）与部门列表（主分类、行政上级）聚合；编码治理图用来源系统列表里每本字典的状态分解。
这里验证后端给出的这些口径。
"""

from factories import (
    dept_create,
    ext_assign,
    ext_register,
    set_parent,
    setup_ledger,
    unit_create,
    unit_item,
    world,
)


def _setup(api):
    api.apply(
        *world(),
        dept_create(code="HXNK", name="呼吸内科"),
        dept_create(code="HXJR", name="呼吸介入室"),
        set_parent("HXJR", "HXNK", "2020-01-01"),
        unit_create(
            "SU-1", "呼吸内科门诊", "OPD", dept="HXNK", campus="BY", valid_from="2020-01-01"
        ),
        unit_create(
            "SU-2", "呼吸内科病房", "IPD", dept="HXNK", campus="BY", valid_from="2020-01-01"
        ),
        unit_create(
            "SU-3", "支气管镜室", "EXAM", dept="HXJR", campus="BY", valid_from="2020-01-01"
        ),
        unit_create(
            "SU-4", "呼吸内科高新病房", "IPD", dept="HXNK", campus="GX", valid_from="2026-11-01"
        ),
    )


def _units(api, day, include_future):
    rows = api.get(
        "/api/service-units", params={"as_of": day, "include_future": include_future}
    ).json()
    return {
        u["code"]: (
            u["version"]["department_code"],
            u["version"]["campus_code"],
            u["version"]["status"],
            u["not_yet_effective"],
        )
        for u in rows
    }


def test_script21_service_layout_by_campus_and_department(api):
    _setup(api)
    api.apply(unit_item("change_status", "SU-2", "2026-06-01", status="SUSPENDED"))

    # 当天在运营（含暂停）：高新病房尚未开始，不算
    day = _units(api, "2026-10-21", include_future=False)
    assert set(day) == {"SU-1", "SU-2", "SU-3"}
    assert day["SU-2"][2] == "SUSPENDED"
    # 单元挂在自己的部门上：支气管镜室属于二级部门呼吸介入室，不上卷到呼吸内科
    assert day["SU-3"][0] == "HXJR"

    # 含计划单元：高新病房标为尚未生效，院区是高新
    planned = _units(api, "2026-10-21", include_future=True)
    assert planned["SU-4"] == ("HXNK", "GX", "ACTIVE", True)

    # 部门列表给出主分类与行政上级，前端据此把单元挂到部门树上
    depts = {
        d["code"]: d for d in api.get("/api/departments", params={"as_of": "2026-10-21"}).json()
    }
    assert depts["HXJR"]["parent"]["code"] == "HXNK"
    assert depts["HXJR"]["level"] == 2
    # 跨院区：生效后呼吸内科在本部与高新都有单元
    later = _units(api, "2026-12-01", include_future=False)
    assert {c for code, (d, c, *_rest) in later.items() if d == "HXNK"} == {"BY", "GX"}


def test_script21_code_governance_breakdown(api):
    setup_ledger(api)
    _setup(api)
    api.apply(
        ext_register("D1", "呼吸内科"),
        ext_assign("D1", department_code="HXNK"),
        ext_register("M1", "呼吸内科门诊"),
        ext_assign("M1", service_unit_code="SU-1"),
        ext_register("N1", "五病区护理单元"),
        ext_assign("N1", unmodeled_type="NURSING_UNIT"),
        # 同一代码按院区条件分别指向部门与单元：按源记录只计一次
        ext_register("X1", "呼吸内科（混）"),
        ext_assign("X1", department_code="HXNK", campus_code="BY"),
        ext_assign("X1", service_unit_code="SU-4", campus_code="GX", valid_from="2026-11-01"),
        ext_register("P1", "待核"),
        ext_register("P2", "待核二"),
    )

    def breakdown(day):
        (system,) = api.get("/api/source-systems", params={"as_of": day}).json()
        (ns,) = system["namespaces"]
        return ns["code_count"], ns["breakdown"]

    count, before = breakdown("2026-10-21")
    assert count == 6
    assert before == {
        "department": 2,
        "service_unit": 1,
        "unmodeled": 1,
        "pending": 2,
    }
    _, after = breakdown("2026-12-01")
    assert after == {"department": 1, "service_unit": 1, "mixed": 1, "unmodeled": 1, "pending": 2}
    assert sum(after.values()) == count
