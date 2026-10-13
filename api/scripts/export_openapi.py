"""导出 OpenAPI 到 web/openapi.json，供 orval 生成前端类型与 TanStack Query hooks。

用法（在 api/ 目录下）：uv run python scripts/export_openapi.py
"""

import json
from pathlib import Path

from hdip_api.main import app

out = Path(__file__).resolve().parents[2] / "web" / "openapi.json"
out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {out}")
