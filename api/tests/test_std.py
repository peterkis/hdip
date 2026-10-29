"""标准资料库 F1 剧本 STD-01～06（docs/标准资料库-F0F1开发计划.md 第 3.4 节）。"""

import hashlib
import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from std_helpers import build_zip, default_records, run_import

from hdip_api.services.standards_import import ImportFailure

F1 = {"DE02.01.031.00", "CV02.01.101"}


def _find(api, q, entry_type=None, **params):
    params |= {"q": q} | ({"entry_type": entry_type} if entry_type else {})
    r = api.get("/api/standards/entries", params=params)
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["total"] >= len(page["items"])
    return page["items"]


def test_std01_reading_path(api, owner_engine, tmp_path):
    """数据元 → 值域 → 代码 → 出处 → 原记录可连续查看。"""
    zp = build_zip(tmp_path)
    sha = hashlib.sha256(zp.read_bytes()).hexdigest()
    run_import(owner_engine, zp, F1, expected_sha256=sha)

    by_name = _find(api, "身份证件类别")
    by_id = _find(api, "de02.01.031.00")
    assert [e["identifier"] for e in by_id] == ["DE02.01.031.00"]
    assert "DE02.01.031.00" in {e["identifier"] for e in by_name}

    de = api.get(f"/api/standards/entries/{by_id[0]['id']}").json()
    body = de["data_element"]
    assert (body["data_type"], body["format"], body["version"]) == ("S3", "N2", "V1.1")
    assert body["allowed_value_nature"] == "reference"
    assert de["document"]["standard_no"] == "WS/T 363.3"
    assert de["document"]["standard_year"] == "2023"
    assert de["provenance"]["pdf_pages"] == [15, 16]
    assert de["provenance"]["member"].endswith("enhanced-current-official-data-elements.json")
    assert de["raw"]["raw_cells"]["数据元标识符"] == "DE02.01.031.00"

    [ref] = de["references"]
    [target] = ref["targets"]
    cv = api.get(f"/api/standards/entries/{target['entry_id']}").json()
    assert cv["value_domain"]["identifier"] == "CV02.01.101"
    assert cv["document"]["standard_no"] == "WS/T 364.3"
    assert len(cv["codes"]) == 13
    assert cv["provenance"]["pdf_pages"] == [3]
    assert [r["entry"]["identifier"] for r in cv["referenced_by"]] == ["DE02.01.031.00"]

    code = api.get(f"/api/standards/entries/{cv['codes'][2]['id']}").json()
    assert code["code_row"]["name"] == "护照"
    assert code["parent"]["identifier"] == "CV02.01.101"
    assert code["provenance"]["record_id"] == "official:364.3:CV02.01.101:3:1:4"

    docs = api.get("/api/standards/documents").json()
    assert [(d["standard_no"], d["covered_keys"], d["total_records"]) for d in docs] == [
        ("WS/T 363.3", 1, 4),
        ("WS/T 364.3", 14, 16),
    ]
    detail = api.get(f"/api/standards/documents/{docs[0]['id']}").json()
    assert detail["package"]["sha_check"] == "matched"


def test_std02_leading_zeros_and_duplicate_rows(api, owner_engine, tmp_path):
    """代码按字符串原样保存；同码值的两行源记录各自保留。"""
    des, tables, rows = default_records()
    dup = dict(rows[0], row_id="official:364.3:CV02.01.101:3:2:99", source_row=99)
    zp = build_zip(tmp_path, des, tables, [*rows, dup])
    run_import(owner_engine, zp, F1)

    [cv] = _find(api, "CV02.01.101", "value_domain")
    codes = api.get(f"/api/standards/entries/{cv['id']}").json()["codes"]
    values = [c["code"] for c in codes]
    assert values.count("01") == 2
    assert len(values) == 14 and values[-1] == "01" and "99" in values
    assert all(isinstance(c["code"], str) for c in codes)

    bad = [dict(r, code=int(r["code"])) if r["code"] == "01" else r for r in rows]
    with pytest.raises(ImportFailure, match="码值应为字符串"):
        run_import(owner_engine, build_zip(tmp_path, des, tables, bad, name="bad.zip"), F1)


def test_std03_reference_year_not_rewritten(api, owner_engine, tmp_path):
    """原文未写年份 = 目录定位；原文写 2011 而本库只有 2023 = 未解析，2023 只列为其他版本。"""
    run_import(owner_engine, build_zip(tmp_path))

    [de] = _find(api, "DE02.01.031.00")
    [ref] = api.get(f"/api/standards/entries/{de['id']}").json()["references"]
    assert ref["target_year"] is None
    assert ref["resolution"] == "catalog"
    assert ref["targets"][0]["document"]["standard_year"] == "2023"

    [old] = _find(api, "DE99.00.001.00")
    [ref] = api.get(f"/api/standards/entries/{old['id']}").json()["references"]
    assert (ref["target_year"], ref["resolution"], ref["targets"]) == ("2011", "unresolved", [])
    assert [t["document"]["standard_year"] for t in ref["other_versions"]] == ["2023"]

    [ext] = _find(api, "DE02.01.017.00")
    [ref] = api.get(f"/api/standards/entries/{ext['id']}").json()["references"]
    assert (ref["ref_kind"], ref["target_standard"], ref["resolution"]) == (
        "external_standard",
        "GB/T 2659",
        "unresolved",
    )

    [txt] = _find(api, "DE02.01.039.00")
    d = api.get(f"/api/standards/entries/{txt['id']}").json()
    assert d["data_element"]["allowed_value_nature"] == "text"
    assert d["references"] == []

    # 被引用：只列真正解析到本表的引用（2011 的不算）
    [cv] = _find(api, "CV02.01.101", "value_domain")
    incoming = api.get(f"/api/standards/entries/{cv['id']}").json()["referenced_by"]
    assert [(r["entry"]["identifier"], r["resolution"]) for r in incoming] == [
        ("DE02.01.031.00", "catalog")
    ]


def test_std04_reimport_and_widen(api, owner_engine, tmp_path):
    """重复导入不增条目；扩大选定范围只补新记录。"""
    zp = build_zip(tmp_path)
    first = run_import(owner_engine, zp, F1)
    again = run_import(owner_engine, zp, F1)
    assert again.package_reused and again.package_id == first.package_id
    assert [d["added"] for d in again.documents] == [0, 0]

    wider = run_import(owner_engine, zp)
    assert {d["standard"]: (d["added"], d["covered"]) for d in wider.documents} == {
        "WS/T 363.3—2023": (3, 4),
        "WS/T 364.3—2023": (2, 16),
    }
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM source_package")).scalar() == 1
        assert c.execute(text("SELECT count(*) FROM source_document")).scalar() == 2
        assert c.execute(text("SELECT count(*) FROM standard_entry")).scalar() == 20


def test_std05_failure_keeps_existing(api, owner_engine, tmp_path):
    """读不通的记录报出成员与位置，整体回滚；已有内容照常可读；摘要不符不登记。"""
    run_import(owner_engine, build_zip(tmp_path), F1)

    des, tables, rows = default_records()
    del des[0]["raw_cells"]["数据元名称"]
    broken = build_zip(tmp_path, des, tables, rows, name="broken.zip")
    with pytest.raises(ImportFailure, match=r"enhanced-current-official-data-elements\.json#\[0\]"):
        run_import(owner_engine, broken)

    with pytest.raises(ImportFailure, match="摘要与清单不一致"):
        run_import(
            owner_engine, build_zip(tmp_path, name="other.zip"), F1, expected_sha256="0" * 64
        )

    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM source_package")).scalar() == 1
        assert c.execute(text("SELECT count(*) FROM standard_entry")).scalar() == 15
    assert len(_find(api, "身份证件类别代码")) == 2

    # 应用账号只读；登记后的条目不可改
    from hdip_api.core.db import engine as app_engine

    with app_engine.connect() as c, pytest.raises(DBAPIError, match="permission denied"):
        c.execute(text("UPDATE standard_entry SET name = 'x'"))
    with owner_engine.begin() as c, pytest.raises(DBAPIError):
        c.execute(text("UPDATE standard_entry SET name = 'x'"))


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("source_pdf_pages", ["bad"], r"#\[0\]：字段 source_pdf_pages\[0\] 应为整数"),
        ("qa_evidence", "bad", r"#\[0\]：字段 qa_evidence 应为对象"),
        (
            "qa_evidence",
            {"image_paths": [3]},
            r"#\[0\]：字段 qa_evidence\.image_paths\[0\] 应为文本",
        ),
    ],
)
def test_std05_malformed_source_located(api, owner_engine, tmp_path, field, value, message):
    """出处与嵌套结构的形状错误也报出成员、位置与字段；整体回滚，已有内容照常可读。"""
    run_import(owner_engine, build_zip(tmp_path), F1)
    des, tables, rows = default_records()
    des[0][field] = value
    bad = build_zip(tmp_path, des, tables, rows, name="malformed.zip")
    with pytest.raises(
        ImportFailure, match=r"enhanced-current-official-data-elements\.json" + message
    ):
        run_import(owner_engine, bad)
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM source_package")).scalar() == 1
        assert c.execute(text("SELECT count(*) FROM standard_entry")).scalar() == 15
    assert len(_find(api, "身份证件类别代码")) == 2


def test_std05_document_guard(api, owner_engine, tmp_path):
    """文档修订只有接入覆盖与导入时间可更新（迁移 0024）；扩大范围仍能更新覆盖。"""
    zp = build_zip(tmp_path)
    run_import(owner_engine, zp, F1)
    for col, val in (
        ("source_version", "x"),
        ("source_url", "https://example.org"),
        ("title", "x"),
    ):
        with owner_engine.begin() as c, pytest.raises(DBAPIError, match="历史记录不可修改"):
            c.execute(text(f"UPDATE source_document SET {col} = :v"), {"v": val})
    run_import(owner_engine, zp)
    with owner_engine.connect() as c:
        covered = c.execute(
            text("SELECT standard_no, covered_keys FROM source_document ORDER BY standard_no")
        ).all()
        assert covered == [("WS/T 363.3", 4), ("WS/T 364.3", 16)]
        assert c.execute(text("SELECT count(*) FROM source_document")).scalar() == 2


def test_std06_missing_evidence_not_faked(api, owner_engine, tmp_path):
    """资料里记了图证路径但未随包提供：如实标出，不当作可预览；官方原文只是外部链接。"""
    run_import(owner_engine, build_zip(tmp_path), F1)
    [de] = _find(api, "DE02.01.031.00")
    ev = api.get(f"/api/standards/entries/{de['id']}").json()["provenance"]["evidence"]
    kinds = {(e["kind"], e["availability"]) for e in ev}
    assert ("image", "not_in_package") in kinds
    assert ("pdf", "not_in_package") in kinds
    assert ("pdf", "external") in kinds
    assert not any(e["availability"] == "in_package" for e in ev)


def test_std_permission(api, owner_engine, tmp_path):
    run_import(owner_engine, build_zip(tmp_path), F1)
    assert api.as_("viewer").get("/api/standards/documents").status_code == 200
    assert api.get("/api/standards/entries/999999").status_code == 404
    assert json.loads(api.get("/api/standards/documents").text)
