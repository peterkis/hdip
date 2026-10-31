"""标准目录与原文 STD-07～13（docs/标准资料库-目录与原文实施计划.md 第 7 节）。"""

import csv
import hashlib
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from std_helpers import build_zip, default_records, run_import

from hdip_api.core.config import get_settings
from hdip_api.services.catalog_import import CatalogFailure, import_catalog

E_COLS = [
    "系列", "编号", "年份", "标准号", "名称", "官网状态", "批准日期", "实施日期", "官网分类",
    "官网PDF", "差异类别", "文件内标识", "收录情况", "目录", "正文", "修改单", "其他文件",
    "当前结构化成果", "官网详情", "在线阅读", "核实日期", "核实依据", "备注",
]  # fmt: skip
F_COLS = [
    "目录", "文件名", "角色", "来源", "身份核对", "完整性", "字节", "sha256", "结构化处理修订",
    "备注",
]  # fmt: skip
SNAP = "全国标准信息公共服务平台“卫生健康委员会”分类目录快照"
DETAIL = "https://hbba.sacinfo.org.cn/stdDetail/"


def ed(no, year, name, status="现行", eff="2024-04-01", issued="2023-10-07", **kw):
    s = no.split(" ")[0].replace("/", "-")
    official = status != ""
    return {
        "系列": s, "编号": no, "年份": year, "标准号": f"{no}—{year}", "名称": name,
        "官网状态": status, "批准日期": issued if official else "",
        "实施日期": eff if official else "", "官网分类": "数据元目录" if official else "",
        "官网详情": DETAIL + no if official else "", "核实日期": "2026-10-30" if official else "",
        "核实依据": SNAP if official else "",
    } | kw  # fmt: skip


def put_file(root: Path, folder: str, name: str, data: bytes, role="正文", **kw) -> dict:
    p = root / "originals" / folder / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return {
        "目录": folder, "文件名": name, "角色": role, "来源": "官网下载",
        "身份核对": "与官网目录一致", "完整性": "完整文件", "字节": str(len(data)),
        "sha256": hashlib.sha256(data).hexdigest(),
    } | kw  # fmt: skip


def write_catalog(root: Path, editions: list[dict], files: list[dict]) -> None:
    cat = root / "catalog"
    cat.mkdir(parents=True, exist_ok=True)
    for name, cols, rows in (("editions.csv", E_COLS, editions), ("files.csv", F_COLS, files)):
        with open(cat / name, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, cols)
            w.writeheader()
            w.writerows(rows)


def load(engine, root: Path):
    with Session(engine) as s, s.begin():
        return import_catalog(s, root)


PDF_3633 = b"%PDF-1.7 WS/T 363.3-2023 official text"
FUTURE = "2099-01-01"


@pytest.fixture
def lib(owner_engine, tmp_path, monkeypatch):
    """363.3（有原文、有结构化）、364.3（有结构化、原文摘要对不上）、363.1（仅目录）、
    一项即将实施、一项不在官网分类（待核实）。"""
    monkeypatch.setattr(get_settings(), "standards_dir", str(tmp_path))
    editions = [
        ed("WS/T 363.3", "2023", "卫生健康信息数据元目录 第3部分：人口学及社会经济学特征"),
        ed("WS/T 364.3", "2023", "卫生健康信息数据元值域代码 第3部分：人口学及社会经济学特征"),
        ed("WS/T 363.1", "2023", "卫生健康信息数据元目录 第1部分：总则"),
        ed("WS/T 999", "2026", "未来标准", status="即将实施", eff=FUTURE),
        ed("GB/T 16751.1", "2023", "中医临床诊疗术语 第1部分：疾病", status=""),
        ed("WS 375.10", "2012", "疾病控制基本数据集 第10部分：传染病报告", status="废止"),
    ]
    files = [
        put_file(tmp_path, "WS-T/WS-T-363.3_2023", "WS-T 363.3-2023.pdf", PDF_3633),
        put_file(tmp_path, "WS-T/WS-T-364.3_2023", "WS-T 364.3-2023.pdf", b"%PDF other bytes"),
        put_file(
            tmp_path,
            "GB-T/GB-T-16751.1_2023",
            "16751.1.pdf",
            b"%PDF tcm",
            来源="Drive 归档 03",
            身份核对="Drive 已核对封面",
        ),  # fmt: skip
        put_file(tmp_path, "_相关官方资料/2016", "通告.pdf", b"%PDF notice", role="相关资料"),
    ]
    write_catalog(tmp_path, editions, files)
    load(owner_engine, tmp_path)
    des, tables, rows = default_records()
    sha = hashlib.sha256(PDF_3633).hexdigest()
    for d in des:
        d["source_sha256"] = sha
    run_import(owner_engine, build_zip(tmp_path, des, tables, rows), None)
    return tmp_path, editions, files


def _search(api, **params):
    r = api.get("/api/standards/editions", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _one(api, q):
    [hit] = _search(api, q=q)["items"]
    return hit


def test_std07_find_by_name_and_number(api, lib):
    by_name = _search(api, q="卫生健康信息数据元目录")["items"]
    assert {(e["standard_no"], e["standard_year"]) for e in by_name} == {
        ("WS/T 363.3", "2023"),
        ("WS/T 363.1", "2023"),
    }
    for q in ("363.3", "WS/T 363.3—2023", "ws/t363.3-2023"):
        hit = _one(api, q)
        assert hit["standard_no"] == "WS/T 363.3"
    assert hit["status"] == "current"
    assert (hit["effective_on"], hit["verified_on"]) == ("2024-04-01", "2026-10-30")
    assert hit["title"].startswith("卫生健康信息数据元目录 第3部分")
    assert hit["text_files"] == 1
    assert hit["counts"]["data_element"] == 4
    # 分页：先筛选再计数
    page = _search(api, limit=2)
    assert (page["total"], len(page["items"])) == (6, 2)
    # 自然排序：GB/T 在 WS 前，WS 在 WS/T 前；363.1 在 363.3 前
    order = [e["standard_no"] for e in _search(api)["items"]]
    assert order == [
        "GB/T 16751.1", "WS 375.10", "WS/T 363.1", "WS/T 363.3", "WS/T 364.3", "WS/T 999",
    ]  # fmt: skip


def test_std08_unverified_is_not_current(api, lib):
    tcm = _one(api, "16751.1")
    assert (tcm["status"], tcm["verified_on"]) == ("unverified", None)
    assert _one(api, "WS/T 999")["status"] == "upcoming"
    assert _one(api, "375.10")["status"] == "abolished"
    assert [e["standard_no"] for e in _search(api, status="unverified")["items"]] == [
        "GB/T 16751.1"
    ]
    assert {e["standard_no"] for e in _search(api, status="current")["items"]} == {
        "WS/T 363.3",
        "WS/T 364.3",
        "WS/T 363.1",
    }


def test_std09_catalog_only_listed(api, lib):
    only = _one(api, "363.1")
    assert (only["text_files"], only["counts"]) == (0, {})
    detail = api.get(f"/api/standards/editions/{only['id']}").json()
    assert detail["files"] == [] and detail["revisions"] == []
    no_text = {e["standard_no"] for e in _search(api, has_text=False)["items"]}
    assert no_text == {"WS/T 363.1", "WS/T 999", "WS 375.10"}
    assert {e["standard_no"] for e in _search(api, structured=True)["items"]} == {
        "WS/T 363.3",
        "WS/T 364.3",
    }


def test_std10_open_original(api, lib):
    root, _, _ = lib
    d = api.get(f"/api/standards/editions/{_one(api, '363.3')['id']}").json()
    [f] = d["files"]
    assert (f["role"], f["source"], f["identity_check"]) == ("TEXT", "官网下载", "与官网目录一致")
    assert "stored_path" not in f
    r = api.get(f"/api/standards/files/{f['id']}/content")
    assert r.status_code == 200
    assert r.content == PDF_3633
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline")
    # 改动后不给出
    p = root / "originals/WS-T/WS-T-363.3_2023/WS-T 363.3-2023.pdf"
    p.write_bytes(PDF_3633 + b"changed")
    r = api.get(f"/api/standards/files/{f['id']}/content")
    assert r.status_code == 404 and "已变动" in r.json()["message"]
    p.unlink()
    r = api.get(f"/api/standards/files/{f['id']}/content")
    assert r.status_code == 404 and "不在资料目录" in r.json()["message"]
    assert api.get("/api/standards/files/999/content").status_code == 404


def test_std11_entry_to_original_page(api, lib):
    [de] = api.get("/api/standards/entries", params={"q": "DE02.01.031.00"}).json()["items"]
    detail = api.get(f"/api/standards/entries/{de['id']}").json()
    assert detail["edition"]["standard_no"] == "WS/T 363.3"
    assert detail["edition"]["title"].startswith("卫生健康信息数据元目录")
    assert detail["file_id"] is not None
    assert detail["provenance"]["pdf_pages"][0] == 15
    # 364.3 的原文摘要与处理修订不同：挂上标准，不给文件（不跳页）
    [cv] = api.get("/api/standards/entries", params={"q": "CV02.01.101", "top_level": True}).json()[
        "items"
    ]
    cvd = api.get(f"/api/standards/entries/{cv['id']}").json()
    assert cvd["edition"]["standard_no"] == "WS/T 364.3"
    assert cvd["file_id"] is None
    doc = api.get(f"/api/standards/documents/{cv['document']['id']}").json()
    assert (doc["edition"]["id"], doc["file_id"]) == (cvd["edition"]["id"], None)


def test_std12_edition_to_structured(api, lib):
    d = api.get(f"/api/standards/editions/{_one(api, '364.3')['id']}").json()
    [rev] = d["revisions"]
    assert rev["document"]["is_current"] is True
    assert rev["counts"]["value_domain"] == 2
    assert rev["file_id"] is None and rev["source_sha256"] == "9f" * 32
    assert d["counts"]["value_domain"] == 2


def test_std13_catalog_keeps_history(api, lib, owner_engine):
    root, editions, files = lib
    res = load(owner_engine, root)  # 不改再导入不增行
    assert (res.editions_added, res.versions_added, res.files_added) == (0, 0, 0)
    editions[2]["实施日期"] = "2024-05-01"
    write_catalog(root, editions, files)
    res = load(owner_engine, root)
    assert res.versions_added == 1 and res.changes == ["WS/T 363.1—2023 改：实施日期"]
    d = api.get(f"/api/standards/editions/{_one(api, '363.1')['id']}").json()
    assert [v["effective_on"] for v in d["versions"]] == ["2024-04-01", "2024-05-01"]
    assert [v["change_note"] for v in d["versions"]] == ["首次登记", "改：实施日期"]
    assert d["effective_on"] == "2024-05-01"
    # 删行被拒绝
    write_catalog(root, editions[:-1], files)
    with pytest.raises(CatalogFailure, match="少了已登记的标准 WS 375.10—2012"):
        load(owner_engine, root)
    write_catalog(root, editions, files[1:])
    with pytest.raises(CatalogFailure, match="少了已登记的文件"):
        load(owner_engine, root)


def test_catalog_import_rejects_bad_rows(owner_engine, tmp_path):
    good = put_file(tmp_path, "WS-T/WS-T-1_2020", "a.pdf", b"%PDF a")
    cases = [
        ([ed("WS/T 1", "2020", "甲", 核实日期="")], [good], "核实日期：有官网状态时必填"),
        ([ed("WS/T 1", "2020", "甲", 官网详情="", 核实依据="")], [good], "须写核实依据"),
        ([ed("WS/T 1", "2020", "甲", 官网状态="暂停")], [good], "只认 现行"),
        ([ed("WS/T 1", "2020", "甲")], [good | {"sha256": "0" * 64}], "摘要与 CSV 不一致"),
        ([ed("WS/T 1", "2020", "甲")], [good | {"字节": "1"}], "字节"),
        ([ed("WS/T 1", "2020", "甲")], [good | {"文件名": "../../../x.pdf"}], "逃出资料目录"),
        (
            [ed("WS/T 1", "2020", "甲")],
            [good | {"目录": "WS-T/WS-T-2_2020"}],
            "没有对应的目录记录",
        ),  # fmt: skip
    ]
    for editions, files, msg in cases:
        write_catalog(tmp_path, editions, files)
        with pytest.raises(CatalogFailure, match=msg):
            load(owner_engine, tmp_path)
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM standard_edition")).scalar() == 0


def test_catalog_rows_cannot_change(owner_engine, lib):
    with owner_engine.begin() as c:
        for sql in (
            "UPDATE standard_edition SET standard_year = '2011'",
            "UPDATE standard_edition_version SET title = 'x'",
            "UPDATE standard_file SET sha256 = repeat('a', 64)",
        ):
            with pytest.raises(DBAPIError), c.begin_nested():
                c.execute(text(sql))
    with owner_engine.begin() as c, pytest.raises(DBAPIError), c.begin_nested():
        c.execute(
            text(
                "INSERT INTO standard_edition_version"
                " (edition_id, seq, title, status, change_note)"
                " SELECT id, 9, 'x', 'CURRENT', 'x' FROM standard_edition LIMIT 1"
            )
        )


def test_catalog_app_account_is_read_only(app_engine, lib):
    with app_engine.connect() as c:
        with pytest.raises(DBAPIError):
            c.execute(text("UPDATE standard_file SET note = 'x'"))
