"""草稿写入的请求键（迁移 0022，U3.1 遗留 R01-1）：重试不重复建草稿、不重复追加变更项。"""

from factories import dept_create, world


def _create(api, items, key, note=None):
    return api.post("/api/change-requests", {"items": items, "note": note, "request_key": key})


def _drafts(api):
    return [c for c in api.get("/api/change-requests?status=draft").json()]


def test_retry_create_returns_same_draft(api):
    api.apply(*world())
    item = dept_create(code="A", name="甲科")
    first = _create(api, [item], "key-create-0001")
    assert first.status_code == 200, first.text
    again = _create(api, [item], "key-create-0001")
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    assert [d["id"] for d in _drafts(api)] == [first.json()["id"]]


def test_retry_append_does_not_duplicate_items(api):
    """前端“加入已有草稿”是读取草稿后整体 PUT；响应丢失后重读草稿再追加，同一键不会再写一遍。"""
    api.apply(*world())
    cr = api.draft(dept_create(code="A", name="甲科"))
    new = dept_create(code="B", name="乙科")
    body = {"items": [*cr["items"], new], "note": cr["note"], "request_key": "key-append-0001"}
    r = api.put(f"/api/change-requests/{cr['id']}", body)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 2
    # 重试：按已更新的草稿再追加一次（重复的“乙科”）
    stale = api.get(f"/api/change-requests/{cr['id']}").json()
    retry = {
        "items": [*stale["items"], new],
        "note": stale["note"],
        "request_key": "key-append-0001",
    }
    r2 = api.put(f"/api/change-requests/{cr['id']}", retry)
    assert r2.status_code == 200, r2.text
    assert len(r2.json()["items"]) == 2


def test_key_is_per_user(api):
    api.apply(*world())
    item = dept_create(code="A", name="甲科")
    mine = _create(api, [item], "key-shared-0001").json()
    other = _create(
        api.as_("maintainer"), [dept_create(code="B", name="乙科")], "key-shared-0001"
    ).json()
    assert mine["id"] != other["id"]


def test_key_reused_for_another_write_is_rejected(api):
    api.apply(*world())
    cr = _create(api, [dept_create(code="A", name="甲科")], "key-reuse-0001").json()
    other = api.draft(dept_create(code="B", name="乙科"))
    body = {"items": other["items"], "note": None, "request_key": "key-reuse-0001"}
    r = api.put(f"/api/change-requests/{other['id']}", body)
    assert r.status_code == 409
    assert f"已用于申请 #{cr['id']}" in r.json()["message"]


def test_failed_write_does_not_consume_key(api):
    """校验未通过、整体回滚的写入不登记请求键，改好后用同一个键再保存照常写入。"""
    api.apply(*world())
    api.apply(dept_create(code="A", name="甲科"))
    cr = api.draft(dept_create(code="B", name="乙科"))
    api.cancel(cr["id"])
    bad = api.put(
        f"/api/change-requests/{cr['id']}",
        {"items": cr["items"], "note": None, "request_key": "key-retry-0001"},
    )
    assert bad.status_code in (409, 422)
    ok = _create(api, [dept_create(code="C", name="丙科")], "key-retry-0001")
    assert ok.status_code == 200, ok.text


def test_without_key_behaves_as_before(api):
    """不带请求键：每次都新建（与迁移 0022 之前一致）。"""
    api.apply(*world())
    a = api.post(
        "/api/change-requests", {"items": [dept_create(code="A", name="甲科")], "note": None}
    )
    b = api.post(
        "/api/change-requests", {"items": [dept_create(code="B", name="乙科")], "note": None}
    )
    assert a.status_code == b.status_code == 200
    assert a.json()["id"] != b.json()["id"]
