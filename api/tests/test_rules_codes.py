"""D3 外部标识与分类关联的反例。"""

import pytest
from factories import (
    dept_create,
    ext_assign,
    ext_close,
    ext_register,
    setup_ledger,
    unit_create,
    world,
)
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _rejected(api, *items) -> str:
    cr = api.draft(*items)
    r = api.submit(cr["id"])
    assert r.status_code == 422, r.text
    return r.json()["message"]


def test_register_twice_rejected(api):
    setup_ledger(api)
    api.apply(ext_register("01", "内科"))
    assert "已登记过" in _rejected(api, ext_register("01", "内科"))


def test_unknown_namespace_rejected(api):
    setup_ledger(api)
    assert "不存在" in _rejected(api, ext_register("01", namespace="REG"))


def test_assign_before_department_start_rejected(api):
    setup_ledger(api)
    api.apply(dept_create(valid_from="2026-01-01"), ext_register("0301"))
    msg = _rejected(api, ext_assign("0301", department_code="XNK", valid_from="2025-01-01"))
    assert "设立日" in msg


def test_assign_to_retired_unit_must_end(api):
    setup_ledger(api)
    api.apply(
        *world(),
        dept_create(),
        unit_create("U1", "门诊", campus="BY", valid_from="2025-01-01"),
        ext_register("0301"),
    )
    api.apply({"kind": "service_unit.retire", "code": "U1", "valid_to": "2025-12-31"})
    msg = _rejected(api, ext_assign("0301", service_unit_code="U1", valid_from="2025-01-01"))
    assert "永久退出" in msg
    api.apply(
        ext_assign("0301", service_unit_code="U1", valid_from="2025-01-01", valid_to="2025-12-31")
    )


def test_assign_needs_exactly_one_target(api):
    setup_ledger(api)
    item = ext_assign("0301", department_code="XNK") | {"unmodeled_type": "WARD"}
    r = api.post("/api/change-requests", {"items": [item]})
    assert r.status_code == 422


def test_close_assignment_twice_rejected(api):
    setup_ledger(api)
    api.apply(dept_create(), ext_register("0301"), ext_assign("0301", department_code="XNK"))
    page = api.get("/api/external-codes", params={"as_of": "2026-06-01"}).json()
    aid = page["rows"][0]["current"][0]["id"]
    api.apply(ext_close(aid, "2026-06-30"))
    assert "已于" in _rejected(api, ext_close(aid, "2026-07-31"))
    assert (
        api.get("/api/external-codes", params={"as_of": "2026-07-01"}).json()["rows"][0]["status"]
        == "pending"
    )


def test_external_code_row_is_immutable(api, app_engine):
    setup_ledger(api)
    api.apply(ext_register("0301", "心内"))
    with pytest.raises(DBAPIError), app_engine.begin() as c:
        c.execute(text("UPDATE external_code SET source_name = '改名'"))


def test_viewer_cannot_maintain_source_systems(api):
    r = api.as_("viewer").post(
        "/api/dictionary/source-systems", {"code": "HIS", "name": "HIS", "kind": "HIS"}
    )
    assert r.status_code == 403


def test_source_system_code_is_permanent(api):
    ns = setup_ledger(api)
    systems = api.get("/api/source-systems").json()
    sid = systems[0]["id"]
    r = api.as_("maintainer").patch(f"/api/dictionary/source-systems/{sid}", {"code": "HIS2"})
    assert r.status_code == 422
    r = api.as_("maintainer").patch(
        f"/api/dictionary/code-namespaces/{ns['id']}", {"is_active": False}
    )
    assert r.status_code == 200
    assert "已停用" in _rejected(api, ext_register("01"))
