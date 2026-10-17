"""约束与流程规则。"""

import pytest
from factories import campus_create, change_status, inst_create, relation_create
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _problem(resp):
    assert resp.status_code == 422, resp.text
    return resp.json()["problems"][0]["message"]


# ------------------------------------------------------------------ 硬约束 1：代码永不复用
def test_code_cannot_be_reused(api):
    api.apply(inst_create(), campus_create())
    cr = api.draft(campus_create(name="另一个院区"))
    assert "已被使用" in _problem(api.submit(cr["id"]))


def test_invalid_code_rejected_at_input(api):
    r = api.post("/api/change-requests", {"items": [campus_create(code="高新")]})
    assert r.status_code == 422


# ------------------------------------------------------------------ 硬约束 2：不覆盖历史
def test_history_rows_are_immutable_in_database(api, app_engine):
    api.apply(inst_create())
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="历史记录不可修改"):
            c.execute(text("UPDATE institution_version SET name = 'x'"))
        c.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            c.execute(text("DELETE FROM institution_version"))
        c.rollback()
        with pytest.raises(DBAPIError, match="历史记录不可修改"):
            c.execute(text("UPDATE institution SET code = 'X'"))
        c.rollback()


def test_confirmed_request_cannot_be_changed(api, app_engine):
    cr = api.apply(inst_create())
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="已结束"):
            c.execute(text("UPDATE change_request SET note = 'x' WHERE id = :i"), {"i": cr["id"]})


def test_revise_creates_new_version_and_keeps_old(api):
    api.apply(inst_create())
    api.apply(
        {
            "kind": "institution.revise",
            "code": "CD3",
            "effective_date": "2026-01-01",
            "changes": {"license_no": "PDY-001"},
        }
    )
    inst = api.get("/api/institutions", params={"as_of": "2025-06-01"}).json()[0]
    assert inst["version"]["license_no"] is None
    assert inst["has_later_versions"] is True
    detail = api.get(f"/api/institutions/{inst['id']}").json()
    assert [v["version_no"] for v in detail["versions"]] == [2, 1]
    assert detail["versions"][1]["valid_to"] == "2025-12-31"


def test_revise_effective_date_must_be_after_current_start(api):
    api.apply(inst_create(valid_from="2026-01-01"))
    cr = api.draft(
        {
            "kind": "institution.revise",
            "code": "CD3",
            "effective_date": "2026-01-01",
            "changes": {"name": "新名称"},
        }
    )
    assert "生效日须晚于" in _problem(api.submit(cr["id"]))


def test_revise_without_real_change_rejected(api):
    api.apply(inst_create())
    cr = api.draft(
        {
            "kind": "institution.revise",
            "code": "CD3",
            "effective_date": "2026-01-01",
            "changes": {"name": "成都市第三人民医院"},
        }
    )
    assert "没有变化" in _problem(api.submit(cr["id"]))


# ------------------------------------------------------------------ 运营关系
def test_only_one_primary_operator_per_campus(api):
    api.apply(
        inst_create(),
        inst_create(code="OTHER", name="另一法人"),
        campus_create(),
        relation_create(),
    )
    cr = api.draft(relation_create(inst="OTHER", valid_from="2026-12-01"))
    assert "已有主要运营方" in _problem(api.submit(cr["id"]))


def test_primary_must_be_operate_type(api):
    api.apply(inst_create(), campus_create())
    cr = api.draft(relation_create(type_="CHARGE", primary=True))
    assert "运营" in _problem(api.submit(cr["id"]))


def test_switch_primary_operator_by_close_then_create(api):
    api.apply(
        inst_create(),
        inst_create(code="OTHER", name="另一法人"),
        campus_create(),
        relation_create(),
    )
    rel_id = api.get("/api/operator-relations", params={"as_of": "2026-10-15"}).json()[0]["id"]
    api.apply(
        {"kind": "operator_relation.close", "relation_id": rel_id, "valid_to": "2026-12-31"},
        relation_create(inst="OTHER", valid_from="2027-01-01"),
    )
    rows = api.get("/api/campuses", params={"as_of": "2027-01-01"}).json()
    assert rows[0]["primary_operator"]["code"] == "OTHER"
    rows = api.get("/api/campuses", params={"as_of": "2026-12-31"}).json()
    assert rows[0]["primary_operator"]["code"] == "CD3"
    # 已结束的关系不能再改
    cr = api.draft(
        {"kind": "operator_relation.close", "relation_id": rel_id, "valid_to": "2026-11-30"}
    )
    assert "已于" in _problem(api.submit(cr["id"]))


def test_relation_requires_campus_effective(api):
    api.apply(inst_create(), campus_create(valid_from="2026-10-01"))
    cr = api.draft(relation_create(valid_from="2026-09-01"))
    assert "才有记录" in _problem(api.submit(cr["id"]))


# ------------------------------------------------------------------ 运营状态
def test_operating_status_only_moves_forward(api):
    api.apply(inst_create(), campus_create(), change_status(status="RUNNING"))
    cr = api.draft(change_status(status="TRIAL_RUNNING", effective_date="2026-12-01"))
    assert "只能按" in _problem(api.submit(cr["id"]))


def test_suspended_campus_cannot_change_status(api):
    api.apply(inst_create(), campus_create(), change_status(status="SUSPENDED"))
    cr = api.draft(change_status(status="RUNNING", effective_date="2026-12-01"))
    assert "已停用" in _problem(api.submit(cr["id"]))


def test_campus_public_name(api):
    """对外名称随版本走，可修订；只填空白被拒（节点角色已停用，改用对外名称）。"""
    zx = campus_create(code="ZX", name="中心院区", public_name="成都市中心医院")
    api.apply(inst_create(), zx)
    row = api.get("/api/campuses", params={"as_of": "2026-12-01"}).json()[0]
    assert row["version"]["public_name"] == "成都市中心医院"
    assert row["version"]["node_role"] is None
    csv = api.get("/api/export/campuses.csv", params={"as_of": "2026-12-01"}).text
    assert csv.splitlines()[0].endswith(",public_name")
    cr = api.draft(campus_create(code="KB", name="空白院区", public_name="  "))
    assert "对外名称" in _problem(api.submit(cr["id"]))


def test_unknown_node_role_rejected(api):
    cr = api.draft(campus_create(node_role="MOON"))
    assert "可选范围" in _problem(api.submit(cr["id"]))


# ------------------------------------------------------------------ 申请流
def test_request_is_atomic_at_confirm(api):
    """两张都已提交的申请互相冲突：先确认的生效，后确认的整张不成立（含其中无冲突的项）。"""
    api.apply(inst_create(), inst_create(code="OTHER", name="另一法人"), campus_create())
    a = api.draft(relation_create())
    b = api.draft(
        {
            "kind": "campus.revise",
            "code": "GX",
            "effective_date": "2026-10-10",
            "changes": {"phone": "028-1234"},
        },
        relation_create(inst="OTHER"),
    )
    assert api.submit(a["id"]).status_code == 200
    assert api.submit(b["id"]).status_code == 200
    assert api.confirm(a["id"]).status_code == 200
    r = api.confirm(b["id"])
    assert "第 2 项" in r.json()["message"]
    assert r.status_code == 422
    campus = api.get("/api/campuses").json()[0]
    detail = api.get(f"/api/campuses/{campus['id']}").json()
    assert len(detail["versions"]) == 1  # 第 1 项的修订也没有生效
    assert api.get(f"/api/change-requests/{b['id']}").json()["status"] == "submitted"


def test_self_confirm_can_be_disabled_by_rule(api, owner_engine):
    with owner_engine.begin() as c:
        c.execute(
            text(
                "UPDATE approval_rule SET allow_self_confirm = false "
                "WHERE object_type = 'institution' AND action = 'create'"
            )
        )
    cr = api.draft(inst_create())
    assert api.submit(cr["id"]).status_code == 200
    r = api.confirm(cr["id"])
    assert r.status_code == 403
    assert "其他确认人" in r.json()["message"]
    assert api.as_("confirmer").confirm(cr["id"]).status_code == 200


def test_viewer_cannot_create(api):
    r = api.as_("viewer").post("/api/change-requests", {"items": [inst_create()]})
    assert r.status_code == 403


def test_missing_user_rejected(client):
    assert client.get("/api/institutions").status_code == 401


def test_return_requires_reason_and_copy_makes_new_draft(api):
    cr = api.as_("maintainer").draft(inst_create())
    api.as_("maintainer").submit(cr["id"])
    r = api.as_("confirmer").post(f"/api/change-requests/{cr['id']}/return", {"reason": "  "})
    assert r.status_code == 422
    r = api.as_("confirmer").post(f"/api/change-requests/{cr['id']}/return", {"reason": "名称有误"})
    assert r.json()["status"] == "returned"
    assert r.json()["return_reason"] == "名称有误"
    new = api.as_("maintainer").post(f"/api/change-requests/{cr['id']}/copy").json()
    assert new["status"] == "draft"
    assert new["copied_from_id"] == cr["id"]
    assert new["items"] == r.json()["items"]


def test_only_creator_can_edit_draft(api):
    cr = api.as_("maintainer").draft(inst_create())
    r = api.as_("solo").put(f"/api/change-requests/{cr['id']}", {"items": [inst_create()]})
    assert r.status_code == 403


def test_cancel_draft(api):
    cr = api.draft(inst_create())
    r = api.post(f"/api/change-requests/{cr['id']}/cancel")
    assert r.json()["status"] == "cancelled"
    assert api.submit(cr["id"]).status_code == 409


def test_patch_null_clears_field(api):
    api.apply(inst_create(license_no="X1"))
    api.apply(
        {
            "kind": "institution.revise",
            "code": "CD3",
            "effective_date": "2026-01-01",
            "changes": {"license_no": None},
        }
    )
    inst = api.get("/api/institutions", params={"as_of": "2026-02-01"}).json()[0]
    assert inst["version"]["license_no"] is None


def test_audit_timestamps_have_no_timezone(api):
    cr = api.apply(inst_create())
    for key in ("created_at", "submitted_at", "confirmed_at"):
        assert "+" not in cr[key] and not cr[key].endswith("Z")


# ------------------------------------------------------------------ 第 ① 步复查后补的反例
def test_relation_close_info_written_once(api, app_engine):
    api.apply(inst_create(), campus_create(), relation_create())
    rel_id = api.get("/api/operator-relations", params={"as_of": "2026-10-01"}).json()[0]["id"]
    api.apply({"kind": "operator_relation.close", "relation_id": rel_id, "valid_to": "2026-12-31"})
    with app_engine.connect() as c:
        for sql in (
            "UPDATE operator_relation SET closed_by = closed_by + 1",
            "UPDATE operator_relation SET closed_at = closed_at + interval '1 day'",
            "UPDATE operator_relation SET valid_to = '2027-01-31'",
        ):
            with pytest.raises(DBAPIError, match="不可修改|只能在结束时写入一次"):
                c.execute(text(sql))
            c.rollback()


def test_open_relation_close_info_needs_valid_to(api, app_engine):
    api.apply(inst_create(), campus_create(), relation_create())
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError, match="只能在结束时写入一次"):
            c.execute(text("UPDATE operator_relation SET closed_at = LOCALTIMESTAMP"))
        c.rollback()


def test_campus_cannot_be_created_suspended(api):
    r = api.post("/api/change-requests", {"items": [campus_create(status="SUSPENDED")]})
    assert r.status_code == 422


def test_return_follows_approval_rule(api, owner_engine):
    with owner_engine.begin() as c:
        c.execute(
            text(
                "UPDATE approval_rule SET confirmer_role = 'maintainer' "
                "WHERE object_type = 'institution' AND action = 'create'"
            )
        )
    try:
        cr = api.as_("maintainer").draft(inst_create())
        api.as_("maintainer").submit(cr["id"])
        got = api.as_("maintainer").get(f"/api/change-requests/{cr['id']}").json()
        assert got["permissions"]["can_return"] is True
        assert (
            api.as_("confirmer")
            .get(f"/api/change-requests/{cr['id']}")
            .json()["permissions"]["can_return"]
            is False
        )
        r = api.as_("confirmer").post(f"/api/change-requests/{cr['id']}/return", {"reason": "x"})
        assert r.status_code == 403
        r = api.as_("maintainer").post(f"/api/change-requests/{cr['id']}/return", {"reason": "x"})
        assert r.json()["status"] == "returned"
    finally:
        with owner_engine.begin() as c:
            c.execute(text("UPDATE approval_rule SET confirmer_role = 'confirmer'"))


def test_status_error_message_is_chinese(api):
    cr = api.draft(inst_create())
    api.post(f"/api/change-requests/{cr['id']}/cancel")
    r = api.submit(cr["id"])
    assert r.status_code == 409
    assert "已撤销" in r.json()["message"]


def test_draft_items_round_trip_keeps_only_written_fields(api):
    """草稿取回后原样回传（如再加一项），修订项里没写的字段不能变成“清空”。"""
    from factories import dept_create

    api.apply(dept_create())
    revise = {
        "kind": "department.revise",
        "code": "XNK",
        "effective_date": "2026-03-01",
        "changes": {"name": "心血管内科（新）"},
    }
    cr = api.draft(revise)
    assert cr["items"][0]["changes"] == {"name": "心血管内科（新）"}
    alias = {
        "kind": "department.alias_add",
        "code": "XNK",
        "value": "心内科",
        "valid_from": "2026-03-01",
    }
    r = api.put(f"/api/change-requests/{cr['id']}", {"items": [*cr["items"], alias], "note": None})
    assert r.status_code == 200, r.text
    assert api.submit(cr["id"]).status_code == 200


# ------------------------------------------------------------------ 未生效版本的更正
def _campus_revise(code, day, **changes):
    return {"kind": "campus.revise", "code": code, "effective_date": day, "changes": changes}


def test_future_version_can_be_corrected_on_its_start_date(api):
    """尚未生效的版本可在开始日当天更正：原版本成为空期间（保留），新版本自同一天起。"""
    api.apply(inst_create(), campus_create(code="ZX", name="中心院区", valid_from="2030-01-01"))
    api.apply(_campus_revise("ZX", "2030-01-01", public_name="成都市中心医院"))
    rows = api.get("/api/campuses", params={"as_of": "2030-01-01"}).json()
    zx = next(r for r in rows if r["code"] == "ZX")
    assert zx["version"]["public_name"] == "成都市中心医院"
    assert zx["version"]["version_no"] == 2
    # 查看日期在开始日之前：仍以“计划版本”显示更正后的内容
    early = api.get("/api/campuses", params={"as_of": "2029-06-01"}).json()
    zx = next(r for r in early if r["code"] == "ZX")
    assert zx["not_yet_effective"] and zx["version"]["public_name"] == "成都市中心医院"
    detail = api.get(f"/api/campuses/{zx['id']}", params={"as_of": "2030-01-01"}).json()
    void = next(v for v in detail["versions"] if v["version_no"] == 1)
    assert void["valid_to"] == "2029-12-31"  # 空期间：从未生效


def test_effective_version_cannot_be_corrected_on_its_start_date(api):
    api.apply(inst_create(), campus_create(valid_from="2020-01-01"))
    cr = api.draft(_campus_revise("GX", "2020-01-01", public_name="某某"))
    assert "须晚于当前版本的开始日" in _problem(api.submit(cr["id"]))


def test_corrected_campus_still_carries_units(api):
    """更正院区的未生效版本后，挂在它上面的单元仍然成立（空期间不当作停用或断档）。"""
    from factories import dept_create, unit_create

    api.apply(
        inst_create(),
        campus_create(code="ZX", name="中心院区", valid_from="2030-01-01", status="PLANNING"),
        relation_create(campus="ZX", valid_from="2030-01-01"),
        dept_create(),
        unit_create(code="ZX-OPD", campus="ZX", valid_from="2030-01-01"),
    )
    api.apply(_campus_revise("ZX", "2030-01-01", phone="028-1"))
    units = api.get("/api/service-units", params={"as_of": "2030-02-01"}).json()
    assert [u["code"] for u in units] == ["ZX-OPD"]
