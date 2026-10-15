"""剧本 13：调整行政隶属：同一视图同一时点一个上级，试图成环被拒；一级 / 二级部门随之变化；
专业管理关系不受影响。"""

from factories import dept_create, dept_relation, set_parent


def _org(api, day):
    rows = api.get("/api/departments", params={"as_of": day}).json()
    return {r["code"]: (r["level"], (r["parent"] or {}).get("code")) for r in rows}


def test_script13_admin_hierarchy_levels_cycle_and_professional_mgmt(api):
    api.apply(
        dept_create(code="XXZX", name="信息中心"),
        dept_create(code="TSS", name="图书室"),
        dept_create(code="JSJZX", name="计算机中心"),
        dept_create(code="KJB", name="科教部"),
        dept_create(code="YWB", name="医务部"),
        dept_create(),
    )
    # 信息中心下有图书室、计算机中心两个二级部门；医务部对心血管内科的临床医疗工作实施专业管理
    cr = api.as_("maintainer").draft(
        set_parent("TSS", "XXZX", "2026-01-01"),
        set_parent("JSJZX", "XXZX", "2026-01-01"),
        dept_relation("PROFESSIONAL_MGMT", "YWB", "临床医疗工作", to="XNK"),
    )
    assert api.as_("maintainer").submit(cr["id"]).status_code == 200
    assert api.as_("confirmer").confirm(cr["id"]).json()["status"] == "confirmed"

    org = _org(api, "2026-06-01")
    assert org["XXZX"] == (1, None)
    assert org["TSS"] == (2, "XXZX")
    assert org["JSJZX"] == (2, "XXZX")
    assert org["XNK"] == (1, None)  # 专业管理不构成行政上级

    # 试图让信息中心隶属于自己的下级：成环被拒
    cr = api.draft(set_parent("XXZX", "TSS", "2026-07-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "循环" in r.json()["message"]

    # 2027 年起图书室改隶科教部；旧日期回溯仍是信息中心
    api.apply(set_parent("TSS", "KJB", "2027-01-01"))
    assert _org(api, "2026-12-31")["TSS"] == (2, "XXZX")
    assert _org(api, "2027-01-01")["TSS"] == (2, "KJB")

    xx = next(r for r in api.get("/api/departments").json() if r["code"] == "XXZX")
    detail = api.get(f"/api/departments/{xx['id']}", params={"as_of": "2027-01-01"}).json()
    assert [c["code"] for c in detail["children"]] == ["JSJZX"]

    tss = next(r for r in api.get("/api/departments").json() if r["code"] == "TSS")
    detail = api.get(f"/api/departments/{tss['id']}", params={"as_of": "2027-01-01"}).json()
    assert [p["code"] for p in detail["path"]] == ["KJB", "TSS"]
    assert [(e["parent"]["code"], e["valid_to"]) for e in detail["parents"]] == [
        ("KJB", None),
        ("XXZX", "2026-12-31"),
    ]

    # 专业管理关系不受行政隶属调整影响
    xnk = next(r for r in api.get("/api/departments").json() if r["code"] == "XNK")
    rel = api.get(f"/api/departments/{xnk['id']}", params={"as_of": "2027-01-01"}).json()[
        "relations"
    ]
    assert [(x["kind"], x["from_department"]["code"], x["scope"]) for x in rel] == [
        ("PROFESSIONAL_MGMT", "YWB", "临床医疗工作")
    ]

    # 导出：行政视图结构
    csv = api.get("/api/export/department-hierarchy.csv", params={"as_of": "2027-01-01"}).text
    assert "ADMIN,TSS,图书室,2,KJB,科教部" in csv
