"""敏感字段在申请页与派生文字里的隐去（人员设计第 10.3 节待办）。

工号不是敏感字段；这里临时把它登记为敏感字段（与 test_pers08 同法），验证机制：
无权查看的人看申请时，变更项、前后内容、一句话说明、行内片段、提示里都看不到值；
人员详情的“结束日调整记录”、提交被拒时的问题说明同样隐去；含看不到的值的草稿不能由他编辑。身份证号、电话将来照此。"""

import json

from factories import change_work_no, dept_create, engagement_end, register, world
from person_helpers import days, engagement_id, person

from hdip_api.core import permissions

OLD, NEW = "S2019001", "S2024002"


def _setup(api, monkeypatch):
    api.apply(*world(), dept_create(code="XNK", name="心血管内科"))
    cr = api.draft(*register("P000001", "张伟", "XNK", "2020-01-01", work_no=OLD))
    api.submit(cr["id"])
    api.confirm(cr["id"])
    monkeypatch.setitem(permissions.PERSON_FIELD_PERMISSIONS, "work_no", "person.view_sensitive")
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", {"person.view"})
    return cr["id"]


def _text(api, cid):
    r = api.get(f"/api/change-requests/{cid}")
    assert r.status_code == 200, r.text
    return r.json(), json.dumps(r.json(), ensure_ascii=False)


def test_confirmed_request_is_masked_for_viewer(api, monkeypatch):
    cid = _setup(api, monkeypatch)
    body, raw = _text(api.as_("viewer"), cid)
    assert OLD not in raw
    assert body["masked_fields"] == ["work_no"]
    engage = next(i for i in body["items"] if i["kind"] == "person.engage")
    assert engage["work_no"] is None
    # 有权限的人照常看到
    body, raw = _text(api, cid)
    assert OLD in raw and body["masked_fields"] == []


def test_draft_texts_and_views_are_masked(api, monkeypatch):
    _setup(api, monkeypatch)
    eid = engagement_id(api, "P000001")
    cr = api.draft(change_work_no(eid, OLD, NEW, days(1)))
    body, raw = _text(api.as_("viewer"), cr["id"])
    assert OLD not in raw and NEW not in raw
    assert "（已隐去）" in " ".join(body["item_summaries"])
    assert body["items"][0]["expected_work_no"] is None and body["items"][0]["work_no"] is None
    _, raw = _text(api, cr["id"])
    assert OLD in raw and NEW in raw


def test_end_change_history_is_masked(api, monkeypatch):
    _setup(api, monkeypatch)
    eid = engagement_id(api, "P000001")
    api.apply(engagement_end(eid, days(30)))
    viewer = api.as_("viewer")
    detail = person(viewer, "P000001")
    [change] = detail["engagements"][0]["end_changes"]
    handled = " ".join(change["handled"])
    assert "工号" in handled and OLD not in handled and "（已隐去）" in handled
    assert OLD in " ".join(person(api, "P000001")["engagements"][0]["end_changes"][0]["handled"])


def test_draft_with_hidden_values_cannot_be_edited(api, monkeypatch):
    _setup(api, monkeypatch)
    eid = engagement_id(api, "P000001")
    # 能维护人员、但无权查看敏感字段的维护人
    monkeypatch.setitem(
        permissions.ROLE_PERMISSIONS,
        "maintainer",
        {"change.create", "person.change", "person.view"},
    )
    maint = api.as_("maintainer")
    cr = maint.draft(change_work_no(eid, OLD, NEW, days(1)))
    body, _ = _text(maint, cr["id"])
    assert body["items"][0]["work_no"] is None
    r = maint.put(f"/api/change-requests/{cr['id']}", {"items": body["items"], "note": "改"})
    assert r.status_code == 403 and "敏感信息" in r.json()["message"]
    # 草稿内容没被清空
    _, raw = _text(api, cr["id"])
    assert NEW in raw


def test_rejection_messages_are_masked(api, monkeypatch):
    """提交被拒时的问题说明同样隐去（换号与库里的工号不一致）。"""
    _setup(api, monkeypatch)
    eid = engagement_id(api, "P000001")
    monkeypatch.setitem(
        permissions.ROLE_PERMISSIONS,
        "maintainer",
        {"change.create", "person.change", "person.view"},
    )
    maint = api.as_("maintainer")
    cr = maint.draft(change_work_no(eid, "S1999999", NEW, days(1)))  # 预期工号与库里不一致
    r = maint.submit(cr["id"])
    assert r.status_code == 422, r.text
    raw = json.dumps(r.json(), ensure_ascii=False)
    assert OLD not in raw and "S1999999" not in raw and "（已隐去）" in raw
    # 有权限的人看到原值
    monkeypatch.setitem(
        permissions.ROLE_PERMISSIONS,
        "maintainer",
        {"change.create", "person.change", "person.view", "person.view_sensitive"},
    )
    raw = json.dumps(maint.submit(cr["id"]).json(), ensure_ascii=False)
    assert OLD in raw
