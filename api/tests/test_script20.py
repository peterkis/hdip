"""剧本 20：吸收合并——A 并入已有的 B。

B 保留原身份，不因吸收 A 而新建；A 被替代，单元改挂 B（单元身份不变）。
"""

from factories import dept_create, unit_create, unit_item, world
from reorg_helpers import dept, detail, reorganize, units_of

T = "2027-01-01"


def test_script20_absorb_into_existing_department(api):
    api.apply(
        *world(),
        dept_create(code="FSK", name="放射科"),
        dept_create(code="HYX", name="核医学科"),
        unit_create(
            code="SU-301",
            name="核医学检查",
            unit_type="EXAM",
            dept="HYX",
            campus="BY",
            valid_from="2020-01-01",
        ),
    )
    fsk_id = dept(api, "FSK", "2026-12-01")["id"]
    api.apply(
        reorganize("ABSORB", T, [("HYX", "核医学检查")], ["FSK"]),
        unit_item("change_department", "SU-301", T, department_code="FSK"),
    )
    assert dept(api, "FSK", T)["id"] == fsk_id
    assert dept(api, "FSK", T)["version"]["lifecycle"] == "ACTIVE"
    assert dept(api, "HYX", T)["version"]["lifecycle"] == "SUPERSEDED"
    assert units_of(api, T)["SU-301"][1] == "FSK"
    assert units_of(api, "2026-12-31")["SU-301"][1] == "HYX"
    (ev,) = detail(api, "FSK", T)["reorganizations"]
    outcome = {(p["department"]["code"], p["role"]): p["outcome"] for p in ev["participants"]}
    assert outcome == {("HYX", "SOURCE"): "EXITS", ("FSK", "RESULT"): "CONTINUES"}
