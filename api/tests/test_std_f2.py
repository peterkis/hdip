"""标准资料库 F2 第一批：读取器 v2、处理修订、引用解析、筛选与分页（标准资料库-F2开发计划.md）。"""

import pytest
from std_helpers import build_zip, de, default_records, row, run_import, table

from hdip_api.services import standards_import
from hdip_api.services.standards_import import parse_allowed_values

F1 = {"DE02.01.031.00", "CV02.01.101"}


@pytest.fixture
def reader_version(monkeypatch):
    """模拟其他读取器版本的导入（历史处理修订 v1、将来的 v10）。"""

    def use(v: str):
        monkeypatch.setattr(standards_import.Ws363364Reader, "version", v)

    return use


def _page(api, **params):
    r = api.get("/api/standards/entries", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _one(api, ident, **params):
    [hit] = _page(api, q=ident, **params)["items"]
    return api.get(f"/api/standards/entries/{hit['id']}").json()


def _ref(api, ident, **params):
    [ref] = _one(api, ident, **params)["references"]
    return ref


def _zip_with(tmp_path, extra_des=(), extra_tables=(), extra_rows=(), name="t.zip"):
    des, tables, rows = default_records()
    return build_zip(
        tmp_path, [*des, *extra_des], [*tables, *extra_tables], [*rows, *extra_rows], name=name
    )


# ---------------------------------------------------------------- 读取器 v2：值域编号


def test_parse_cv_whitespace_and_incomplete():
    _, r = parse_allowed_values("f", "WS/T 364.7 CV04. 10. 018 前囱张力代码表")
    assert (r.target_identifier, r.target_label) == ("CV04.10.018", "前囱张力代码表")
    _, r = parse_allowed_values("f", "WS/T 364.11 CV0 5. 10. 018 上报原因代码表")
    assert r.target_identifier == "CV05.10.018"
    # 表名以数字开头：末段三位后跟空白再跟数字，不并进编号
    _, r = parse_allowed_values("f", "WS/T 364.11 CV05.10.015 5岁以下儿童未治疗原因代码表")
    assert (r.target_identifier, r.target_label) == ("CV05.10.015", "5岁以下儿童未治疗原因代码表")
    _, r = parse_allowed_values("f", "WS 364.16 CV08.50.003药敏试验药物代码表")
    assert (r.target_standard, r.target_identifier) == ("WS 364.16", "CV08.50.003")
    # 不完整：不建目标、不补全
    _, r = parse_allowed_values("f", "WS/T 364.3 CV02.01 某某代码表")
    assert (r.ref_kind, r.target_identifier, r.target_label) == ("value_domain", None, "某某代码表")


def test_truncated_reference_normalized_and_labels(api, owner_engine, tmp_path):
    """空白归一后定位，原文另列；不完整编号未解析；名称差异只提示、不改解析。"""
    zp = _zip_with(
        tmp_path,
        [
            de("DE90.00.001.00", "空白编号", "WS/T 364.3 CV0 2. 01. 101 身份证件类别代码表"),
            de("DE90.00.002.00", "不完整", "WS/T 364.3 CV02. 01 身份证件类别代码表"),
            de("DE90.00.003.00", "名称不一致", "WS/T 364.3 CV02.01.102 乙肝患者病情转归代码表"),
            de("DE90.00.004.00", "后缀差异", "WS/T 364.3 CV02.01.101 身份证件类别代码"),
            de("DE90.00.005.00", "同名无号", "WS/T 364.3 CV02.01.999 身份证件类别代码表"),
        ],
    )
    run_import(owner_engine, zp)

    r = _ref(api, "DE90.00.001.00")
    assert r["raw_text"] == "WS/T 364.3 CV0 2. 01. 101 身份证件类别代码表"
    assert (r["target_identifier"], r["identifier_as_written"]) == ("CV02.01.101", "CV0 2. 01. 101")
    assert r["identifier_normalized"] and r["resolution"] == "catalog"
    assert r["targets"][0]["label_check"] == "same"

    r = _ref(api, "DE90.00.002.00")
    assert r["identifier_incomplete"] and r["target_identifier"] is None
    assert (r["resolution"], r["targets"], r["related"]) == ("unresolved", [], [])

    r = _ref(api, "DE90.00.003.00")
    assert (r["resolution"], r["match_basis"]) == ("catalog", "exact")
    assert r["targets"][0]["name"] == "出生地点类别代码表"
    assert r["targets"][0]["label_check"] == "different"
    assert r["target_label"] == "乙肝患者病情转归代码表"

    assert _ref(api, "DE90.00.004.00")["targets"][0]["label_check"] == "minor"
    assert not _ref(api, "DE02.01.031.00")["identifier_normalized"]

    r = _ref(api, "DE90.00.005.00")
    assert (r["resolution"], r["targets"]) == ("unresolved", [])


# ---------------------------------------------------------------- 读取器 v2：D 项


def test_source_issues_null_cells_and_source_images(api, owner_engine, tmp_path):
    issue = {"DE": "DE90.00.010.00", "status": "official_source_typo_preserved", "note": "保留原字"}
    d = de("DE90.00.010.00", "带问题", "1.是2.否")
    d["source_issues"] = ["原文引用字面保留", issue]
    d["qa_evidence"] = {"source_images": ["official-source-crosscheck/renders/part03-p15.png"]}
    des, tables, rows = default_records()
    rows[0]["raw_cells"] = ["01", None, "居民身份证"]
    run_import(owner_engine, build_zip(tmp_path, [*des, d], tables, rows))

    e = _one(api, "DE90.00.010.00")
    assert e["provenance"]["source_issues"] == ["原文引用字面保留", issue]
    assert e["raw"]["source_issues"][1] == issue
    imgs = [x for x in e["provenance"]["evidence"] if x["kind"] == "image"]
    assert [(x["path"], x["availability"]) for x in imgs] == [
        ("official-source-crosscheck/renders/part03-p15.png", "not_in_package")
    ]
    cv = _one(api, "CV02.01.101", entry_type="value_domain")
    code = api.get(f"/api/standards/entries/{cv['codes'][0]['id']}").json()
    assert code["code_row"]["raw_cells"] == ["01", None, "居民身份证"]


# ---------------------------------------------------------------- 处理修订


def test_revisions_resolve_within_own_revision(api, owner_engine, tmp_path, reader_version):
    zp = build_zip(tmp_path)
    reader_version("1")
    run_import(owner_engine, zp, F1)
    v1_de = _page(api, q="DE02.01.031.00")["items"][0]
    reader_version("2")
    again = run_import(owner_engine, zp)
    assert [d["reader"] for d in again.documents] == ["ws363-364@2", "ws363-364@2"]
    assert [d["added"] for d in run_import(owner_engine, zp).documents] == [0, 0]

    # 普通检索只给当前处理修订；include_superseded 两份都给
    page = _page(api, q="DE02.01.031.00")
    assert page["total"] == 1 and page["items"][0]["document"]["reader_version"] == "2"
    both = _page(api, q="DE02.01.031.00", include_superseded=True)
    assert sorted(i["document"]["reader_version"] for i in both["items"]) == ["1", "2"]

    v2 = _ref(api, "DE02.01.031.00")
    assert v2["resolution"] == "catalog"
    assert [t["document"]["reader_version"] for t in v2["targets"]] == ["2"]

    old = api.get(f"/api/standards/entries/{v1_de['id']}").json()
    assert old["document"] == old["document"] | {"reader_version": "1", "is_current": False}
    assert old["newer_revision"]["reader_version"] == "2"
    [r1] = old["references"]
    assert r1["resolution"] == "catalog"
    assert [t["document"]["reader_version"] for t in r1["targets"]] == ["1"]

    # v1 值域的被引用只来自 v1
    cv1 = api.get(f"/api/standards/entries/{r1['targets'][0]['entry_id']}").json()
    assert [i["entry"]["document"]["reader_version"] for i in cv1["referenced_by"]] == ["1"]

    docs = api.get("/api/standards/documents").json()
    assert [(d["standard_no"], d["reader_version"]) for d in docs] == [
        ("WS/T 363.3", "2"),
        ("WS/T 364.3", "2"),
    ]
    alldocs = api.get("/api/standards/documents", params={"include_superseded": True}).json()
    assert len(alldocs) == 4
    hist = next(d for d in alldocs if d["reader_version"] == "1")
    assert hist["newer_revision"]["reader_version"] == "2"
    detail = api.get(f"/api/standards/documents/{hist['id']}").json()
    assert [r["reader_version"] for r in detail["revisions"]] == ["1", "2"]
    # 指定文档时历史修订照常可列
    assert _page(api, document_id=hist["id"])["total"] == 1


def test_missing_in_own_revision_stays_unresolved(api, owner_engine, tmp_path, reader_version):
    zp = build_zip(tmp_path)
    reader_version("1")
    run_import(owner_engine, zp)
    reader_version("2")
    run_import(owner_engine, zp, {"DE02.01.031.00"})  # v2 没接入 CV02.01.101

    r = _ref(api, "DE02.01.031.00")
    assert (r["resolution"], r["targets"]) == ("unresolved", [])
    assert [(x["kind"], x["target"]["document"]["reader_version"]) for x in r["related"]] == [
        ("other_revision", "1")
    ]


def test_reader_version_compared_as_integer(api, owner_engine, tmp_path, reader_version):
    zp = build_zip(tmp_path)
    reader_version("2")
    run_import(owner_engine, zp, F1)
    reader_version("10")
    run_import(owner_engine, zp, F1)
    docs = api.get("/api/standards/documents").json()
    assert {d["reader_version"] for d in docs} == {"10"}
    assert _page(api, q="DE02.01.031.00")["items"][0]["document"]["reader_version"] == "10"


# ---------------------------------------------------------------- WS / WS/T 前缀差异


def test_prefix_variant(api, owner_engine, tmp_path):
    zp = _zip_with(
        tmp_path,
        [
            de("DE91.00.001.00", "前缀", "WS 364.3 CV02.01.101 身份证件类别代码表"),
            de("DE91.00.002.00", "国标", "GB 364.3 CV02.01.101 身份证件类别代码表"),
            de("DE91.00.003.00", "编号不同", "WS 364.3 CV02.01.199 身份证件类别代码表"),
            de("DE91.00.004.00", "名称冲突", "WS 364.3 CV02.01.101 乙肝患者病情转归代码表"),
        ],
    )
    run_import(owner_engine, zp)

    r = _ref(api, "DE91.00.001.00")
    assert (r["resolution"], r["match_basis"]) == ("catalog", "prefix_variant")
    assert (r["target_standard"], r["raw_text"]) == (
        "WS 364.3",
        "WS 364.3 CV02.01.101 身份证件类别代码表",
    )
    assert r["targets"][0]["document"]["standard_no"] == "WS/T 364.3"
    assert "来源写作 WS 364.3" in r["resolution_note"]
    assert "原文未写年份" in r["resolution_note"]

    for ident in ("DE91.00.002.00", "DE91.00.003.00"):
        r = _ref(api, ident)
        assert (r["resolution"], r["targets"], r["match_basis"]) == ("unresolved", [], None)

    r = _ref(api, "DE91.00.004.00")
    assert (r["resolution"], r["targets"]) == ("unresolved", [])
    assert [x["kind"] for x in r["related"]] == ["prefix_variant_conflict"]

    # 被引用列出前缀差异定位的引用
    cv = _one(api, "CV02.01.101", entry_type="value_domain")
    assert ("DE91.00.001.00", "prefix_variant") in {
        (i["entry"]["identifier"], i["match_basis"]) for i in cv["referenced_by"]
    }


def test_prefix_variant_exact_first_and_ambiguous(api, owner_engine, tmp_path):
    ws_table = dict(table("CV02.01.101", "身份证件类别代码表"), standard_part="WS 364.3—2023")
    zp = _zip_with(
        tmp_path,
        [de("DE91.00.001.00", "前缀", "WS 364.3 CV02.01.101 身份证件类别代码表")],
        [ws_table],
    )
    run_import(owner_engine, zp)
    r = _ref(api, "DE91.00.001.00")
    assert (r["resolution"], r["match_basis"]) == ("catalog", "exact")
    assert r["targets"][0]["document"]["standard_no"] == "WS 364.3"


def test_prefix_variant_two_candidates_not_chosen(api, owner_engine, tmp_path):
    dup = table("CV02.01.101", "身份证件类别代码表")
    zp = _zip_with(
        tmp_path,
        [de("DE91.00.001.00", "前缀", "WS 364.3 CV02.01.101 身份证件类别代码表")],
        [dup],
    )
    run_import(owner_engine, zp)
    r = _ref(api, "DE91.00.001.00")
    assert (r["resolution"], r["match_basis"], len(r["targets"])) == (
        "candidates",
        "prefix_variant",
        2,
    )


def test_prefix_variant_not_across_revisions(api, owner_engine, tmp_path, reader_version):
    zp = _zip_with(
        tmp_path, [de("DE91.00.001.00", "前缀", "WS 364.3 CV02.01.101 身份证件类别代码表")]
    )
    reader_version("1")
    run_import(owner_engine, zp)
    reader_version("2")
    run_import(owner_engine, zp, {"DE91.00.001.00"})
    r = _ref(api, "DE91.00.001.00")
    assert (r["resolution"], r["targets"]) == ("unresolved", [])
    assert {x["kind"] for x in r["related"]} == {"other_revision"}


# ---------------------------------------------------------------- 跨分册


def test_other_part_is_hint_only(api, owner_engine, tmp_path):
    zp = _zip_with(
        tmp_path,
        [de("DE92.00.001.00", "分册不对", "WS/T 364.8 CV02.01.101 身份证件类别代码表")],
    )
    run_import(owner_engine, zp)
    r = _ref(api, "DE92.00.001.00")
    assert (r["resolution"], r["targets"]) == ("unresolved", [])
    [hint] = r["related"]
    assert hint["kind"] == "other_part"
    assert hint["note"].startswith("引用分册中未找到该值域")
    assert hint["target"]["document"]["standard_no"] == "WS/T 364.3"
    assert hint["target"]["name"] == "身份证件类别代码表"
    # 指定分册存在时正常解析
    assert _ref(api, "DE02.01.031.00")["resolution"] == "catalog"


# ---------------------------------------------------------------- 筛选、分页、总数


def test_filters_before_paging(api, owner_engine, tmp_path):
    des = [
        de(f"DE93.03.{i:03d}.00", f"三分册{i}", "1.是2.否", std="WS/T 363.3—2023")
        for i in range(23)
    ]
    des += [
        de(f"DE93.10.{i:03d}.00", f"十分册{i}", "1.是2.否", std="WS/T 363.10—2023")
        for i in range(7)
    ]
    des += [de("DE93.02.001.00", "二分册", "1.是2.否", std="WS/T 363.2—2023")]
    _, tables, rows = default_records()
    run_import(owner_engine, build_zip(tmp_path, des, tables, rows))

    # 标准号自然序：363.2 → 363.3 → 363.10
    first = _page(api, entry_type="data_element", limit=1)
    assert first["total"] == 31
    assert first["items"][0]["document"]["standard_no"] == "WS/T 363.2"

    seen = []
    for off in range(0, 40, 10):
        p = _page(api, entry_type="data_element", standard_no="WS/T 363.3", offset=off, limit=10)
        assert p["total"] == 23
        seen += [i["identifier"] for i in p["items"]]
    assert seen == [f"DE93.03.{i:03d}.00" for i in range(23)]

    assert _page(api, series="WS/T 363", entry_type="data_element")["total"] == 31
    assert _page(api, series="WS/T 364")["total"] == 16
    assert _page(api, standard_year="2011")["total"] == 0
    assert _page(api, q="十分册", entry_type="data_element", limit=3)["total"] == 7


def test_top_level_not_crowded_out_by_code_rows(api, owner_engine, tmp_path):
    """代码行超过 500 的分册：顶层条目先筛出再分页，值域表全部列出。"""
    des, tables, rows = default_records()
    big = [row("CV02.01.103", f"{i:03d}", f"码{i}", i) for i in range(520)]
    tables += [table("CV02.01.103", "大表"), table("CV02.01.104", "排在后面的表")]
    rows += [dict(r, row_id=f"big:{n}") for n, r in enumerate(big)]
    run_import(owner_engine, build_zip(tmp_path, des, tables, rows))
    doc = next(
        d for d in api.get("/api/standards/documents").json() if d["standard_no"] == "WS/T 364.3"
    )
    p = _page(api, document_id=doc["id"], top_level=True, limit=200)
    assert p["total"] == 4
    assert [i["identifier"] for i in p["items"]] == [
        "CV02.01.101",
        "CV02.01.102",
        "CV02.01.103",
        "CV02.01.104",
    ]
    # 码值检索：结果带所属表，不合并不同表的相同码值
    hits = _page(api, q="001", entry_type="code_row")["items"]
    assert {(h["identifier"], h["parent"]["identifier"]) for h in hits} >= {("001", "CV02.01.103")}
