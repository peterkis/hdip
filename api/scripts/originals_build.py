"""Build the standards originals layer: official-site downloads plus the Drive archive,
one tree with catalogs.

usage:
  python -I api/scripts/originals_build.py --official DIR --inventory JSON
         --pool DIR [--pool DIR ...] [--structured TSV] --out ROOT

  --official    full copy of the 全国标准信息公共服务平台 download
                (standards.json, download_log.csv, pdf/)
  --inventory   Drive archive inventory (上传核验检查点.json)
  --pool        folders holding files already fetched from Drive or handed over by the user
                (an older originals tree, an inbox); a file is used only when its SHA-256
                matches an inventory record
  --structured  source_document export (see hdip-standards/README.md); links each processing
                revision to the local file with its recorded source_sha256
  --out         a new, empty folder; gets originals/ and catalog/

Files are hard-linked from a pool when it sits on the same disk, otherwise copied. Nothing
is moved or deleted. Identical bytes are stored once; every way the file was obtained is
kept in sources.csv.

Identity rules (docs/标准资料库-目录与原文实施计划.md §10.1):
- the official catalog row is the entry; the file's printed identity is evidence, not an
  override;
- a file goes to another standard's folder only when the official link returns a different
  standard number (wrong link) and the Drive archive verified the cover; status and dates
  stay with the row;
- WS vs WS/T on the cover, or a different year / title, keeps the file under the catalog
  row and records both; the folder path is a location, not an identity.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--official", type=Path, required=True)
ap.add_argument("--inventory", type=Path, required=True)
ap.add_argument("--pool", type=Path, action="append", default=[])
ap.add_argument("--structured", type=Path)
ap.add_argument("--out", type=Path, required=True)
args = ap.parse_args()
if args.out.exists() and any(args.out.iterdir()):
    raise SystemExit(f"{args.out} is not empty")
originals, catalog = args.out / "originals", args.out / "catalog"

CODE = re.compile(
    r"^\s*(GB/T|GB_T|GB-T|GB|WS/T|WS_T|WS-T|WST|WS)\s*[？?]?\s*(\d+(?:\.\d+)*)\s*(?:[-—–_]\s*(\d{4}))?"
)
SERIES = {
    "GB/T": "GB-T",
    "GB_T": "GB-T",
    "GB-T": "GB-T",
    "GB": "GB",
    "WS/T": "WS-T",
    "WS_T": "WS-T",
    "WS-T": "WS-T",
    "WST": "WS-T",
    "WS": "WS",
}
OTHER = {"WS": "WS-T", "WS-T": "WS", "GB": "GB-T", "GB-T": "GB"}

# 国卫通〔2016〕24号 附件2：性质由强制性转化为推荐性的标准目录（WS 部分；序号 → 标准）。
# Read from the notice bound into the official "WS/T 381-2012" download (sha f43bd903…, pp. 17, 21).
CONVERTED_2016 = {
    ("192", "2008"): 2,
    ("277", "2007"): 3,
    ("302", "2008"): 1,
    ("423", "2013"): 6,
    ("309", "2009"): 8,
    ("321", "2010"): 9,
    ("369", "2012"): 10,
    ("379", "2012"): 11,
    ("380", "2012"): 12,
    ("381", "2012"): 13,
    ("438", "2013"): 14,
    ("439", "2013"): 15,
    ("469", "2015"): 16,
    ("470", "2015"): 17,
    ("370", "2012"): 18,
    ("195", "2001"): 19,
    ("191", "1999"): 20,
    ("236", "2003"): 21,
}

# Files whose content was checked page by page: page ranges of what is bound together.
BOUND = {
    "f43bd903f567774971af8a3a2497cc486b18256937454e01a5c41fb5814ac01d": (
        "第1–16页 WS 438—2013《裂头蚴病的诊断》正文；第17页 国卫通〔2016〕24号 通告；"
        "第18–20页 附件1 废止的标准目录；第21页 附件2 性质由强制性转化为推荐性的标准目录。"
        "不含 WS 381—2012 正文"
    ),
}


def parse(code, year=None):
    m = CODE.match(code or "")
    if not m:
        return None
    y = m.group(3) or (str(year) if year else None)
    return (SERIES[m.group(1)], m.group(2), y) if y else None


def label(key):
    return f"{key[0].replace('-', '/')} {key[1]}—{key[2]}"


def folder(key):
    return originals / key[0] / f"{key[0]}-{key[1]}_{key[2]}"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def note(d, text, field="备注"):
    if text and text not in d[field].split("；"):
        d[field] = (d[field] + "；" if d[field] else "") + text


pool = {}
for root in args.pool:
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.startswith("."):
                p = Path(dp) / f
                pool.setdefault(sha(p), p)

inv = json.load(open(args.inventory, encoding="utf-8"))
drive_by_sha = defaultdict(list)
for r in inv["files"]:
    drive_by_sha[r["sha256"]].append(r)


def cover_of(digest):
    """Identity printed on the file, as verified by the Drive archive (None when not verified)."""
    for r in drive_by_sha.get(digest, []):
        stated = next(
            (
                m.group(1)
                for i in r.get("issues") or []
                for m in [re.search(r"实际PDF封面身份：([^《，。]+)", i)]
                if m
            ),
            None,
        )
        printed = (r.get("printed_identity") or {}).get("standard_id")
        k = parse(stated or printed or "") or parse(r["code"], r.get("year"))
        if k and (
            stated or printed or r.get("identity_verified") or "核对" in (r.get("identity") or "")
        ):
            title = (r.get("printed_identity") or {}).get("title") or r.get("title") or ""
            return k, title
    return None


editions = {}  # key -> row
files = {}  # (folder, sha) -> row
sources = []  # one row per way a file was obtained
unmatched = []


def edition(key, code, name="", stub=True):
    return editions.setdefault(
        key,
        {
            "标准号": code,
            "名称": name,
            "官网状态": "",
            "批准日期": "",
            "实施日期": "",
            "官网分类": "",
            "官网详情": "",
            "在线阅读": "",
            "核实日期": "",
            "核实依据": "",
            "官网PDF": "",
            "差异类别": "",
            "文件内标识": "",
            "备注": "",
            "_stub": stub,
        },
    )


def put(dest, src, digest, row):
    k = (dest, digest)
    if k in files:
        return files[k]
    dest.mkdir(parents=True, exist_ok=True)
    name = row["文件名"]
    t, i = dest / name, 2
    while t.exists() and sha(t) != digest:
        t = dest / f"{Path(name).stem}__{i}{Path(name).suffix}"
        i += 1
    if not t.exists():
        try:
            os.link(src, t)
        except OSError:
            shutil.copy2(src, t)
    row.update(
        文件名=t.name, 目录=str(dest.relative_to(originals)), sha256=digest, 字节=os.path.getsize(t)
    )
    files[k] = row
    return row


def file_row(name, role, source, ident, complete="完整文件", remark=""):
    return {
        "文件名": name,
        "角色": role,
        "来源": source,
        "身份核对": ident,
        "完整性": complete,
        "结构化处理修订": "",
        "备注": remark,
    }


# 1 official catalog and downloads
official = args.official
log = {}
for r in csv.DictReader(open(official / "download_log.csv", encoding="utf-8-sig")):
    if r["status"] == "success":
        log[r["filename"]] = r
snapshot = json.load(open(official / "standards.json", encoding="utf-8"))
std, collected = snapshot["standards"], snapshot["collectedAt"][:10]
for s in std:
    key = parse(s["code"])
    p = official / (s.get("pdfRelativePath") or "")
    has_pdf = bool(s.get("pdfRelativePath")) and p.is_file()
    digest = sha(p) if has_pdf else ""
    src_row = {
        "sha256": digest,
        "来源": "官网下载",
        "入口标识": s["code"].strip(),
        "入口名称": s["name"],
        "入口状态": s["status"],
        "官网详情": s.get("detailUrl", ""),
        "下载地址": s.get("downloadUrl", ""),
        "原文件名": p.name if has_pdf else "",
        "Drive文件ID": "",
        "Drive归档身份": "",
        "取得时间": (log.get(p.name) or {}).get("timestamp", ""),
        "说明": "",
    }
    sources.append(src_row)
    if not key:
        src_row["说明"] = "标准号未写年份，未建目录条目"
        unmatched.append(
            {
                "来源": "官网目录",
                "标识": s["code"],
                "原因": "标准号未写年份；同字节文件见 sources.csv",
                "字节": "",
                "sha256": digest,
                "Drive文件ID": "",
            }
        )
        continue
    e = edition(key, s["code"].strip(), s["name"], stub=False)
    if e["_stub"]:  # created earlier as the target of another row's wrong link
        e.update(标准号=s["code"].strip(), 名称=s["name"], _stub=False)
    if not e["官网状态"]:
        e.update(
            官网状态=s["status"],
            批准日期=s.get("issueDate", ""),
            实施日期=s.get("actDate", ""),
            官网分类=s.get("category", ""),
            官网详情=s.get("detailUrl", ""),
            在线阅读=s.get("onlineUrl", ""),
            核实日期=collected,
            核实依据="全国标准信息公共服务平台“卫生健康委员会”分类目录快照",
        )
    elif e["标准号"] != s["code"].strip() or e["名称"] != s["name"]:
        note(e, f"官网目录重复列出：{s['code'].strip()}《{s['name']}》（{s['status']}）")
    if not has_pdf:
        if not e["官网PDF"]:
            e["官网PDF"] = "官网未提供"
        continue
    if digest not in pool and not p.is_file():
        raise SystemExit(f"missing {p}")
    cov = cover_of(digest)
    ckey, ctitle = cov if cov else (None, "")
    target, ident = key, "与官网目录一致" if cov else "未逐份核对封面"
    if ckey and ckey != key:
        printed = f"{label(ckey)}" + (f"《{ctitle}》" if ctitle else "")
        if ckey[1] != key[1]:
            target, ident = ckey, f"错链：官网目录记为 {s['code'].strip()}"
            note(
                e,
                f"官网入口 {s['code'].strip()} 返回的文件是 {printed}，已归入该标准目录；"
                "本条状态与日期不随文件转移",
            )
            e["差异类别"] = e["差异类别"] or "错链"
            edition(ckey, label(ckey), ctitle)
        elif ckey[0] != key[0] and ckey[2] == key[2]:
            conv = CONVERTED_2016.get((key[1], key[2]))
            why = (
                f"国卫通〔2016〕24号附件2第{conv}项将 WS {key[1]}—{key[2]} 转为推荐性"
                if conv and "WS-T" in (key[0], ckey[0])
                else "原因待核"
            )
            ident = f"前缀不同：封面 {label(ckey)}"
            e["差异类别"] = "前缀不同（2016 转为推荐性）" if conv else "前缀不同（原因待核）"
            e["文件内标识"] = printed
            note(
                e,
                f"文件封面写作 {label(ckey)}，官网目录写作 {s['code'].strip()}；"
                f"{why}；文件留在本条目下",
            )
        else:
            ident = f"身份冲突：封面 {printed}"
            e["差异类别"] = "目录与文件标识不一致"
            e["文件内标识"] = printed
            note(
                e,
                f"官网目录记为 {s['code'].strip()}《{s['name']}》，文件封面为 {printed}；"
                "两边都保留，身份待核",
            )
    remark = BOUND.get(digest, "")
    role = "合订" if digest in BOUND else "正文"
    src = pool.get(digest, p)
    row = put(folder(target), src, digest, file_row(p.name, role, "官网下载", ident, remark=remark))
    if target == key:
        e["官网PDF"] = "可用"
    elif not e["官网PDF"]:
        e["官网PDF"] = "链接到其他标准"
    src_row["归档路径"] = f"{row['目录']}/{row['文件名']}"

# a wrong link may have been seen before the row's own correct file (duplicate catalog rows)
for e in editions.values():
    if e["官网PDF"] == "可用" and e["差异类别"] == "错链":
        e["差异类别"] = "错链（重复条目之一）"
    if e["_stub"] and not e["官网PDF"]:
        e["官网PDF"] = "官网目录未列（经错链发现）"

# 2 Drive archive
records = [dict(r, kind="pdf") for r in inv["files"]]
for r in inv.get("nonpdf_records", []):
    sid = r["standard_id"]
    records.append(
        dict(
            r,
            kind=r["format"].lower(),
            code=sid.split("/AM")[0].rsplit("-", 1)[0],
            year=sid.split("/AM")[0].rsplit("-", 1)[-1],
            drive_name=r.get("drive_name") or r["name"],
            identity="",
            folder_key="99",
            amendment="/AM" in sid,
        )
    )
placed = {h: row for (d, h), row in files.items()}
partial = Counter(r["code"] for r in records if r["kind"] == "gif")
linked = Counter(r["code"] for r in records if r["kind"] == "gif" and r.get("drive_url"))
for r in records:
    m = re.search(r"/d/([^/]+)", r.get("drive_url") or "")
    did = m.group(1) if m else ""
    name = Path(r["drive_name"]).name
    src_row = {
        "sha256": r["sha256"],
        "来源": f"Drive 归档 {r['folder_key']}",
        "入口标识": r.get("standard_id") or r["code"],
        "入口名称": r.get("title", ""),
        "入口状态": r.get("status", "") or "",
        "官网详情": "",
        "下载地址": r.get("drive_url", ""),
        "原文件名": name,
        "Drive文件ID": did,
        "Drive归档身份": r.get("identity", ""),
        "取得时间": "",
        "说明": "",
    }
    sources.append(src_row)
    if r["sha256"] in placed:  # same bytes as an official download
        row = placed[r["sha256"]]
        src_row["归档路径"] = f"{row['目录']}/{row['文件名']}"
        continue
    src = pool.get(r["sha256"])
    if src is None:
        if r["kind"] == "gif" and not did:
            why = f"Drive 清单没有页图链接（全套 {partial[r['code']]} 页）"
        elif r["kind"] == "gif":
            why = f"页图未下载（全套 {partial[r['code']]} 页，有链接 {linked[r['code']]} 页）"
        elif not did:
            why = "Drive 清单没有文件链接"
        elif (r.get("size") or 0) > 10 * 1024 * 1024:
            why = "超过 Drive 连接器单次下载上限 10 MB（实测报错 File too large）"
        else:
            why = "尚未下载"
        src_row["说明"] = why
        unmatched.append(
            {
                "来源": f"Drive {r['folder_key']}",
                "标识": r["drive_name"],
                "原因": why,
                "字节": r.get("size", ""),
                "sha256": r["sha256"],
                "Drive文件ID": did,
            }
        )
        continue
    key = (
        parse(r["code"], r.get("year"))
        or parse(r.get("standard_id") or "", r.get("year"))
        or parse(r["drive_name"].replace("_", " ", 1), r.get("year"))
    )
    ident = (
        "Drive 已核对封面"
        if r.get("identity_verified") or "核对" in (r.get("identity") or "")
        else "待核"
    )
    remark = "；".join(r.get("issues") or [])[:300]
    prev = parse((r.get("previous_ledger_identity") or {}).get("standard_id") or "")
    if key and key not in editions and prev and prev in editions and not editions[prev]["_stub"]:
        ident = f"身份冲突：封面 {label(key)}"
        note(
            editions[prev],
            f"Drive 归档另有封面为 {label(key)} 的文件，原台账记为本条，留在本条目下",
        )
        key = prev
    elif (
        key
        and key not in editions
        and (OTHER[key[0]], key[1], key[2]) in editions
        and key[0] in ("WS", "WS-T")
        and not editions[(OTHER[key[0]], key[1], key[2])]["_stub"]
    ):
        alt = (OTHER[key[0]], key[1], key[2])
        ident = f"前缀不同：封面 {label(key)}"
        conv = CONVERTED_2016.get((key[1], key[2]))
        why = (
            f"；国卫通〔2016〕24号附件2第{conv}项将 WS {key[1]}—{key[2]} 转为推荐性" if conv else ""
        )
        note(editions[alt], f"Drive 归档另有封面写作 {label(key)} 的文件，留在本条目下{why}")
        key = alt
    if r["kind"] == "gif":
        role, complete = "原页图", "单页页图"
    elif "修改单" in name or r.get("amendment"):
        role, complete = "修改单", "完整文件"
    elif r["kind"] == "docx":
        role, complete = "原格式", "完整文件"
    else:
        role, complete = ("正文" if key else "相关资料"), "完整文件"
    dest = folder(key) if key else originals / "_相关官方资料" / str(r.get("year") or "无年份")
    if r["kind"] == "gif":
        dest = dest / "原页图"
    row = put(
        dest,
        src,
        r["sha256"],
        file_row(name, role, f"Drive 归档 {r['folder_key']}", ident, complete, remark),
    )
    placed[r["sha256"]] = row
    src_row["归档路径"] = f"{row['目录']}/{row['文件名']}"
    if key and key not in editions:
        edition(key, r["code"] or r.get("standard_id", ""), r.get("title", ""))["官网PDF"] = (
            "不在卫生健康委员会分类"
        )
    elif key and not editions[key]["名称"]:
        editions[key]["名称"] = r.get("title", "")

pages = Counter(r["目录"].removesuffix("/原页图") for r in files.values() if r["角色"] == "原页图")
for r in records:  # page images: say how much of the set is here
    key = parse(r["code"], r.get("year")) if r["kind"] == "gif" else None
    if key in editions and partial[r["code"]] > pages[str(folder(key).relative_to(originals))]:
        n = pages[str(folder(key).relative_to(originals))]
        note(editions[key], f"原页图不全：全套 {partial[r['code']]} 页，已收 {n} 页")
        partial[r["code"]] = 0  # note once

for s in sources:  # rows that point at bytes filed through another row (yearless codes, duplicates)
    if not s.get("归档路径") and s["sha256"] in placed:
        s["归档路径"] = f"{placed[s['sha256']]['目录']}/{placed[s['sha256']]['文件名']}"

# the same number written as WS and WS/T (or GB and GB/T) in the official catalog itself
for (s, n, y), e in editions.items():
    o = editions.get((OTHER[s], n, y))
    if o and not e["_stub"] and not o["_stub"]:
        note(e, f"官网目录同号同年另有 {OTHER[s].replace('-', '/')} 写法，待核对")

# 3 structured revisions -> local files
by_dir = defaultdict(list)
for row in files.values():
    by_dir[row["目录"].split("/原页图")[0]].append(row)
structured = []
if args.structured:
    rows_by_sha = defaultdict(list)
    for row in files.values():
        rows_by_sha[row["sha256"]].append(row)
    for d in csv.DictReader(open(args.structured, encoding="utf-8"), delimiter="\t"):
        rev = f"#{d['id']} {d['standard_no']}—{d['standard_year']} "
        rev += f"{d['reader']} v{d['reader_version']}"
        hits = rows_by_sha.get(d["source_sha256"] or "", [])
        for row in hits:
            note(row, rev, "结构化处理修订")
        if not d["source_sha256"]:
            result = "未记载原文件摘要，待确认"
        elif hits:
            actual = {sha(originals / h["目录"] / h["文件名"]) for h in hits}
            result = "一致" if actual == {d["source_sha256"]} else "冲突"
        else:
            result = "本地缺失"
        structured.append(
            {
                "source_document": d["id"],
                "资料包": d["package"],
                "资料族": d["family"],
                "标准号": d["standard_no"],
                "原文年份": d["standard_year"],
                "读取器": d["reader"],
                "读取器版本": d["reader_version"],
                "包内原文件": d["source_pdf"],
                "记载sha256": d["source_sha256"],
                "本地文件": "；".join(f"{h['目录']}/{h['文件名']}" for h in hits),
                "实际sha256": "；".join(sorted({h["sha256"] for h in hits})),
                "结果": result,
            }
        )

# 4 catalogs
catalog.mkdir(parents=True, exist_ok=True)


def write(name, cols, rows):
    with open(catalog / name, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


write(
    "files.csv",
    [
        "目录",
        "文件名",
        "角色",
        "来源",
        "身份核对",
        "完整性",
        "字节",
        "sha256",
        "结构化处理修订",
        "备注",
    ],
    sorted(files.values(), key=lambda r: (r["目录"], r["角色"], r["文件名"])),
)


def coverage(rs, e):
    if e["差异类别"] == "目录与文件标识不一致":
        return "身份冲突"
    if any(r["角色"] in ("正文", "合订", "原格式") for r in rs):  # 原格式: the official DOCX text
        return "有正文"
    if rs:
        return "部分资料"
    return "仅目录"


erows = []
for key in sorted(editions, key=lambda k: (k[0], [int(x) for x in k[1].split(".")], k[2])):
    e = editions[key]
    d = str(folder(key).relative_to(originals))
    rs = by_dir.get(d, [])
    body = sum(1 for r in rs if r["角色"] in ("正文", "合订"))
    if body > 1:
        note(e, f"同版有 {body} 份不同字节的正文，未指定首选")
    erows.append(
        dict(
            e,
            系列=key[0],
            编号=f"{key[0].replace('-', '/')} {key[1]}",
            年份=key[2],
            目录=d if rs else "",
            正文=body,
            修改单=sum(1 for r in rs if r["角色"] == "修改单"),
            其他文件=sum(1 for r in rs if r["角色"] not in ("正文", "合订", "修改单")),
            收录情况=coverage(rs, e),
            当前结构化成果="是" if any(r["结构化处理修订"] for r in rs) else "",
        )
    )
write(
    "editions.csv",
    [
        "系列",
        "编号",
        "年份",
        "标准号",
        "名称",
        "官网状态",
        "批准日期",
        "实施日期",
        "官网分类",
        "官网PDF",
        "差异类别",
        "文件内标识",
        "收录情况",
        "目录",
        "正文",
        "修改单",
        "其他文件",
        "当前结构化成果",
        "官网详情",
        "在线阅读",
        "核实日期",
        "核实依据",
        "备注",
    ],
    erows,
)
write(
    "sources.csv",
    [
        "sha256",
        "归档路径",
        "来源",
        "入口标识",
        "入口名称",
        "入口状态",
        "官网详情",
        "下载地址",
        "原文件名",
        "Drive文件ID",
        "Drive归档身份",
        "取得时间",
        "说明",
    ],
    sources,
)
write("unmatched.csv", ["来源", "标识", "原因", "字节", "sha256", "Drive文件ID"], unmatched)
if structured:
    write("structured.csv", list(structured[0]), structured)

# 5 reconciliation counts
off_src = [s for s in sources if s["来源"] == "官网下载" and s["sha256"]]
drv_src = [s for s in sources if s["来源"].startswith("Drive")]
off_sha = {s["sha256"] for s in off_src}
counts = [
    ("官网目录记录", len(std), "standards.json"),
    ("官网目录记录·有下载文件", len(off_src), "下载文件名可能重复指向同一字节"),
    ("官网下载·不同字节", len(off_sha), ""),
    ("Drive 清单记录", len(drv_src), "PDF 与非 PDF"),
    (
        "Drive 记录·与官网下载同字节",
        sum(1 for s in drv_src if s["sha256"] in off_sha),
        "不另存，来源记入 sources.csv",
    ),
    (
        "Drive 记录·独有且已归档",
        len({s["sha256"] for s in drv_src if s.get("归档路径") and s["sha256"] not in off_sha}),
        "按字节计",
    ),
    ("Drive 记录·未取得", sum(1 for s in drv_src if not s.get("归档路径")), "见 unmatched.csv"),
    ("归档文件", len(files), "官网下载不同字节 + Drive 独有已归档"),
    ("目录·版次记录", len(editions), "不是已确认的标准数"),
]
for k, v in Counter(r["收录情况"] for r in erows).items():
    counts.append((f"目录·版次记录·{k}", v, ""))
for k, v in Counter(e["差异类别"] for e in editions.values() if e["差异类别"]).items():
    counts.append((f"差异·{k}", v, ""))
for k, v in Counter(r["角色"] for r in files.values()).items():
    counts.append((f"文件角色·{k}", v, ""))
if structured:
    for k, v in Counter(s["结果"] for s in structured).items():
        counts.append((f"结构化处理修订·{k}", v, ""))
write(
    "counts.csv",
    ["项目", "数量", "说明"],
    [{"项目": c[0], "数量": c[1], "说明": c[2]} for c in counts],
)
for c in counts:
    print(f"{c[0]}\t{c[1]}")
