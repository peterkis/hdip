"""剧本 19：分设——原部门存续并更名，另设新部门承接部分服务单元。

原部门保留身份（代码、历史、外部编码都不变），仍为正式履职，不是“被替代”；
新部门新设，只承接明确列出的单元。
"""

from factories import (
    dept_create,
    dept_item,
    ext_assign,
    ext_register,
    ledger,
    setup_ledger,
    unit_create,
    unit_item,
    world,
)
from reorg_helpers import dept, detail, reorganize, units_of

T = "2027-01-01"


def test_script19_split_off_source_continues(api):
    api.apply(
        *world(),
        dept_create(code="HXNK", name="呼吸内科"),
        unit_create(
            code="SU-101", name="呼吸内科门诊", dept="HXNK", campus="BY", valid_from="2020-01-01"
        ),
        unit_create(
            code="SU-201", name="呼吸内科高新病房", unit_type="IPD", dept="HXNK", campus="GX"
        ),
    )
    setup_ledger(api)
    api.apply(
        ext_register("D010", "呼吸内科"), ext_assign("D010", "2020-01-01", department_code="HXNK")
    )
    hxnk_id = dept(api, "HXNK", "2026-12-01")["id"]

    api.apply(
        dept_item("revise", "HXNK", effective_date=T, changes={"name": "呼吸一科"}),
        dept_create(code="HX2", name="呼吸二科", valid_from=T),
        reorganize("SPLIT_OFF", T, [("HXNK", "保留门诊")], [("HX2", "承接高新住院")]),
        unit_item("change_department", "SU-201", T, department_code="HX2"),
    )

    after = dept(api, "HXNK", T)
    assert after["id"] == hxnk_id
    assert after["version"]["name"] == "呼吸一科"
    assert after["version"]["lifecycle"] == "ACTIVE"
    assert {k: v[1] for k, v in units_of(api, T).items()} == {"SU-101": "HXNK", "SU-201": "HX2"}
    assert ledger(api, T)["D010"] == ("mapped", ["HXNK"])  # 身份没变，部门码照旧

    (ev,) = detail(api, "HXNK", T)["reorganizations"]
    outcome = {(p["department"]["code"], p["role"]): p["outcome"] for p in ev["participants"]}
    assert outcome == {
        ("HXNK", "SOURCE"): "CONTINUES",
        ("HXNK", "RESULT"): "CONTINUES",
        ("HX2", "RESULT"): "NEW",
    }
