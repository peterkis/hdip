"""剧本 15：一份 HIS 字典混装不同对象。

代表全院部门的代码映射到部门，“本部心血管门诊 / 住院”映射到各自的服务单元；同一代码同一时点
不能同时映射部门与单元；按部门汇总经服务单元的所属部门得出；只登记未解释的记录为待裁决，
不进入导出；护理单元、病区等代码标“对象未建模”。
"""

from factories import (
    dept_create,
    ext_assign,
    ext_register,
    ledger,
    setup_ledger,
    unit_create,
    world,
)


def _setup(api):
    setup_ledger(api)
    api.apply(
        *world(),
        dept_create(),
        unit_create("XNK-BY-OPD", "心血管内科门诊", "OPD", campus="BY", valid_from="2025-01-01"),
        unit_create("XNK-BY-IPD", "心血管内科病房", "IPD", campus="BY", valid_from="2025-01-01"),
    )
    # 一张申请：先登记，再解释；最后一条只登记不解释
    api.apply(
        ext_register("0301", "心血管内科"),
        ext_register("030101", "本部心血管门诊"),
        ext_register("030102", "本部心血管住院"),
        ext_register("030102H", "心血管护理单元"),
        ext_register("039999", "心内待核"),
        ext_assign("0301", department_code="XNK", evidence_note="代表全院心血管内科"),
        ext_assign("030101", service_unit_code="XNK-BY-OPD"),
        ext_assign("030102", service_unit_code="XNK-BY-IPD"),
        ext_assign("030102H", unmodeled_type="NURSING_UNIT", evidence_note="HIS 护理单元"),
    )


def test_script15_mixed_dictionary(api):
    _setup(api)
    day = "2026-06-01"
    assert ledger(api, as_of=day) == {
        "0301": ("mapped", ["XNK"]),
        "030101": ("mapped", ["XNK-BY-OPD"]),
        "030102": ("mapped", ["XNK-BY-IPD"]),
        "030102H": ("unmodeled", ["NURSING_UNIT"]),
        "039999": ("pending", []),
    }
    page = api.get("/api/external-codes", params={"as_of": day, "status": "pending"}).json()
    assert [r["code"] for r in page["rows"]] == ["039999"]
    assert page["counts"] == {"pending": 1, "mapped": 3, "unmodeled": 1}

    # 同一代码同一时点不能既是单元又是它的所属部门
    cr = api.draft(ext_assign("030101", department_code="XNK", valid_from="2026-06-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "同一时点只能有一个" in r.json()["message"]

    # 部门页：本部门的身份代码只有 0301；经服务单元得到的代码单列，标明来自哪个单元
    xnk = next(r for r in api.get("/api/departments").json() if r["code"] == "XNK")
    detail = api.get(f"/api/departments/{xnk['id']}", params={"as_of": day}).json()
    assert [c["code"] for c in detail["external_codes"]] == ["0301"]
    assert [(c["code"], c["via_unit"]["code"]) for c in detail["unit_external_codes"]] == [
        ("030101", "XNK-BY-OPD"),
        ("030102", "XNK-BY-IPD"),
    ]
    unit = next(u for u in detail["units"] if u["code"] == "XNK-BY-OPD")
    unit_detail = api.get(f"/api/service-units/{unit['id']}", params={"as_of": day}).json()
    assert [c["code"] for c in unit_detail["external_codes"]] == ["030101"]

    # 导出：只含指向平台对象的解释
    csv = api.get("/api/export/external-codes.csv", params={"as_of": day}).text
    assert "HIS,DEPT,0301,心血管内科,department,部门,XNK,心血管内科" in csv
    assert "HIS,DEPT,030101,本部心血管门诊,service_unit,服务单元,XNK-BY-OPD,心血管内科门诊" in csv
    # 待裁决、对象未建模都不进入导出
    assert "039999" not in csv
    assert "030102H" not in csv

    # 来源系统概览：代码数与待裁决数
    systems = api.get("/api/source-systems", params={"as_of": day}).json()
    ns = systems[0]["namespaces"][0]
    assert (ns["code"], ns["code_count"], ns["pending_count"]) == ("DEPT", 5, 1)
