"""部门 D1 的约束：分类、主体归属、别名、分类字典的维护权限。"""

import pytest
from factories import classify, dept_create, dept_item, world
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def test_classify_needs_later_date_and_existing_active_code(api):
    api.apply(dept_create())
    api.apply(classify("XNK", "CLINICAL", "2026-01-01"))
    cr = api.draft(classify("XNK", "CLINICAL", "2026-02-01"))
    assert "没有变化" in api.submit(cr["id"]).json()["message"]
    cr = api.draft(classify("XNK", "MEDTECH", "2026-01-01"))
    assert "生效日须晚于" in api.submit(cr["id"]).json()["message"]
    cr = api.draft(classify("XNK", "NOPE", "2026-02-01"))
    assert "不在" in api.submit(cr["id"]).json()["message"]
    cr = api.draft(classify("XNK", "CLINICAL", "2019-01-01"))
    assert "设立日" in api.submit(cr["id"]).json()["message"]


def test_one_main_class_at_a_time_in_database(api, app_engine):
    api.apply(dept_create())
    api.apply(classify("XNK", "CLINICAL", "2026-01-01"))
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="exclusive_excl"):
            c.execute(
                text(
                    "INSERT INTO department_classification (department_id, scheme_id, is_exclusive,"
                    " code, valid_from, change_id, recorded_by)"
                    " SELECT department_id, scheme_id, true, 'MEDTECH', '2026-03-01', change_id,"
                    " recorded_by FROM department_classification"
                )
            )
        c.rollback()
        with pytest.raises(DBAPIError, match="历史记录不可修改"):
            c.execute(text("UPDATE department_classification SET code = 'MEDTECH'"))
        c.rollback()


def test_affiliation_single_primary_and_change(api):
    api.apply(*world())
    api.apply(
        {"kind": "institution.create", "code": "ZX", "valid_from": "2020-01-01",
         "fields": {"name": "中心医院"}}
    )  # fmt: skip
    api.apply(dept_create(institution_code="CD3"))
    cr = api.draft(dept_item("affiliate", institution_code="CD3", effective_date="2026-01-01"))
    assert "没有变化" in api.submit(cr["id"]).json()["message"]
    api.apply(dept_item("affiliate", institution_code="ZX", effective_date="2026-01-01"))
    d = api.get("/api/departments").json()[0]
    assert d["institution_name"] == "中心医院"
    old = api.get("/api/departments", params={"as_of": "2025-12-31"}).json()[0]
    assert old["institution_name"] == "成都市第三人民医院"


def test_alias_close_and_duplicate(api):
    api.apply(dept_create())
    api.apply(dept_item("alias_add", value="心内", valid_from="2020-01-01"))
    cr = api.draft(dept_item("alias_add", value="心内", valid_from="2021-01-01"))
    assert "相同的别名" in api.submit(cr["id"]).json()["message"]
    alias = api.get(f"/api/departments/{api.get('/api/departments').json()[0]['id']}").json()[
        "aliases"
    ][0]
    api.apply({"kind": "department.alias_close", "alias_id": alias["id"], "valid_to": "2025-12-31"})
    assert api.get("/api/departments", params={"q": "心内", "as_of": "2026-01-01"}).json()


# ------------------------------------------------------------------ 分类字典（配置）
def _main_scheme(api):
    return next(
        x for x in api.get("/api/classification-schemes").json() if x["code"] == "DEPT_MAIN_CLASS"
    )


def test_dictionary_maintained_directly_by_maintainers_only(api):
    scheme = _main_scheme(api)
    assert scheme["is_exclusive"] is True
    assert [c["code"] for c in scheme["codes"]] == [
        "CLINICAL", "MEDTECH", "SUPPORT", "ADMIN", "OPERATIONS", "RESEARCH_EDU",
    ]  # fmt: skip
    code = scheme["codes"][0]
    body = {"criterion": "以承担患者诊疗责任为主要设立目的（院内细则）"}
    for user in ("viewer", "confirmer"):
        r = api.as_(user).client.patch(
            f"/api/dictionary/classification-codes/{code['id']}",
            json=body,
            headers={"X-HDIP-User": user},
        )
        assert r.status_code == 403
    r = api.client.patch(
        f"/api/dictionary/classification-codes/{code['id']}",
        json=body,
        headers={"X-HDIP-User": "maintainer"},
    )
    assert r.status_code == 200
    updated = next(c for c in r.json()["codes"] if c["id"] == code["id"])
    assert updated["criterion"].endswith("（院内细则）")
    assert updated["updated_by"]["username"] == "maintainer"
    # 还原
    api.client.patch(
        f"/api/dictionary/classification-codes/{code['id']}",
        json={"criterion": code["criterion"]},
        headers={"X-HDIP-User": "maintainer"},
    )


def test_dictionary_new_code_usable_and_inactive_code_not(api):
    r = api.client.post(
        "/api/dictionary/classification-schemes/DEPT_MAIN_CLASS/codes",
        json={"code": "TEST_X", "name": "测试类"},
        headers={"X-HDIP-User": "maintainer"},
    )
    assert r.status_code == 200
    new = next(c for c in r.json()["codes"] if c["code"] == "TEST_X")
    api.apply(dept_create())
    api.client.patch(
        f"/api/dictionary/classification-codes/{new['id']}",
        json={"is_active": False},
        headers={"X-HDIP-User": "maintainer"},
    )
    cr = api.draft(classify("XNK", "TEST_X", "2026-01-01"))
    assert "已停用" in api.submit(cr["id"]).json()["message"]


def test_dictionary_code_value_immutable(app_engine, api):
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="历史记录不可修改"):
            c.execute(text("UPDATE classification_code SET code = 'X' WHERE code = 'ADMIN'"))
        c.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("DELETE FROM classification_code"))
        c.rollback()


# ------------------------------------------------------------------ 行政隶属与管理关系（D2）
from factories import dept_relation, set_parent  # noqa: E402


def test_single_parent_in_database(api, app_engine):
    api.apply(dept_create(code="A", name="甲"), dept_create(code="B", name="乙"), dept_create())
    api.apply(set_parent("XNK", "A", "2026-01-01"))
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="single_parent_excl"):
            c.execute(
                text(
                    "INSERT INTO department_hierarchy (view_id, parent_department_id,"
                    " child_department_id, valid_from, change_id, recorded_by)"
                    " SELECT view_id, (SELECT id FROM department WHERE code = 'B'),"
                    " child_department_id, '2026-06-01', change_id, recorded_by"
                    " FROM department_hierarchy"
                )
            )
        c.rollback()


def test_set_parent_rules(api):
    api.apply(dept_create(code="A", name="甲"), dept_create())
    cr = api.draft(set_parent("XNK", "XNK", "2026-01-01"))
    assert "自己" in api.submit(cr["id"]).json()["message"]
    cr = api.draft(set_parent("XNK", None, "2026-01-01"))
    assert "已是一级部门" in api.submit(cr["id"]).json()["message"]
    cr = api.draft(set_parent("XNK", "A", "2026-01-01", view="OPERATIONS"))
    assert "尚未启用" in api.submit(cr["id"]).json()["message"]
    api.apply(set_parent("XNK", "A", "2026-01-01"))
    cr = api.draft(set_parent("XNK", "A", "2026-02-01"))
    assert "没有变化" in api.submit(cr["id"]).json()["message"]
    # 回到一级部门
    api.apply(set_parent("XNK", None, "2026-03-01"))
    row = next(r for r in api.get("/api/departments").json() if r["code"] == "XNK")
    assert (row["level"], row["parent"]) == (1, None)


def test_revoke_blocked_by_children_and_ends_own_links(api):
    api.apply(*world())
    api.apply(
        dept_create(code="XXZX", name="信息中心"),
        dept_create(code="TSS", name="图书室"),
        dept_create(code="YWB", name="医务部"),
    )
    api.apply(
        set_parent("TSS", "XXZX", "2026-01-01"),
        dept_relation("PROFESSIONAL_MGMT", "YWB", "文献服务质量", to="TSS"),
    )
    revoke = dept_item("change_lifecycle", "XXZX", effective_date="2027-01-01", lifecycle="REVOKED")
    cr = api.draft(revoke)
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "仍有下级部门" in r.json()["message"] and "图书室" in r.json()["message"]

    # 撤销图书室：它自己的上级边与参与的关系自动止于前一日
    done = api.apply(
        dept_item("change_lifecycle", "TSS", effective_date="2027-01-01", lifecycle="REVOKED")
    )
    assert "行政隶属" in done["outcomes"][0]["after"]["ended_links"]
    assert "专业管理" in done["outcomes"][0]["after"]["ended_links"]
    # 下级没有了，信息中心可以撤销
    api.apply(revoke)


def test_relation_rules_and_close(api):
    api.apply(*world())
    api.apply(dept_create(code="GXB", name="高新院区管理办公室"), dept_create())
    bad = api.post(
        "/api/change-requests",
        {"items": [dept_relation("CAMPUS_MGMT", "GXB", "院区日常运行协调", to="XNK")]},
    )
    assert bad.status_code == 422  # 院区管理须指明院区
    api.apply(dept_relation("CAMPUS_MGMT", "GXB", "院区日常运行协调", to="XNK", campus="GX"))
    cr = api.draft(dept_relation("CAMPUS_MGMT", "GXB", "院区日常运行协调", to="XNK", campus="GX"))
    assert "相同的部门关系" in api.submit(cr["id"]).json()["message"]
    xnk = next(r for r in api.get("/api/departments").json() if r["code"] == "XNK")
    rel = api.get(f"/api/departments/{xnk['id']}").json()["relations"][0]
    assert rel["campus_name"] == "高新院区"
    api.apply(
        {"kind": "department.relation_close", "relation_id": rel["id"], "valid_to": "2026-12-31"}
    )
    csv = api.get("/api/export/department-relations.csv", params={"as_of": "2027-01-01"}).text
    assert "院区日常运行协调" not in csv
