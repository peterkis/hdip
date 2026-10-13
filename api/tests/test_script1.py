"""验收剧本 1：登记高新院区（筹建），绑定运营主体，变更运营状态。提交与确认分别留痕。"""

from factories import campus_create, change_status, inst_create, relation_create


def test_script1_register_campus_bind_operator_change_status(api):
    # 主体已存在（初始导入也是一张申请）
    api.apply(inst_create())

    # 一张申请：新建院区（筹建）+ 建立主要运营关系；后一项引用前一项新建的院区代码
    cr = api.as_("maintainer").draft(campus_create(), relation_create(), note="高新院区登记")
    assert cr["status"] == "draft"
    assert cr["permissions"]["can_submit"]
    # 预演显示前后差异，但尚未写入
    assert [o["label"] for o in cr["outcomes"]] == ["新建院区", "建立运营关系"]
    assert api.get("/api/campuses", params={"as_of": "2026-10-15"}).json() == []

    r = api.as_("maintainer").submit(cr["id"])
    assert r.status_code == 200, r.text
    submitted = r.json()
    assert submitted["submitted_by"]["username"] == "maintainer"
    # 维护人不能确认
    assert not submitted["permissions"]["can_confirm"]
    assert api.as_("maintainer").confirm(cr["id"]).status_code == 403

    r = api.as_("confirmer").confirm(cr["id"])
    assert r.status_code == 200, r.text
    confirmed = r.json()
    assert confirmed["status"] == "confirmed"
    assert confirmed["confirmed_by"]["username"] == "confirmer"
    assert confirmed["submitted_at"] <= confirmed["confirmed_at"]
    assert confirmed["outcomes"][0]["after"]["operating_status"] == "PLANNING"

    rows = api.get("/api/campuses", params={"as_of": "2026-10-15"}).json()
    assert len(rows) == 1
    gx = rows[0]
    assert gx["code"] == "GX"
    assert gx["version"]["operating_status"] == "PLANNING"
    assert gx["primary_operator"]["code"] == "CD3"

    # 变更运营状态：11-01 起试运行
    api.apply(change_status(effective_date="2026-11-01"))

    def status_on(day):
        return api.get("/api/campuses", params={"as_of": day}).json()[0]["version"][
            "operating_status"
        ]

    assert status_on("2026-10-31") == "PLANNING"  # 闭区间：10-31 当天仍是旧版
    assert status_on("2026-11-01") == "TRIAL_RUNNING"

    detail = api.get(f"/api/campuses/{gx['id']}").json()
    v2, v1 = detail["versions"]
    assert (v1["valid_from"], v1["valid_to"]) == ("2026-10-01", "2026-10-31")
    assert (v2["valid_from"], v2["valid_to"]) == ("2026-11-01", None)
    assert v1["change_id"] != v2["change_id"]
    assert len(detail["relations"]) == 1


def test_campus_list_shows_planned_campus_before_it_starts(api):
    api.apply(inst_create(), campus_create(valid_from="2027-01-01"))
    rows = api.get("/api/campuses", params={"as_of": "2026-12-01"}).json()
    assert rows[0]["not_yet_effective"] is True
