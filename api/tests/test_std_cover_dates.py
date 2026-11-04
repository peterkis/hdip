"""标准资料库：原文封面识别的发布 / 实施日期（docs/标准资料库-封面日期补全.md）。"""

import csv
import hashlib
from pathlib import Path

import pytest
from sqlalchemy.orm import Session
from test_std_catalog import ed, put_file, write_catalog
from test_std_g2 import corr, write_corrections

from hdip_api.core.config import get_settings
from hdip_api.services.catalog_import import CatalogFailure, import_catalog

V_COLS = [
    "标准号",
    "年份",
    "字段",
    "日期",
    "依据文件sha256",
    "依据页码",
    "识别方式",
    "转写成果比对",
    "说明",
]
TCM, CODES, OTHER = b"%PDF tcm cover", b"%PDF 2261.1 cover", b"%PDF 363.3"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def row(no, year, field, value, file, page="PDF 第 1 页", **kw) -> dict:
    return {
        "标准号": no, "年份": year, "字段": field, "日期": value, "依据文件sha256": sha(file),
        "依据页码": page, "识别方式": "封面 OCR", "转写成果比对": "一致（2 处）", "说明": "",
    } | kw  # fmt: skip


def write_cover(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, V_COLS)
        w.writeheader()
        w.writerows(rows)
    return path


@pytest.fixture
def cover(owner_engine, tmp_path, monkeypatch):
    """两项待核实、没有日期的国家标准，一项官网目录有日期的行业标准。"""
    monkeypatch.setattr(get_settings(), "standards_dir", str(tmp_path))
    editions = [
        ed("GB/T 16751.1", "2023", "中医临床诊疗术语 第1部分：疾病", status=""),
        ed("GB/T 2261.1", "2003", "个人基本信息分类与代码 第1部分：人的性别代码", status=""),
        ed("WS/T 363.3", "2023", "卫生健康信息数据元目录 第3部分：人口学及社会经济学特征"),
    ]
    files = [
        put_file(tmp_path, "GB-T/GB-T-16751.1_2023", "16751.1.pdf", TCM, 来源="Drive 归档 03"),
        put_file(tmp_path, "GB-T/GB-T-2261.1_2003", "2261.1.pdf", CODES, 来源="Drive 归档 03"),
        put_file(tmp_path, "WS-T/WS-T-363.3_2023", "363.3.pdf", OTHER),
    ]
    write_catalog(tmp_path, editions, files)
    return tmp_path, tmp_path / "cover-dates.csv"


def load(engine, root, cover_dates, corrections=None, dry_run=False):
    with Session(engine) as s, s.begin():
        res = import_catalog(
            s, root, corrections=corrections, cover_dates=cover_dates, dry_run=dry_run
        )
        if dry_run:
            s.rollback()
        return res


def detail(api, no):
    [hit] = api.get("/api/standards/editions", params={"q": no}).json()["items"]
    return api.get(f"/api/standards/editions/{hit['id']}").json()


BASE = [
    row("GB/T 2261.1", "2003", "发布日期", "2003-07-25", CODES),
    row("GB/T 2261.1", "2003", "实施日期", "2003-12-01", CODES),
    row("GB/T 16751.1", "2023", "发布日期", "2023-03-17", TCM),
]


def test_cover_dates_fill_empty_and_keep_status(api, owner_engine, cover):
    root, path = cover
    res = load(owner_engine, root, write_cover(path, BASE))
    # 首次登记时封面日期直接写进第 1 版；封面声明一份文件一条
    assert (res.versions_added, res.claims_added) == (3, 2)
    d = detail(api, "2261.1")
    assert (d["issued_on"], d["effective_on"], d["status"]) == (
        "2003-07-25",
        "2003-12-01",
        "unverified",
    )
    assert d["current"]["change_note"] == "首次登记（发布日期、实施日期取自原文封面识别）"
    [cl] = [c for c in d["claims"] if c["source"] == "原文封面识别"]
    assert (cl["issued"], cl["effective"], cl["record_key"]) == (
        "2003-07-25",
        "2003-12-01",
        "PDF 第 1 页",
    )
    assert (cl["source_sha256"], cl["file_id"] is not None) == (sha(CODES), True)
    assert cl["raw"]["发布日期"]["识别方式"] == "封面 OCR"
    # 封面只印了发布日期：实施日期仍空，不补
    tcm = detail(api, "16751.1")
    assert (tcm["issued_on"], tcm["effective_on"]) == ("2023-03-17", None)
    # 重跑不增行
    again = load(owner_engine, root, path)
    assert (again.versions_added, again.claims_added) == (0, 0)


def test_cover_dates_appended_after_first_registration(api, owner_engine, cover):
    root, path = cover
    load(owner_engine, root, None)
    res = load(owner_engine, root, write_cover(path, BASE[:2]))
    assert (res.versions_added, res.claims_added) == (1, 1)
    d = detail(api, "2261.1")
    assert [v["change_note"] for v in d["versions"]] == [
        "首次登记",
        "补：发布日期、实施日期（原文封面识别）",
    ]


def test_cover_dates_never_override_catalog_or_correction(api, owner_engine, cover):
    root, path = cover
    rows = [
        *BASE,
        row("WS/T 363.3", "2023", "实施日期", "2024-05-01", OTHER),  # 官网目录有 2024-04-01
        row("GB/T 16751.1", "2023", "实施日期", "2023-10-01", TCM),
    ]
    fixes = write_corrections(
        root / "corr.csv",
        [
            corr(
                "C0001",
                std="GB/T 16751.1",
                year="2023",
                value="2023-03-17",
                依据地址="https://e.x/1",
            )
        ],
    )
    load(owner_engine, root, write_cover(path, rows), corrections=fixes)
    assert detail(api, "363.3")["effective_on"] == "2024-04-01"
    tcm = detail(api, "16751.1")
    assert tcm["effective_on"] == "2023-03-17"
    assert (
        tcm["current"]["change_note"] == "首次登记（含人工更正 C0001）（发布日期取自原文封面识别）"
    )
    # 封面声明照样记下，供整理记录对照
    [cl] = [c for c in tcm["claims"] if c["source"] == "原文封面识别"]
    assert cl["effective"] == "2023-10-01"


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        (row("GB/T 9999", "2003", "发布日期", "2003-07-25", CODES), "目录里没有 GB/T 9999—2003"),
        (row("GB/T 2261.1", "2003", "废止日期", "2003-07-25", CODES), "只认 发布日期 / 实施日期"),
        (row("GB/T 2261.1", "2003", "发布日期", "", CODES), "封面上没有的日期不写进本表"),
        (row("GB/T 2261.1", "2003", "发布日期", "2003/07/25", CODES), "日期写法应为 YYYY-MM-DD"),
        (
            row("GB/T 2261.1", "2003", "发布日期", "2003-07-25", TCM),
            "不是 GB/T 2261.1—2003 已登记的文件",
        ),
        (
            row("GB/T 2261.1", "2003", "发布日期", "2003-07-25", CODES, page=""),
            "依据页码：不能为空",
        ),
        (BASE[0], "与第 2 行重复"),
    ],
)
def test_cover_dates_rejected(owner_engine, cover, bad, message):
    root, path = cover
    with pytest.raises(CatalogFailure) as e:
        load(owner_engine, root, write_cover(path, [BASE[0], bad]))
    assert any(message in p for p in e.value.problems), e.value.problems


def test_registered_cover_claim_cannot_change(owner_engine, cover):
    root, path = cover
    load(owner_engine, root, write_cover(path, BASE[:2]))
    changed = [BASE[0], row("GB/T 2261.1", "2003", "实施日期", "2003-12-02", CODES)]
    with pytest.raises(CatalogFailure) as e:
        load(owner_engine, root, write_cover(path, changed))
    assert any(
        "已登记的来源声明不能改" in p and p.startswith("cover-dates.csv") for p in e.value.problems
    )
