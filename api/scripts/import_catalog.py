"""把原件层的标准目录与原文文件登记进标准资料库（迁移 0025）。

用法（在 api/ 下）：
  uv run python scripts/import_catalog.py [--check]

- 读 HDIP_STANDARDS_DIR（默认仓库根目录的 hdip-standards/）下 catalog/editions.csv 与 files.csv，
  它们由 scripts/originals_build.py 生成（见 hdip-standards/README.md）。
- 标准目录是只读参考，不经变更申请：本命令用迁移账号（HDIP_MIGRATION_DATABASE_URL）写入。
- --check 只列出将要新增的标准、追加的目录版本、登记的文件与全部问题，不写库。
- 不带参数时在一个事务里写入；任何一行有问题就整体回滚。重复运行不增行。
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from hdip_api.core.config import get_settings
from hdip_api.core.db import make_engine
from hdip_api.services.catalog_import import CatalogFailure, import_catalog


def main() -> int:
    ap = argparse.ArgumentParser(description="登记标准目录与原文文件")
    ap.add_argument("--check", action="store_true", help="只检查，不写库")
    args = ap.parse_args()

    settings = get_settings()
    engine = make_engine(settings.migration_database_url)
    try:
        with Session(engine) as session, session.begin():
            res = import_catalog(session, Path(settings.standards_dir), dry_run=args.check)
            if args.check:
                session.rollback()
    except CatalogFailure as e:
        print(f"{'检查' if args.check else '登记'}未通过，未写入任何内容：", file=sys.stderr)
        for p in e.problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    for c in res.changes[:20]:
        print(f"  {c}")
    if len(res.changes) > 20:
        print(f"  …… 另有 {len(res.changes) - 20} 项")
    verb = "将" if args.check else "已"
    print(
        f"{verb}新增标准 {res.editions_added}、目录版本 {res.versions_added}、"
        f"文件 {res.files_added}；未变 {res.unchanged}；"
        f"没有标准号的相关资料 {res.skipped_related} 份不登记"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
