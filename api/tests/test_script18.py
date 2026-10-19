"""剧本 18：部门整体拆分（意见中的呼吸内科示例，模拟数据）。

2027-01-01 起撤销呼吸内科，新设呼吸一科、呼吸二科：
- 身份先定：原部门退出（被替代），两个新部门新设；不按名称推断
- 承接清单逐项处置：三个服务单元身份不变、分别改挂；子部门改挂呼吸一科；指向原部门的 HIS 部门码结束
  （历史仍指向原部门，T 后待裁决）；指向单元的代码不变；新部门的分类逐个确认
- 有依赖没处置，申请不能确认；按 T 之前的日期查，仍是原来的样子
"""

from factories import (
    classify,
    dept_create,
    ext_assign,
    ext_close,
    ext_register,
    ledger,
    set_parent,
    setup_ledger,
    unit_create,
    unit_item,
    world,
)
from reorg_helpers import dept, detail, problem, reorganize, units_of

T = "2027-01-01"


def _before(api):
    api.apply(
        *world(),
        dept_create(code="HXNK", name="呼吸内科"),
        dept_create(code="HXJR", name="呼吸介入室"),
        set_parent("HXJR", "HXNK", "2020-01-01"),
        classify("HXNK", "CLINICAL", "2020-01-01"),
        unit_create(
            code="SU-101", name="呼吸内科门诊", dept="HXNK", campus="BY", valid_from="2020-01-01"
        ),
        unit_create(
            code="SU-102",
            name="呼吸内科病房",
            unit_type="IPD",
            dept="HXNK",
            campus="BY",
            valid_from="2020-01-01",
        ),
        unit_create(
            code="SU-201", name="呼吸内科高新病房", unit_type="IPD", dept="HXNK", campus="GX"
        ),
    )
    setup_ledger(api)
    api.apply(
        ext_register("D010", "呼吸内科"),
        ext_assign("D010", "2020-01-01", department_code="HXNK"),
        ext_register("M101", "呼吸内科门诊"),
        ext_assign("M101", "2020-01-01", service_unit_code="SU-101"),
    )


def test_script18_split_department(api):
    _before(api)
    d010 = next(
        c for c in detail(api, "HXNK", "2026-12-01")["external_codes"] if c["code"] == "D010"
    )

    new_depts = [
        dept_create(code="HX1", name="呼吸一科", valid_from=T),
        dept_create(code="HX2", name="呼吸二科", valid_from=T),
    ]
    event = reorganize(
        "SPLIT",
        T,
        ["HXNK"],
        [("HX1", "本部门诊、住院"), ("HX2", "高新住院")],
        other_matters="人员任职、医保科室备案由人事、医保部门另行办理",
    )
    # 只定身份、不处置依赖：不能提交，并逐类列出
    cr = api.draft(*new_depts, event)
    msg = problem(api.submit(cr["id"]))
    assert "SU-101" in msg or "呼吸内科门诊" in msg
    api.cancel(cr["id"])  # 撤销后再按承接清单重新起草（同一代码同时只能由一张进行中的申请使用）

    # 承接清单逐项处置
    cr = api.draft(
        *new_depts,
        event,
        unit_item("change_department", "SU-101", T, department_code="HX1"),
        unit_item("change_department", "SU-102", T, department_code="HX1"),
        unit_item("change_department", "SU-201", T, department_code="HX2"),
        set_parent("HXJR", "HX1", T),
        ext_close(d010["assignment_id"], "2026-12-31"),
        classify("HX1", "CLINICAL", T),
        classify("HX2", "CLINICAL", T),
    )
    assert api.as_("solo").submit(cr["id"]).status_code == 200, api.get(
        f"/api/change-requests/{cr['id']}"
    ).text
    assert api.confirm(cr["id"]).json()["status"] == "confirmed"

    # T 之前：一切照旧
    before = units_of(api, "2026-12-31")
    assert {k: v[1] for k, v in before.items()} == {
        "SU-101": "HXNK",
        "SU-102": "HXNK",
        "SU-201": "HXNK",
    }
    assert dept(api, "HXNK", "2026-12-31")["version"]["lifecycle"] == "ACTIVE"
    assert ledger(api, "2026-12-31")["D010"] == ("mapped", ["HXNK"])

    # T 起：原部门被替代；单元身份不变、改挂；子部门改挂；部门码待裁决，单元码不变
    after = units_of(api, T)
    assert {k: v[1] for k, v in after.items()} == {
        "SU-101": "HX1",
        "SU-102": "HX1",
        "SU-201": "HX2",
    }
    assert {k: v[0] for k, v in after.items()} == {k: v[0] for k, v in before.items()}
    assert dept(api, "HXNK", T)["version"]["lifecycle"] == "SUPERSEDED"
    assert dept(api, "HXJR", T)["parent"]["code"] == "HX1"
    codes = ledger(api, T)
    assert codes["D010"] == ("pending", [])
    assert codes["M101"] == ("mapped", ["SU-101"])

    # 原部门的分类止于 T-1，新部门各自确认
    hxnk = detail(api, "HXNK", T)
    assert [c["valid_to"] for c in hxnk["classifications"]] == ["2026-12-31"]
    assert dept(api, "HX1", T)["main_class"]["code"] == "CLINICAL"

    # 沿革：原部门与新部门都能看到同一个事件，身份结论写明
    (ev,) = hxnk["reorganizations"]
    assert ev["event_type"] == "SPLIT" and ev["effective_date"] == T
    outcome = {(p["department"]["code"], p["role"]): p["outcome"] for p in ev["participants"]}
    assert outcome == {
        ("HXNK", "SOURCE"): "EXITS",
        ("HX1", "RESULT"): "NEW",
        ("HX2", "RESULT"): "NEW",
    }
    assert detail(api, "HX2", T)["reorganizations"][0]["id"] == ev["id"]
    # 演变关系不是行政上下级：新部门不挂在已退出的原部门下
    assert dept(api, "HX1", T)["parent"] is None


def test_script18_export_department_lineage(api):
    test_script18_split_department(api)
    csv = api.get("/api/export/department-lineage.csv", params={"as_of": T}).text
    lines = csv.lstrip("﻿").splitlines()
    assert lines[0].startswith("event_id,event_type")
    assert any("HXNK" in x and "EXITS" in x for x in lines[1:])
    assert len(lines) == 4
    early = api.get("/api/export/department-lineage.csv", params={"as_of": "2026-12-31"}).text
    assert len(early.lstrip("﻿").splitlines()) == 1
