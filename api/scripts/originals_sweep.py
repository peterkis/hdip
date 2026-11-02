"""File Drive connector download results: check each against the Drive archive inventory
by SHA-256 and size, write the verified bytes into an inbox, and append a ledger line.

usage:
  python -I api/scripts/originals_sweep.py <inventory.json> <inbox_dir> <tool_results_dir>
         <ledger.tsv>

A result is a JSON file {"id": <Drive file id>, "content": <base64>} saved by the connector.
Files go to <inbox>/<标准号>_<年份>/ (records without a standard number to
<inbox>/_无标准号/). A file with the same name but other content is never overwritten. A
verified result file is removed after filing (it can be fetched again). originals_build.py
then picks the inbox up with --pool.
"""

import base64
import hashlib
import json
import re
import sys
from pathlib import Path

inv = json.load(open(sys.argv[1], encoding="utf-8"))
by_id = {}
for f in inv["files"]:
    m = re.search(r"/d/([^/]+)", f.get("drive_url") or "")
    if m:
        by_id[m.group(1)] = f
for f in inv.get("nonpdf_records", []):
    m = re.search(r"/d/([^/]+)", f.get("drive_url") or "")
    if m:
        sid = f["standard_id"].split("/AM")[0]
        code, _, year = sid.rpartition("-")
        by_id[m.group(1)] = dict(
            f, code=code, year=year, folder_key="99", drive_name=f["drive_name"] or f["name"]
        )
root, results, ledger = Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])


def slug(code, year):
    if not code:
        return "_无标准号"
    s = re.sub(r"[/\s]+", "-", code.strip())
    return f"{s}_{year}" if year else s


ok = bad = 0
with ledger.open("a", encoding="utf-8") as led:
    for p in sorted(results.glob("*download_file_content*.txt")):
        try:
            r = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        rec = by_id.get(r.get("id"))
        if rec is None or rec["folder_key"] == "01":
            continue
        data = base64.b64decode(r["content"])
        sha = hashlib.sha256(data).hexdigest()
        if sha != rec["sha256"] or len(data) != rec["size"]:
            print("MISMATCH", r["id"], rec["drive_name"])
            bad += 1
            continue
        d = root / slug(rec["code"], rec["year"])
        d.mkdir(parents=True, exist_ok=True)
        t = d / Path(rec["drive_name"]).name
        if t.exists() and hashlib.sha256(t.read_bytes()).hexdigest() != sha:
            print("EXISTS WITH OTHER CONTENT", t)
            bad += 1
            continue
        if not t.exists():
            t.write_bytes(data)
            ok += 1
        led.write(f"{r['id']}\t{sha}\t{t.relative_to(root)}\n")
        p.unlink()
print(f"filed {ok}, problems {bad}")
