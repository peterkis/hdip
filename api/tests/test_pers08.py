"""PERS-08：名册、详情、部门人员区块、两份导出同一日期同一口径，按人去重；
维护 / 确认 / 只读边界；去掉“查看人员”后人员模块整体不可见；
敏感字段统一隐去；登记人员不产生账号。"""

import csv
import io

from factories import dept_create, engage, register, world
from person_helpers import roster
from sqlalchemy import text

from hdip_api.core import permissions


def _csv(api, dataset, day=None, user="solo"):
    params = {"as_of": day} if day else {}
    r = api.as_(user).get(f"/api/export/{dataset}.csv", params=params)
    assert r.status_code == 200, r.text
    return list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))


def _setup(api):
    api.apply(
        *world(),
        dept_create(code="XNK", name="心血管内科"),
        dept_create(code="HXK", name="呼吸内科"),
    )
    api.apply(*register("P000001", "张伟", "XNK", "2020-01-01", work_no="0007"))
    api.apply(*register("P000002", "赵敏", "HXK", "2020-01-01"))
    # 暂未分配主部门的任用
    api.apply(*register("P000003", "李娜", None, "2020-01-01"))


def test_pers08_same_numbers_everywhere(api):
    _setup(api)
    rows = roster(api)
    assert [r["code"] for r in rows] == ["P000001", "P000002", "P000003"]
    persons = _csv(api, "persons")
    relations = _csv(api, "person-relations")
    assert [p["person_code"] for p in persons] == ["P000001", "P000002", "P000003"]
    assert persons[0]["relation_status_name"] == "有效任用"
    by_code = {r["person_code"]: r for r in relations}
    assert by_code["P000001"]["work_no"] == "0007"
    assert by_code["P000001"]["department_name"] == "心血管内科"
    assert by_code["P000003"]["department_code"] == ""  # 暂未分配：部门列为空，不写成离职
    assert by_code["P000001"]["engagement_type_name"] == "合同（人事代理）"

    depts = {d["code"]: d["id"] for d in api.get("/api/departments").json()}
    xnk = api.get(f"/api/departments/{depts['XNK']}/persons").json()
    assert [p["person_code"] for p in xnk] == ["P000001"]
    assert len({r["code"] for r in rows}) == len(persons)


def test_pers08_roles(api):
    api.apply(*world(), dept_create())
    # 只读：能看，不能发起
    assert api.as_("viewer").get("/api/persons").status_code == 200
    r = api.as_("viewer").post("/api/change-requests", {"items": register()})
    assert r.status_code == 403
    r = api.as_("viewer").post(
        "/api/code-reservations",
        {"object_type": "person", "request_key": "viewer-key-1", "count": 1},
    )
    assert r.status_code == 403
    # 维护人：能发起，不能确认（确认人角色才能确认）
    cr = api.as_("maintainer").draft(*register())
    assert api.as_("maintainer").submit(cr["id"]).status_code == 200
    assert api.as_("maintainer").confirm(cr["id"]).status_code == 403
    assert api.as_("confirmer").confirm(cr["id"]).status_code == 200


def test_pers08_registering_a_person_creates_no_account(api, owner_engine):
    with owner_engine.connect() as c:
        users_before = c.scalar(text("SELECT count(*) FROM app_user"))
    _setup(api)
    with owner_engine.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM app_user")) == users_before


def test_pers08_without_person_view(api, monkeypatch):
    _setup(api)
    cr = api.draft(engage("P000002", "XNK", "2030-01-01", inst="CD3"))  # 草稿含人员变更项
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", set())  # 这个角色看不到人员模块
    viewer = api.as_("viewer")
    assert viewer.get("/api/persons").status_code == 403
    assert viewer.get(f"/api/change-requests/{cr['id']}").status_code == 404
    listed = [c["id"] for c in viewer.get("/api/change-requests").json()]
    assert cr["id"] not in listed and listed  # 其他申请照常可见
    assert viewer.get("/api/export/persons.csv").status_code == 403
    me = viewer.get("/api/me").json()
    assert "person.view" not in me["permissions"]


def test_pers08_sensitive_fields_are_masked(api, monkeypatch):
    """工号不是敏感字段；这里临时把它登记为敏感字段，验证统一隐去的机制（身份证号、电话将来照此）。"""
    _setup(api)
    monkeypatch.setitem(permissions.PERSON_FIELD_PERMISSIONS, "work_no", "person.view_sensitive")
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", {"person.view", "person.export"})
    viewer = api.as_("viewer")
    row = next(r for r in roster(viewer) if r["code"] == "P000001")
    assert row["engagements"][0]["work_no"] is None and row["masked_fields"] == ["work_no"]
    detail = viewer.get(f"/api/persons/{row['id']}").json()
    assert detail["engagements"][0]["work_nos"][0]["work_no"] is None
    assert _csv(api, "person-relations", user="viewer")[0]["work_no"] == ""
    # 有权限的人照常看到
    assert (
        next(r for r in roster(api) if r["code"] == "P000001")["engagements"][0]["work_no"]
        == "0007"
    )
