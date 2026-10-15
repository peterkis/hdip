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
