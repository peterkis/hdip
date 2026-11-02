"""原件层合成脚本的 uniData 补源与参考资料（docs/标准资料库-uniData接入计划.md G1、U1、U5）。

用合成的小输入运行 scripts/originals_build.py，不碰真实资料、不连数据库。
"""

import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "originals_build.py"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write(p: Path, data: bytes) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


OFFICIAL_PDF = b"%PDF official WS/T 1-2020"
STAT_FORM = b"%PDF stat form"
SUPPLEMENT = b"%PDF GB/T 2659.1-2022"
PREFIX_VARIANT = b"%PDF cover says WS 1-2020"
BAD = b"%PDF bytes differ from uniData record"


def build(
    tmp: Path, extra_inventory: list[dict] | tuple = (), extra_official: list[tuple] | tuple = ()
) -> Path:
    """extra_official：[(官网目录行, 下载文件字节)]，追加在 WS/T 1-2020 那一行之后。"""
    official = tmp / "official"
    write(official / "pdf" / "a.pdf", OFFICIAL_PDF)
    extra_rows = []
    for i, (row, data) in enumerate(extra_official):
        write(official / "pdf" / f"x{i}.pdf", data)
        extra_rows.append(dict(row, pdfRelativePath=f"pdf/x{i}.pdf"))
    (official / "standards.json").write_text(
        json.dumps(
            {
                "collectedAt": "2026-10-30T13:00:00+08:00",
                "standards": [
                    {
                        "code": "WS/T 1-2020",
                        "name": "甲标准",
                        "status": "现行",
                        "issueDate": "2020-01-01",
                        "actDate": "2020-06-01",
                        "category": "其他",
                        "detailUrl": "https://example.test/d",
                        "onlineUrl": "https://example.test/o",
                        "downloadUrl": "https://example.test/dl",
                        "pdfRelativePath": "pdf/a.pdf",
                    },
                    *extra_rows,
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (official / "download_log.csv").write_text("filename,status,timestamp\n", encoding="utf-8")

    stat_name = "卫健统52表-国统制[2025]53号_2025_职业卫生技术服务信息报送卡.pdf"
    inventory = tmp / "inventory.json"
    inventory.write_text(
        json.dumps(
            {
                "files": [
                    {
                        "sha256": sha(STAT_FORM),
                        "code": "",
                        "year": 2025,
                        "drive_name": stat_name,
                        "drive_url": "",
                        "folder_key": "05",
                        "title": "职业卫生技术服务信息报送卡",
                        "size": len(STAT_FORM),
                    },
                    *extra_inventory,
                ],
                "nonpdf_records": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    uni = tmp / "uniData"
    write(uni / "originals" / "ref" / "stat.pdf", STAT_FORM)  # 用作取件来源
    write(uni / "originals" / "GB-T" / "s.pdf", SUPPLEMENT)
    write(uni / "originals" / "WS" / "v.pdf", PREFIX_VARIANT)
    write(uni / "originals" / "GB-T" / "bad.pdf", BAD)
    editions = [
        {"edition_id": "std_sup", "standard_no": "GB/T 2659.1", "standard_year": "2022",
         "metadata_basis": "supplement_source_claim"},
        {"edition_id": "std_bad", "standard_no": "GB/T 21715.4", "standard_year": "2011",
         "metadata_basis": "supplement_source_claim"},
        {"edition_id": "std_ws", "standard_no": "WS 1", "standard_year": "2020",
         "metadata_basis": "archive_identity_claim"},
    ]  # fmt: skip
    files = [
        {"sha256": sha(SUPPLEMENT), "bytes": len(SUPPLEMENT), "edition_ids": ["std_sup"],
         "original_name": "GB-T2659.1_2022_国家和地区代码_第1部分.pdf",
         "stored_path": "originals/GB-T/s.pdf", "identity_status": "claimed"},
        {"sha256": sha(b"something else"), "bytes": len(BAD), "edition_ids": ["std_bad"],
         "original_name": "bad.pdf", "stored_path": "originals/GB-T/bad.pdf"},
        {"sha256": sha(PREFIX_VARIANT), "bytes": len(PREFIX_VARIANT), "edition_ids": ["std_ws"],
         "original_name": "WS1_2020.pdf", "stored_path": "originals/WS/v.pdf"},
    ]  # fmt: skip
    cat = uni / "catalog"
    cat.mkdir(parents=True)
    historical = {
        "claim_kind": "historical_catalog_claim", "source": "historical/standards.csv",
        "source_pointer": "row:2", "as_written_code": "WS/T 1-2020", "as_written_title": "甲标准",
        "source_sha256": None,
        "raw": {"status": "现行", "edition": "2020", "issue_date": "2020-01-01",
                "effective_date": "2020-06-01"},
    }  # fmt: skip
    official_kind = dict(historical, claim_kind="official_catalog_claim")  # 与快照重复，不收
    (cat / "catalog_claims.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in (historical, official_kind)),
        encoding="utf-8",
    )
    for name, items in (("standard_editions.jsonl", editions), ("standard_files.jsonl", files)):
        (cat / name).write_text(
            "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items), encoding="utf-8"
        )

    out = tmp / "out"
    done = subprocess.run(
        [sys.executable, "-I", str(SCRIPT), "--official", str(official),
         "--inventory", str(inventory), "--pool", str(uni / "originals"),
         "--unidata", str(uni), "--out", str(out)],
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert done.returncode == 0, done.stderr
    return out / "catalog"


def test_unidata_supplements_and_references(tmp_path):
    cat = build(tmp_path)
    eds = {(r["编号"], r["年份"]): r for r in rows(cat / "editions.csv")}
    # 补源标准建目录记录，状态待核实；按封面写法另立的 WS 条目不引入（U1）
    assert set(eds) == {("WS/T 1", "2020"), ("GB/T 2659.1", "2022")}
    sup = eds[("GB/T 2659.1", "2022")]
    assert (sup["官网状态"], sup["名称"]) == ("", "国家和地区代码 第1部分")
    assert "uniData 补源" in sup["备注"]
    files = rows(cat / "files.csv")
    by_sha = {r["sha256"]: r for r in files}
    assert by_sha[sha(SUPPLEMENT)]["来源"] == "uniData 补源"
    assert sha(PREFIX_VARIANT) not in by_sha and sha(BAD) not in by_sha
    why = {r["标识"]: r["原因"] for r in rows(cat / "unmatched.csv") if r["来源"] == "uniData"}
    assert "按封面写法另立的条目不引入" in why["WS1_2020.pdf"]
    assert "大小或摘要不一致" in why["bad.pdf"]
    # 没有标准号的资料：参考资料，类别 + 名称 + 年份，表号写在备注
    stat = by_sha[sha(STAT_FORM)]
    assert (stat["角色"], stat["资料类别"], stat["参考资料名称"], stat["资料年份"]) == (
        "参考资料",
        "统计报表",
        "职业卫生技术服务信息报送卡",
        "2025",
    )
    assert stat["目录"] == "_相关官方资料/2025"
    assert rows(cat / "references.csv") == [
        {"类别": "统计报表", "名称": "职业卫生技术服务信息报送卡", "年份": "2025",
         "备注": "卫健统52表；国统制[2025]53号"},
    ]  # fmt: skip


def cover_claim(verified: bool) -> dict:
    """同字节的 Drive 记录写着另一个标准号；identity 文字是否定说法。"""
    return {
        "sha256": sha(OFFICIAL_PDF),
        "code": "WS/T 2",
        "year": 2020,
        "drive_name": "WS-T2_2020_乙标准.pdf",
        "drive_url": "",
        "folder_key": "04",
        "title": "乙标准",
        "identity": "未核对封面",
        "identity_verified": verified,
        "size": len(OFFICIAL_PDF),
    }


def test_unverified_cover_does_not_move_official_file(tmp_path):
    """“未核对封面”也含“核对”二字：只认明确的 identity_verified，不按文字关键字（PR #6 审查）。"""
    cat = build(tmp_path, [cover_claim(verified=False)])
    eds = {r["编号"]: r for r in rows(cat / "editions.csv")}
    assert "WS/T 2" not in eds and eds["WS/T 1"]["差异类别"] == ""
    [f] = [r for r in rows(cat / "files.csv") if r["sha256"] == sha(OFFICIAL_PDF)]
    assert (f["目录"], f["身份核对"]) == ("WS-T/WS-T-1_2020", "未逐份核对封面")


def test_verified_cover_still_marks_wrong_link(tmp_path):
    """对照：同一记录带明确的 identity_verified=True 时，仍按错链归到封面那项标准。"""
    cat = build(tmp_path, [cover_claim(verified=True)])
    eds = {r["编号"]: r for r in rows(cat / "editions.csv")}
    assert eds["WS/T 1"]["差异类别"] == "错链"
    [f] = [r for r in rows(cat / "files.csv") if r["sha256"] == sha(OFFICIAL_PDF)]
    assert f["目录"] == "WS-T/WS-T-2_2020"


WS438_TEXT = b"%PDF WS 438-2013 cover"
WS439_TEXT = b"%PDF WS 439-2013 cover"


def test_duplicate_catalog_rows_named_by_own_file(tmp_path):
    """官网目录同号列两次（WS 439—2013）：目录字段取下载文件归属本条的那一行；
    指向别的标准文件的那一行（裂头蚴病 = WS 438 的文件）只作来源声明与备注（G2）。"""
    row = {"code": "WS 439-2013", "status": "现行", "issueDate": "2013-06-14",
           "actDate": "2013-12-01", "category": "其他"}  # fmt: skip
    cat = build(
        tmp_path,
        extra_inventory=[
            {"sha256": sha(WS438_TEXT), "code": "WS 438", "year": 2013, "drive_name": "WS438.pdf",
             "drive_url": "", "folder_key": "98", "title": "裂头蚴病的诊断",
             "identity_verified": True, "size": len(WS438_TEXT)},
        ],
        extra_official=[
            (dict(row, name="裂头蚴病的诊断", detailUrl="https://example.test/wrong"), WS438_TEXT),
            (dict(row, name="钩虫病的诊断", detailUrl="https://example.test/right"), WS439_TEXT),
        ],
    )  # fmt: skip
    eds = {(r["编号"], r["年份"]): r for r in rows(cat / "editions.csv")}
    ws439 = eds[("WS 439", "2013")]
    assert (ws439["名称"], ws439["官网详情"]) == ("钩虫病的诊断", "https://example.test/right")
    assert "官网目录重复列出：WS 439-2013《裂头蚴病的诊断》" in ws439["备注"]
    files = {r["sha256"]: r["目录"] for r in rows(cat / "files.csv")}
    assert files[sha(WS438_TEXT)] == "WS/WS-438_2013"  # 错链文件归到封面那项标准
    assert files[sha(WS439_TEXT)] == "WS/WS-439_2013"
    # 两条官网记录都作为来源声明原样保留
    with open(cat / "claims.jsonl", encoding="utf-8") as fh:
        claims = [json.loads(line) for line in fh]
    official = [
        (c["名称"], c["文件sha256"]) for c in claims if c["来源"] == "官网目录快照"
        and c["编号"] == "WS 439"
    ]  # fmt: skip
    assert official == [("裂头蚴病的诊断", sha(WS438_TEXT)), ("钩虫病的诊断", sha(WS439_TEXT))]
    drive = [c for c in claims if c["来源"] == "Drive 归档清单" and c["编号"] == "WS 438"]
    assert drive and drive[0]["记录位置"] == "$.files[1]"
    # uniData 只收历史目录与补源记录；官网、Drive 两类与上面重复，不再收
    uni = [(c["来源"], c["编号"], c["实施日期"]) for c in claims if c["来源"].startswith("uniData")]
    assert uni == [("uniData 历史目录", "WS/T 1", "2020-06-01")]
