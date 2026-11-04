"""从原文封面识别缺失的发布 / 实施日期，生成仓库 data/standards/cover-dates.csv（不碰数据库）。

用法（在 api/ 下，只在 macOS 上能跑：OCR 用系统 Vision，渲染用 poppler 的 pdftoppm）：
  uv run python scripts/cover_dates_build.py --transcripts /Volumes/新加卷/drive \
      /Volumes/新加卷/mdm/uniData/expanded/sources/study /Volumes/新加卷/mdm/uniData/catalog

- 对象：hdip-standards/catalog/editions.csv 里批准日期或实施日期为空的标准；读它在 files.csv 里的
  正文 / 合订 / 原格式文件（不读修改单、页图）。
- 封面：PDF 渲染前 3 页，取第一张读到“yyyy-mm-dd 发布 / 实施”的页；DOCX 用 textutil 取前 40 行。
  日期只取封面，转写成果（Drive 资料包、MinerU、uniData 目录里带这项标准号的发布 / 实施日期字段）
  只用来比对，写进“转写成果比对”列，不拿来补封面上没有的日期。
- 同一标准多份正文封面不一致 → 不写，列在输出里。OCR 漏读、读错的由人看封面图片核对后写在
  REVIEWED（写明看到的内容）；封面本身没印的日期不补。
- 输出按标准号、年份、字段排序，一行一个日期；重跑结果相同。
"""

import argparse
import collections
import csv
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "standards" / "cover-dates.csv"
COLS = [
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
FIELD = {"issued": "发布日期", "effective": "实施日期"}

# 人看封面图片核对的结果（2026-11-04）：OCR 漏读或封面本身没印。值为 None = 封面上没有，不补
REVIEWED = {
    ("WS 377.7", "2013", "effective"): (
        "2014-05-01",
        "OCR 漏读，看封面图片核对：右下“2014-05-01 实施”",
    ),
    ("WS/T 452", "2014", "effective"): (
        "2014-10-01",
        "OCR 漏读，看封面图片核对：右下“2014-10-01实施”",
    ),
    ("WS 377.4", "2013", "issued"): (None, "封面左下印“2013-  -  发布”，月日空白，不补"),
}
# OCR 读出、与转写不一致或没有转写的，人看封面图片核对过（2026-11-04），写进“说明”
CHECKED = {
    ("GB 12403", "1990"): "看封面图片核对：GB 12403—90，1990-07-05 发布、1991-05-01 实施",
    ("GB 3304", "1991"): "看封面图片核对：GB 3304—91，1991-08-30 发布、1992-04-01 实施",
    (
        "GB/T 21715.6",
        "2020",
    ): "看封面图片核对：右下“2020-12-01 实施”；转写成果的 2021-01-01 与封面不符",
    (
        "GB/T 21715.8",
        "2020",
    ): "看封面图片核对：右下“2020-12-01 实施”；转写成果的 2021-01-01 与封面不符",
    ("WS 438", "2013"): "看封面图片核对：两份文件封面都是 WS 438—2013《裂头蚴病的诊断》",
    ("WS 446", "2014"): "看封面图片核对：左下“2014-05-30 发布”；转写成果的 2014-06-20 与封面不符",
}

STD = re.compile(r"\b(GB/T|GB|WS/T|WS)\s*(\d+(?:\.\d+)*)\s*[-—–－]\s*(\d{4})\b")
COVER = re.compile(r"(\d{4})\s*[-－—一.]\s*(\d{1,2})\s*[-－—一.]\s*(\d{1,2})\s*(发布|实施)")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TEXT_ROLES = {"正文": 0, "合订": 1, "原格式": 2}  # 依据文件优先取正文

# 转写成果里的日期键（按资料实际出现的写法列出）；修改单、通告、代码有效期等键不在此列
ISSUE = {
    "issue_date", "standard_issue_date", "standard_publication_date", "publication_date",
    "published_date", "cover_issue_date", "formal_issue_date", "issue_date_directory",
    "catalogue_publication_date", "directory_issue", "registration_issue_date",
    "issue_date_registry", "issued_on", "issued", "issue", "publish_date", "发布日期",
}  # fmt: skip
EFFECTIVE = {
    "effective_date", "standard_effective_date", "implementation_date", "cover_effective_date",
    "cover_implementation_date", "formal_effective_date", "effective_date_directory",
    "catalogue_effective_date", "directory_effective", "registration_effective_date",
    "effective_date_registry", "effective_on", "effective", "implemented", "implement_date",
    "实施日期",
}  # fmt: skip
CODE_KEYS = (
    "standard",
    "standard_code",
    "code",
    "source_standard",
    "standard_id",
    "standard_number",
)


def rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def targets(std_dir: Path) -> dict[tuple[str, str], list[dict]]:
    """缺日期的标准 → 它的正文类文件（files.csv 行，带本地路径）。"""
    cat = std_dir / "catalog"
    missing = {}
    for r in rows(cat / "editions.csv"):
        if not r["批准日期"] or not r["实施日期"]:
            missing[r["目录"]] = (r["编号"], r["年份"])
    out: dict[tuple[str, str], list[dict]] = {k: [] for k in missing.values()}
    for r in rows(cat / "files.csv"):
        k = missing.get(r["目录"])
        if k and r["角色"] in TEXT_ROLES and r["完整性"] == "完整文件":
            out[k].append(r | {"path": std_dir / "originals" / r["目录"] / r["文件名"]})
    for fs in out.values():
        fs.sort(key=lambda r: (TEXT_ROLES[r["角色"]], r["文件名"]))
    return out


def cover_dates(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for m in COVER.finditer(text.replace(" ", "")):
        y, mo, d, kind = m.groups()
        found.setdefault(
            "issued" if kind == "发布" else "effective", f"{y}-{int(mo):02d}-{int(d):02d}"
        )
    return found


def read_cover(f: dict, work: Path, ocr: Path) -> tuple[str | None, dict[str, str]]:
    """返回（页码说明，日期）；读不到为（None, {}）。"""
    p = f["path"]
    if p.suffix.lower() == ".docx":
        text = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", str(p)], capture_output=True, text=True
        ).stdout
        d = cover_dates("\n".join(text.splitlines()[:40]))
        return ("DOCX 封面", d) if d else (None, {})
    for page in (1, 2, 3):
        png = work / f"{f['sha256'][:16]}-{page}"
        r = subprocess.run(
            [
                "pdftoppm",
                "-f",
                str(page),
                "-l",
                str(page),
                "-r",
                "150",
                "-png",
                "-singlefile",
                str(p),
                str(png),
            ],
            capture_output=True,
        )
        if r.returncode:
            break
        text = subprocess.run([str(ocr), f"{png}.png"], capture_output=True, text=True).stdout
        d = cover_dates(text)
        if d:
            return f"PDF 第 {page} 页", d
    return None, {}


# ---------------------------------------------------------------- 转写成果（只读，只作比对）


def code_of(d: dict):
    for k in CODE_KEYS:
        v = d.get(k)
        if isinstance(v, str) and (m := STD.search(v)):
            return (f"{m[1]} {m[2]}", m[3])
    found = {
        (f"{m[1]} {m[2]}", m[3])
        for v in d.values()
        if isinstance(v, str) and len(v) < 120
        for m in STD.finditer(v)
    }
    return found.pop() if len(found) == 1 else None


def harvest(roots: list[str], wanted: set) -> dict:
    seen: dict = collections.defaultdict(collections.Counter)

    def emit(code, field, v):
        if code in wanted and isinstance(v, str) and DATE.match(v.strip()):
            seen[(code, field)][v.strip()] += 1

    def walk(o, inherited=None):
        if isinstance(o, dict):
            code = code_of(o) or inherited
            for k, v in o.items():
                if code and k in ISSUE:
                    emit(code, "issued", v)
                elif code and k in EFFECTIVE:
                    emit(code, "effective", v)
                if isinstance(v, (dict, list)):
                    walk(v, code)
        elif isinstance(o, list):
            if len(o) == 3 and all(isinstance(x, str) for x in o) and (m := STD.search(o[0])):
                code = (f"{m[1]} {m[2]}", m[3])
                if o[1] in ISSUE:
                    emit(code, "issued", o[2])
                elif o[1] in EFFECTIVE:
                    emit(code, "effective", o[2])
            for v in o:
                walk(v, inherited)

    def feed(name: str, data: bytes):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            return
        for chunk in text.splitlines() if name.endswith(".jsonl") else [text]:
            try:
                walk(json.loads(chunk))
            except ValueError:
                pass

    def scan_zip(zf: zipfile.ZipFile, depth=0):
        for info in zf.infolist():
            n = info.filename.lower()
            if n.endswith((".json", ".jsonl")) and info.file_size < 200_000_000:
                feed(n, zf.read(info))
            elif n.endswith(".zip") and depth < 3 and info.file_size < 2_000_000_000:
                try:
                    scan_zip(zipfile.ZipFile(io.BytesIO(zf.read(info))), depth + 1)
                except zipfile.BadZipFile:
                    pass

    for root in roots:
        for d, _, files in os.walk(root):
            if "manifest.json" in files and os.path.exists(
                md := os.path.join(d, "raw", "extracted", "full.md")
            ):
                try:
                    man = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))
                    m = STD.search(man.get("code", ""))
                    if m:
                        head = "\n".join(
                            open(md, encoding="utf-8", errors="replace").read().splitlines()[:80]
                        )
                        for field, v in cover_dates(head).items():
                            emit((f"{m[1]} {m[2]}", m[3]), field, v)
                except (OSError, ValueError):
                    pass
            for f in files:
                p = os.path.join(d, f)
                low = f.lower()
                try:
                    if low.endswith((".json", ".jsonl")) and os.path.getsize(p) < 300_000_000:
                        feed(low, open(p, "rb").read())
                    elif low.endswith(".zip"):
                        scan_zip(zipfile.ZipFile(p))
                except (zipfile.BadZipFile, OSError):
                    pass
    return seen


def compare(value: str, counter: collections.Counter) -> str:
    if not counter:
        return "无转写"
    if value in counter:
        others = [f"{v}×{n}" for v, n in counter.most_common() if v != value]
        return f"一致（{counter[value]} 处）" + (f"；另有 {'、'.join(others)}" if others else "")
    return "不一致：转写记 " + "、".join(f"{v}×{n}" for v, n in counter.most_common())


def main() -> int:
    ap = argparse.ArgumentParser(description="从原文封面识别缺失的发布 / 实施日期")
    ap.add_argument("--standards-dir", default=str(REPO / "hdip-standards"))
    ap.add_argument("--transcripts", nargs="*", default=[], help="转写成果目录（只读，只作比对）")
    args = ap.parse_args()

    todo = targets(Path(args.standards_dir))
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        ocr = work / "cover_ocr"
        subprocess.run(
            ["swiftc", "-O", str(Path(__file__).with_name("cover_ocr.swift")), "-o", str(ocr)],
            check=True,
        )
        covers = {k: [(f, *read_cover(f, work, ocr)) for f in fs] for k, fs in todo.items()}
    seen = harvest(args.transcripts, set(todo))

    out, skipped = [], []
    for (no, year), recs in sorted(covers.items()):
        for field, label in FIELD.items():
            reviewed = REVIEWED.get((no, year, field))
            got = {d[field] for _, _, d in recs if field in d}
            if len(got) > 1:
                skipped.append(f"{no}—{year} {label}：多份正文封面不一致 {sorted(got)}")
                continue
            hit = next(((f, page) for f, page, d in recs if field in d), None)
            if got:
                value, how = got.pop(), "封面 OCR" if hit[1].startswith("PDF") else "DOCX 封面文字"
                note = CHECKED.get((no, year), "")
                f, page = hit
            elif reviewed and reviewed[0]:
                value, how, note = reviewed[0], "封面图片复核", reviewed[1]
                f, page = next(
                    ((f, page) for f, page, _ in recs if page),
                    (recs[0][0], "PDF 第 1 页") if recs else (None, None),
                )
            else:
                skipped.append(f"{no}—{year} {label}：{reviewed[1] if reviewed else '封面未读出'}")
                continue
            if f is None:
                skipped.append(f"{no}—{year} {label}：没有正文文件")
                continue
            found = seen.get(((no, year), field), collections.Counter())
            out.append({
                "标准号": no, "年份": year, "字段": label, "日期": value,
                "依据文件sha256": f["sha256"], "依据页码": page, "识别方式": how,
                "转写成果比对": compare(value, found), "说明": note,
            })  # fmt: skip
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, COLS, lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    editions = len({(r["标准号"], r["年份"]) for r in out})
    print(f"写出 {len(out)} 个日期（{editions} 项标准）→ {OUT.relative_to(REPO)}")
    for s in skipped:
        print(f"  未写：{s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
