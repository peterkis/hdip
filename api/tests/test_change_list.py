"""变更申请列表（U1）：每行的“对象 · 变化”、项数与构成、业务日期、最近一步、待我确认、我的。

标题与详情页的一句话说明同源（services/describe.py），按当前用户的权限隐去敏感值；
最近一步取真实的操作人，不拿创建人冒充确认人。"""

import json

from factories import assign, change_work_no, dept_create, engagement_end, register, world
from person_helpers import days, engagement_id

from hdip_api.core import permissions


def _row(api, cid, user=None):
    client = api.as_(user) if user else api
    return next(r for r in client.get("/api/change-requests").json() if r["id"] == cid)


def test_single_item_headline_and_dates(api):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    api.apply(*register("P000001", "王芳", "XNK", "2020-01-01"))
    eid = engagement_id(api, "P000001")
    cr = api.draft(engagement_end(eid, days(30)))
    h = _row(api, cr["id"])["headline"]
    assert h["object_kind"] == "person" and h["subject"] == "王芳"
    assert h["change"].startswith("任用") and not h["change"].startswith("“")
    assert h["business_date"] == {"mode": "until", "date": days(30)}
    # 自某日起的变化：日期只在业务日期列，不在标题里重复
    cr = api.draft(dept_create(code="HXNK", name="呼吸内科", valid_from="2026-11-01"))
    row = _row(api, cr["id"])
    assert row["headline"]["business_date"] == {"mode": "from", "date": "2026-11-01"}
    assert "2026-11-01" not in row["headline"]["change"]
    assert row["item_count"] == 1 and row["is_mine"]


def test_multi_item_headline_counts_objects_and_kinds(api):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    items = []
    for code, name in [("P000001", "甲"), ("P000002", "乙"), ("P000003", "丙"), ("P000004", "丁")]:
        items += register(code, name, "XNK", "2020-01-01")
    cr = api.draft(*items)
    row = _row(api, cr["id"])
    h = row["headline"]
    assert h["object_kind"] == "persons"
    assert h["subject"] == "甲、乙、丙 等 4 人"
    assert [k["count"] for k in h["kind_counts"]] == [4, 4]
    assert row["item_count"] == 8
    # 多个对象、多个日期：如实写“多个日期”
    cr = api.draft(
        dept_create(code="A1", name="甲科", valid_from="2026-11-01"),
        dept_create(code="A2", name="乙科", valid_from="2026-12-01"),
    )
    h = _row(api, cr["id"])["headline"]
    assert h["object_kind"] == "department" and h["subject"] == "甲科、乙科"
    assert h["business_date"] == {"mode": "multiple", "date": None}


def test_new_department_mark_is_per_request(api):
    """“（新设）”只标本张申请里新建的部门：之前申请建好的部门在别的申请里不再写“新设”。"""
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    api.apply(*register("P000001", "李娜", None, "2020-01-01"))
    cr = api.draft(assign(engagement_id(api, "P000001"), "XNK", "2026-11-01"))
    assert "新设" not in _row(api, cr["id"])["headline"]["change"]
    cr = api.draft(dept_create(code="HXNK", name="呼吸内科"))
    assert _row(api, cr["id"])["headline"]["change"].startswith("新设部门“呼吸内科”")


def test_last_step_is_the_real_actor_and_waiting_for_me(api):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    maint, conf = api.as_("maintainer"), api.as_("confirmer")
    cr = maint.draft(dept_create(code="HXNK", name="呼吸内科"))
    assert _row(api, cr["id"], "maintainer")["last_step"]["action"] == "create"
    maint.submit(cr["id"])
    row = _row(api, cr["id"], "confirmer")
    assert (
        row["last_step"]["action"] == "submit"
        and row["last_step"]["by"]["username"] == "maintainer"
    )
    assert row["waiting_for_me"] and not row["is_mine"]
    assert not _row(api, cr["id"], "maintainer")["waiting_for_me"]  # 维护人没有确认角色
    conf.confirm(cr["id"])
    row = _row(api, cr["id"], "maintainer")
    assert row["last_step"]["action"] == "confirm"
    assert row["last_step"]["by"]["username"] == "confirmer"  # 不是创建人
    assert row["created_by"]["username"] == "maintainer" and not row["waiting_for_me"]


def test_headline_masks_sensitive_values(api, monkeypatch):
    """列表标题与详情同一规则隐去敏感值（这里临时把工号登记为敏感字段）。"""
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    api.apply(*register("P000001", "张伟", "XNK", "2020-01-01", work_no="S2019001"))
    cr = api.draft(change_work_no(engagement_id(api, "P000001"), "S2019001", "S2024002", days(1)))
    assert "S2024002" in _row(api, cr["id"])["headline"]["change"]  # 一项：标题就是一句话说明
    monkeypatch.setitem(permissions.PERSON_FIELD_PERMISSIONS, "work_no", "person.view_sensitive")
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", {"person.view"})
    raw = json.dumps(_row(api, cr["id"], "viewer"), ensure_ascii=False)
    assert "S2019001" not in raw and "S2024002" not in raw and "（已隐去）" in raw
    assert "S2024002" in json.dumps(_row(api, cr["id"]), ensure_ascii=False)
