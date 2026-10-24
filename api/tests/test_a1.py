"""A1 部门任职台账与共享收尾（docs/人员域边界复审与实施计划.md 第 4 节，验收样例 A1-01～07）：
- 台账一行一条职务，附此人当天的主部门；代管时任职部门与主部门不同；三处同源；
- 记录数与去重人数；计划中的另计，不计入当天；
- 任用推后时职务不随之延长；
- 任命、交接须写依据，旧记录没有依据照常显示；
- 名册导出带上页面筛选，与页面人数一致；数据集不支持的筛选被拒；
- 没有查看 / 导出权限时服务端拒绝。"""

import csv
import io

from factories import dept_create, duty_assign, duty_handover, engagement_end, register, world
from person_helpers import days, dept_id, engagement_id, notices, person, roster
from sqlalchemy import text

from hdip_api.core import permissions
from hdip_api.schemas.items import ITEMS_ADAPTER


def _setup(api):
    api.apply(
        *world(),
        dept_create(code="YWB", name="医务部"),
        dept_create(code="YGB", name="院感部"),
        dept_create(code="XNK", name="心血管内科"),
    )
    for code, name, dept in [
        ("P000001", "甲", "YWB"),
        ("P000002", "乙", "YWB"),
        ("P000003", "丙", "YGB"),
        ("P000004", "丁", "XNK"),
    ]:
        api.apply(*register(code, name, dept, "2020-01-01"))
    return {c: engagement_id(api, c) for c in ("P000001", "P000002", "P000003", "P000004")}


def _register(api, **params):
    r = api.get("/api/person-duties", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _csv(api, dataset, **params):
    r = api.get(f"/api/export/{dataset}.csv", params=params)
    assert r.status_code == 200, r.text
    return list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))


def _leader(reg, code):
    row = next(x for x in reg["leaders"] if x["department"]["code"] == code)
    return [(h["label"], h["person_name"]) for h in row["heads"]]


def test_a1_01_caretaker_and_primary_department(api):
    e = _setup(api)
    api.apply(duty_assign(e["P000002"], "YGB", "HEAD", "CARETAKER", "2025-01-01"))
    reg = _register(api, q="乙")
    [row] = reg["rows"]
    assert row["department"]["code"] == "YGB" and row["primary_department"]["code"] == "YWB"
    assert row["label"] == "代管" and row["basis_note"] == "院发〔2020〕1 号"
    # 人员页、部门页、台账三处同源
    detail = person(api, "P000002")
    assert [(d["id"], d["department"]["code"]) for d in detail["engagements"][0]["duties"]] == [
        (row["duty_id"], "YGB")
    ]
    dept_rows = api.get(f"/api/departments/{dept_id(api, 'YGB')}/duties").json()
    assert [d["duty_id"] for d in dept_rows] == [row["duty_id"]]
    assert _leader(reg, "YGB") == [("代管", "乙")]
    # 负责人一览列出全部正式履职的部门：没有部长职务的显示空缺
    assert _leader(reg, "XNK") == [] and _leader(reg, "YWB") == []


def test_a1_02_one_person_two_duties(api):
    e = _setup(api)
    api.apply(
        duty_assign(e["P000001"], "YWB", "HEAD"),
        duty_assign(e["P000001"], "XNK", "DEPUTY"),
        duty_assign(e["P000003"], "YGB", "DEPUTY"),
    )
    reg = _register(api, q="甲")
    assert (reg["record_count"], reg["person_count"]) == (2, 1)
    reg = _register(api)
    assert (reg["record_count"], reg["person_count"]) == (3, 2)
    assert {r["department"]["code"] for r in _register(api, duty="DEPUTY")["rows"]} == {
        "XNK",
        "YGB",
    }
    # q 也匹配任职部门名称；部门筛选只看任职部门
    assert [r["person_code"] for r in _register(api, q="院感")["rows"]] == ["P000003"]
    assert [
        r["person_code"] for r in _register(api, department_id=dept_id(api, "XNK"))["rows"]
    ] == ["P000001"]
    # 导出与台账同筛选、同粒度
    rows = _csv(api, "person-duties", q="甲")
    assert [(r["department_code"], r["label"], r["name"]) for r in rows] == [
        (r["department"]["code"], r["label"], r["person_name"])
        for r in _register(api, q="甲")["rows"]
    ]


def test_a1_03_extending_engagement_does_not_extend_duty(api):
    e = _setup(api)
    eid = e["P000004"]
    api.apply(engagement_end(eid, days(30)))
    api.apply(duty_assign(eid, "XNK", "DEPUTY", valid_from="2024-01-01"))
    [duty] = _register(api, q="丁")["rows"]
    assert duty["valid_to"] == days(30)  # 未写结束日时到任用结束

    cr = api.draft(engagement_end(eid, days(60), expected=days(30)))
    assert any("职务不随任用延长，续任请另行登记" in n for n in notices(cr))
    api.submit(cr["id"])
    api.confirm(cr["id"])
    detail = person(api, "P000004")
    eng = detail["engagements"][0]
    assert eng["valid_to"] == days(60)
    assert eng["assignments"][0]["valid_to"] == days(60)  # 归属照常随之延长
    assert eng["duties"][0]["valid_to"] == days(30)  # 职务不变


def test_a1_04_basis_required_for_new_duties(api, owner_engine):
    e = _setup(api)
    for item in (
        duty_assign(e["P000001"], "YWB", basis_note=None),
        duty_assign(e["P000001"], "YWB", basis_note="   "),
    ):
        cr = api.draft(item)
        r = api.submit(cr["id"])
        assert r.status_code == 422
        [p] = r.json()["problems"]
        assert p["field"] == "basis_note" and "任职依据" in p["message"]
        api.cancel(cr["id"])

    api.apply(duty_assign(e["P000001"], "YWB"))
    head = _register(api)["rows"][0]
    cr = api.draft(duty_handover(head["duty_id"], e["P000002"], days(5), basis_note=None))
    r = api.submit(cr["id"])
    assert r.status_code == 422 and r.json()["problems"][0]["field"] == "basis_note"
    api.cancel(cr["id"])
    # 交接带依据：接任者的职务记下交接依据；结束职务的依据选填
    api.apply(duty_handover(head["duty_id"], e["P000002"], days(5)))
    nxt = _register(api, include_future=True, q="乙")["rows"][0]
    assert nxt["basis_note"] == "院发〔2026〕2 号" and nxt["not_yet_effective"]

    # A1 之前的申请 JSON（没有 basis_note）照常解析
    old = {k: v for k, v in duty_assign(e["P000003"], "YGB").items() if k != "basis_note"}
    assert ITEMS_ADAPTER.validate_python([old])[0].basis_note is None
    # A1 之前登记的职务没有依据：台账照常显示，依据为空
    with owner_engine.begin() as c:
        c.execute(text("ALTER TABLE person_duty DISABLE TRIGGER person_duty_guard"))
        c.execute(
            text("UPDATE person_duty SET basis_note = NULL WHERE id = :id"), {"id": head["duty_id"]}
        )
        c.execute(text("ALTER TABLE person_duty ENABLE TRIGGER person_duty_guard"))
    row = next(r for r in _register(api)["rows"] if r["duty_id"] == head["duty_id"])
    assert row["basis_note"] is None
    assert _csv(api, "person-duties")[0]["basis_note"] == ""


def test_a1_05_exports_follow_page_filters(api):
    _setup(api)
    xnk = dept_id(api, "XNK")
    api.apply(*register("P000005", "戊", "XNK", days(10)))  # 计划中的人
    for params in (
        {},
        {"department_id": xnk},
        {"department_id": xnk, "include_future": True},
        {"status": "PLANNED"},
        {"q": "丁"},
    ):
        page = roster(api, **params)
        persons = _csv(api, "persons", **params)
        relations = _csv(api, "person-relations", **params)
        assert [p["person_code"] for p in persons] == [r["code"] for r in page]
        assert sorted({r["person_code"] for r in relations}) == sorted(r["code"] for r in page)
    planned = _csv(api, "person-relations", status="PLANNED")
    assert [(r["person_code"], r["not_yet_effective"]) for r in planned] == [("P000005", "true")]
    # 列名与列顺序不变，只在末尾追加
    header = api.get("/api/export/person-relations.csv").text.lstrip("﻿").splitlines()[0]
    assert header.endswith("assignment_valid_from,assignment_valid_to,not_yet_effective")
    # 数据集不支持的筛选直接拒绝，不悄悄导出全量
    assert api.get("/api/export/persons.csv", params={"duty": "HEAD"}).status_code == 422
    assert api.get("/api/export/departments.csv", params={"q": "内科"}).status_code == 422


def test_a1_06_old_date_and_planned(api):
    e = _setup(api)
    api.apply(
        duty_assign(e["P000002"], "YGB", "HEAD", "CARETAKER", "2025-01-01"),
        duty_assign(e["P000003"], "YGB", "DEPUTY", valid_from=days(10)),
    )
    reg = _register(api)
    assert (reg["record_count"], reg["planned_count"]) == (1, 0)
    reg = _register(api, include_future=True)
    assert (reg["record_count"], reg["person_count"], reg["planned_count"]) == (1, 1, 1)
    assert [r["not_yet_effective"] for r in reg["rows"]] == [False, True]
    # 负责人一览只看当天，不含计划
    assert _leader(reg, "YGB") == [("代管", "乙")]
    old = _register(api, as_of="2024-12-31")
    assert old["rows"] == [] and _leader(old, "YGB") == []


def test_a1_07_server_side_permissions(api, monkeypatch):
    _setup(api)
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", {"person.view"})
    viewer = api.as_("viewer")
    assert viewer.get("/api/person-duties").status_code == 200
    assert viewer.get("/api/export/person-duties.csv").status_code == 403
    monkeypatch.setitem(permissions.ROLE_PERMISSIONS, "viewer", set())
    assert viewer.get("/api/person-duties").status_code == 403
    assert viewer.get("/api/export/person-duties.csv").status_code == 403
