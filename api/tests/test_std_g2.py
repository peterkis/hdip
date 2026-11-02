"""标准资料库 G2：来源声明与人工更正（迁移 0027，docs/标准资料库-uniData接入计划.md G2）。"""

import csv
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from test_std_catalog import ed, put_file, write_catalog

from hdip_api.core.config import get_settings
from hdip_api.services.catalog_import import CatalogFailure, import_catalog

C_COLS = [
    "编号", "动作", "标准号", "年份", "字段", "新值", "撤销对象", "依据地址", "依据文件sha256",
    "依据页码", "说明", "确认人", "确认日期",
]  # fmt: skip
NHC = "https://www.nhc.gov.cn/example/572.pdf"
A572, B572, F587 = b"%PDF 572 issued by A", b"%PDF 572 issued by B", b"%PDF 587 cover 2017"
SNAP = "a" * 64


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def corr(key, std="WS/T 572", year="2017", field="实施日期", value="2018-02-15", **kw) -> dict:
    return {
        "编号": key, "动作": "更正", "标准号": std, "年份": year, "字段": field, "新值": value,
        "依据地址": NHC, "依据页码": "封面", "说明": "同一标准不同部门发布，采用卫健委发布的日期",
        "确认人": "Peter", "确认日期": "2026-11-02",
    } | kw  # fmt: skip


def write_corrections(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, C_COLS)
        w.writeheader()
        w.writerows(rows)
    return path


def claim(source, pointer, code, no, year, title, effective="", file=b"") -> dict:
    return {
        "来源": source, "来源文件": "standards.json", "来源文件sha256": SNAP, "记录位置": pointer,
        "记录时间": "2026-10-30T13:00:00", "编号": no, "年份": year, "标准号写法": code,
        "名称": title, "状态": "现行", "发布日期": "", "实施日期": effective, "废止日期": "",
        "地址": "", "文件sha256": sha(file) if file else "", "原记录": {"code": code},
    }  # fmt: skip


@pytest.fixture
def g2(owner_engine, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "standards_dir", str(tmp_path))
    editions = [
        ed("WS/T 572", "2017", "血清中碘的测定 砷铈催化分光光度法", eff="2018-02-01",
           issued="2017-08-16"),
        ed("WS/T 587", "2018", "学校卫生标准编写和研制总则", eff="2018-08-01", issued="2018-02-23",
           差异类别="目录与文件标识不一致",
           文件内标识="WS/T 587—2017《学校卫生标准研制和编写总则》"),
        ed("WS 375.10", "2012", "疾病控制基本数据集 第10部分：传染病报告", status="废止"),
    ]  # fmt: skip
    files = [
        put_file(tmp_path, "WS-T/WS-T-572_2017", "WS_T 572-2017.pdf", A572),
        put_file(tmp_path, "WS-T/WS-T-572_2017", "WS_T572-2017.pdf", B572),
        put_file(tmp_path, "WS-T/WS-T-587_2018", "WS-T587_2017.pdf", F587),
    ]
    write_catalog(tmp_path, editions, files)
    claims = [
        claim("官网目录快照", "$.standards[1]", "WS/T 572-2017", "WS/T 572", "2017",
              "血清中碘的测定 砷铈催化分光光度法", "2018-02-01", A572),
        claim("官网目录快照", "$.standards[2]", "WS/T572-2017", "WS/T 572", "2017",
              "血清中碘的测定 砷铈催化分光光度法", "2018-02-15", B572),
        claim("官网目录快照", "$.standards[3]", "WS/T 587-2018", "WS/T 587", "2018",
              "学校卫生标准编写和研制总则", "2018-08-01", F587),
        # Drive 记录按封面写 2017：标准号不同，只经文件摘要关联到 587—2018
        claim("Drive 归档清单", "$.files[7]", "WS/T 587—2017", "WS/T 587", "2017",
              "学校卫生标准研制和编写总则", "", F587),
    ]  # fmt: skip
    with open(tmp_path / "catalog" / "claims.jsonl", "w", encoding="utf-8") as fh:
        for c in claims:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")
    path = tmp_path / "catalog-corrections.csv"
    return tmp_path, path, editions, files


def load(engine, root, corrections, dry_run=False):
    with Session(engine) as s, s.begin():
        res = import_catalog(s, root, corrections=corrections, dry_run=dry_run)
        if dry_run:
            s.rollback()
        return res


def detail(api, no):
    [row] = api.get("/api/standards/editions", params={"q": no}).json()["items"]
    return api.get(f"/api/standards/editions/{row['id']}").json()


def test_claims_kept_as_written_and_linked(api, owner_engine, g2):
    root, path, *_ = g2
    res = load(owner_engine, root, path)
    assert res.claims_added == 4
    d = detail(api, "572")
    eff = sorted((c["code_as_written"], c["effective"], c["linked_by"]) for c in d["claims"])
    assert eff == [
        ("WS/T 572-2017", "2018-02-01", "both"),
        ("WS/T572-2017", "2018-02-15", "both"),
    ]
    assert all(c["file_id"] for c in d["claims"]) and d["claims"][0]["raw"]
    # 587：封面写 2017 的 Drive 记录只经文件摘要关联，冲突照样显示，不改目录年份
    d = detail(api, "587")
    by = {c["code_as_written"]: c["linked_by"] for c in d["claims"]}
    assert by == {"WS/T 587-2018": "both", "WS/T 587—2017": "file"}
    assert (d["standard_year"], d["difference"]) == ("2018", "目录与文件标识不一致")
    # 重复导入不增行
    assert load(owner_engine, root, path).claims_added == 0


def test_correction_appends_version(api, owner_engine, g2):
    root, path, *_ = g2
    load(owner_engine, root, path)
    write_corrections(path, [corr("C0001")])
    dry = load(owner_engine, root, path, dry_run=True)  # --check 不写库
    assert (dry.versions_added, dry.corrections_added) == (1, 1)
    assert detail(api, "572")["effective_on"] == "2018-02-01"
    res = load(owner_engine, root, path)
    assert res.changes[0] == "WS/T 572—2017 改：实施日期（人工更正 C0001）"
    d = detail(api, "572")
    assert d["effective_on"] == "2018-02-15"
    assert [(v["seq"], v["effective_on"], v["correction_keys"]) for v in d["versions"]] == [
        (1, "2018-02-01", []),
        (2, "2018-02-15", ["C0001"]),
    ]
    [c] = d["corrections"]
    assert (c["action"], c["field"], c["new_value"], c["confirmed_by"], c["withdrawn_by"]) == (
        "CORRECT",
        "effective_on",
        "2018-02-15",
        "Peter",
        None,
    )
    # 来源声明不变：写 2018-02-01 的记录仍在
    assert "2018-02-01" in {c["effective"] for c in d["claims"]}
    # 同输入重跑不增行
    res = load(owner_engine, root, path)
    assert (res.versions_added, res.corrections_added) == (0, 0)


def test_withdraw_restores_generated_value(api, owner_engine, g2):
    root, path, *_ = g2
    write_corrections(path, [corr("C0001")])
    load(owner_engine, root, path)
    withdraw = {
        "编号": "C0002", "动作": "撤销", "撤销对象": "C0001", "说明": "依据有误，撤回",
        "确认人": "Peter", "确认日期": "2026-11-03",
    }  # fmt: skip
    write_corrections(path, [corr("C0001"), withdraw])
    res = load(owner_engine, root, path)
    assert res.changes[0] == "WS/T 572—2017 改：实施日期（撤销人工更正 C0001）"
    d = detail(api, "572")
    assert d["effective_on"] == "2018-02-01"
    assert [v["correction_keys"] for v in d["versions"]] == [["C0001"], []]
    assert {c["correction_key"]: c["withdrawn_by"] for c in d["corrections"]} == {
        "C0001": "C0002",
        "C0002": None,
    }


def test_clear_and_abolished_date(api, owner_engine, g2):
    root, path, *_ = g2
    rows = [
        corr("C0001", "WS/T 587", "2018", "文件内标识", "（清空）"),
        corr("C0002", "WS 375.10", "2012", "废止日期", "2024-04-01"),
    ]
    write_corrections(path, rows)
    load(owner_engine, root, path)
    assert detail(api, "587")["current"]["file_identity"] is None
    assert detail(api, "375.10")["current"]["abolished_on"] == "2024-04-01"


def test_correction_rules(owner_engine, g2):
    root, path, *_ = g2
    write_corrections(path, [corr("C0001")])
    load(owner_engine, root, path)
    cases = [
        ([], "少了已登记的更正 C0001"),
        ([corr("C0001", value="2018-02-16")], "已登记的更正不能改"),
        ([corr("C0001"), corr("C0002", field="年份", value="2018")], "只能更正"),
        ([corr("C0001"), corr("C0002", std="WS/T 9999")], "目录里没有 WS/T 9999—2017"),
        ([corr("C0001"), corr("C0002", field="名称", 确认人="")], "确认人：不能为空"),
        ([corr("C0001"), corr("C0002", field="名称", value="")], "未填写；要清空请写“（清空）”"),
        (
            [corr("C0001"), corr("C0002", field="名称", value="（清空）")],
            "名称是必填的目录信息，不能清空",
        ),
        ([corr("C0001"), corr("C0002", field="名称", 依据地址="")], "须写依据地址或依据文件摘要"),
        ([corr("C0001"), corr("C0002", field="废止日期", value="2024-01-01")], "不是废止状态"),
        ([corr("C0001"), corr("C0002")], "同时更正 WS/T 572—2017 的同一字段"),
        (
            [
                corr("C0001"),
                {
                    "编号": "C0002",
                    "动作": "撤销",
                    "撤销对象": "C0009",
                    "说明": "x",
                    "确认人": "Peter",
                    "确认日期": "2026-11-03",
                },
            ],
            "“C0009”不是本表前面的一条更正",
        ),  # fmt: skip
        ([corr("C0001"), corr("C0002", field="实施日期", value="2018/02/15")], "日期写法"),
    ]
    for rows, msg in cases:
        write_corrections(path, rows)
        with pytest.raises(CatalogFailure, match=msg):
            load(owner_engine, root, path)
    with owner_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM standard_catalog_correction")).scalar() == 1


def test_claims_and_corrections_rows_cannot_change(owner_engine, app_engine, g2):
    root, path, *_ = g2
    write_corrections(path, [corr("C0001")])
    load(owner_engine, root, path)
    with owner_engine.begin() as c:
        for sql in (
            "UPDATE standard_edition_claim SET title = 'x'",
            "UPDATE standard_catalog_correction SET new_value = '2018-02-16'",
        ):
            with pytest.raises(DBAPIError), c.begin_nested():
                c.execute(text(sql))
    with app_engine.connect() as c, pytest.raises(DBAPIError):
        c.execute(text("UPDATE standard_edition_claim SET title = 'x'"))
