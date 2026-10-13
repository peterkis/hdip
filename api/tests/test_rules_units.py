"""第 2 步的约束：部门、服务单元、阻止规则。"""

import pytest
from factories import change_status, dept_create, unit_create, unit_item, world
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _relation_id(api, campus_code):
    rows = api.get("/api/operator-relations", params={"as_of": "2026-11-01"}).json()
    return next(r["id"] for r in rows if r["campus_code"] == campus_code)


# ------------------------------------------------------------------ 阻止规则
def test_suspending_campus_blocked_by_units_and_lists_them(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"), unit_create(code="U2", unit_type="IPD"))
    api.apply(change_status(status="RUNNING", effective_date="2026-11-15"))
    cr = api.draft(change_status(status="SUSPENDED", effective_date="2027-01-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    msg = r.json()["message"]
    assert "仍有服务单元依赖" in msg and "U1" in msg and "U2" in msg


def test_suspend_campus_and_move_units_in_one_request(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    api.apply(change_status(status="RUNNING", effective_date="2026-11-15"))
    # 停用在前、改挂在后也行：依赖在全部变更项应用后统一校验
    api.apply(
        change_status(status="SUSPENDED", effective_date="2027-01-01"),
        unit_item("rebind", "U1", "2027-01-01", campus_code="BY"),
    )
    rows = api.get("/api/service-units", params={"as_of": "2027-01-01"}).json()
    assert rows[0]["version"]["campus_code"] == "BY"


def test_retired_units_do_not_block_suspending_campus(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    api.apply(change_status(status="RUNNING", effective_date="2026-11-15"))
    api.apply({"kind": "service_unit.retire", "code": "U1", "valid_to": "2026-12-31"})
    api.apply(change_status(status="SUSPENDED", effective_date="2027-01-01"))


def test_closing_operate_relation_blocked_by_units(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    rel = _relation_id(api, "GX")
    cr = api.draft(
        {"kind": "operator_relation.close", "relation_id": rel, "valid_to": "2026-12-31"}
    )
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "仍有服务单元依赖" in r.json()["message"]
    # 退出单元后可以关闭
    api.apply(
        {"kind": "service_unit.retire", "code": "U1", "valid_to": "2026-12-31"},
        {"kind": "operator_relation.close", "relation_id": rel, "valid_to": "2026-12-31"},
    )


def test_unit_needs_operate_relation_covering_whole_period(api):
    api.apply(*world())
    api.apply(dept_create())
    # 高新院区 2026-10-01 才开始，运营关系也是
    cr = api.draft(unit_create(code="U1", valid_from="2026-09-01"))
    r = api.submit(cr["id"])
    assert r.status_code == 422
    assert "尚未生效" in r.json()["message"]


def test_unit_and_its_relation_can_come_in_one_request(api):
    api.apply(*world())
    api.apply(
        {
            "kind": "institution.create",
            "code": "PARTNER",
            "valid_from": "2020-01-01",
            "fields": {"name": "合作主体"},
        }
    )
    api.apply(
        dept_create(),
        unit_create(code="U1", inst="PARTNER"),  # 单元在前
        {
            "kind": "operator_relation.create",
            "institution_code": "PARTNER",
            "campus_code": "GX",
            "relation_type": "OPERATE",
            "is_primary": False,
            "valid_from": "2026-11-01",
        },
    )


# ------------------------------------------------------------------ 部门
def test_inactive_department_cannot_be_chosen_but_units_keep_working(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    done = api.apply({"kind": "department.change_status", "code": "XNK", "status": "INACTIVE"})
    assert "U1" in done["outcomes"][0]["after"]["affected_units"]  # 只提示，不处置

    cr = api.draft(unit_create(code="U2"))
    assert "不能被新建或改挂的单元选用" in api.submit(cr["id"]).json()["message"]
    # 已有单元仍可暂停、更名
    api.apply(unit_item("change_status", "U1", "2026-12-01", status="SUSPENDED"))
    rows = api.get("/api/service-units", params={"as_of": "2026-12-01"}).json()
    assert rows[0]["version"]["department_status"] == "INACTIVE"
    # 恢复后又可选用
    api.apply({"kind": "department.change_status", "code": "XNK", "status": "ACTIVE"})
    api.apply(unit_create(code="U2"))


def test_department_code_never_reused_and_rename_recorded(api):
    api.apply(dept_create())
    cr = api.draft(dept_create(name="别的部门"))
    assert "代码永不复用" in api.submit(cr["id"]).json()["message"]
    done = api.apply({"kind": "department.rename", "code": "XNK", "name": "心内科"})
    out = done["outcomes"][0]
    assert (out["before"]["name"], out["after"]["name"]) == ("心血管内科", "心内科")
    dept = api.get("/api/departments").json()[0]
    detail = api.get(f"/api/departments/{dept['id']}").json()
    assert done["id"] in detail["change_ids"]


# ------------------------------------------------------------------ 单元
def test_unit_type_cannot_be_revised(api):
    r = api.post(
        "/api/change-requests",
        {"items": [unit_item("revise", "U1", "2027-01-01", changes={"unit_type": "IPD"})]},
    )
    assert r.status_code == 422


def test_unit_type_must_be_existing_code(api):
    r = api.post("/api/change-requests", {"items": [unit_create(unit_type="MEDTECH")]})
    assert r.status_code == 422


def test_unit_history_and_department_identity_immutable(api, app_engine):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1"))
    with app_engine.connect() as c:
        for sql in (
            "UPDATE service_unit_version SET name = 'x'",
            "UPDATE service_unit SET unit_type = 'IPD'",
            "UPDATE department SET code = 'Y'",
        ):
            with pytest.raises(DBAPIError, match="历史记录不可修改"):
                c.execute(text(sql))
            c.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("DELETE FROM service_unit_version"))
        c.rollback()
