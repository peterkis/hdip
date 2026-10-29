"""把标准资料包读进标准资料库（迁移 0023，docs/标准资料库-F0F1开发计划.md）。

用法（在 api/ 下）：
  uv run python scripts/import_standards.py <资料包 ZIP> --family ws363-364 \\
      [--select DE02.01.031.00,CV02.01.101] [--expected-sha256 <清单摘要>] \\
      [--release reaudit-structured-20261015] [--drive-id <Drive 文件 id>] [--url <来源链接>]

- 资料包须放在 HDIP_STANDARDS_DIR（默认仓库根目录的 hdip-standards/）下，库里只存相对路径。
- 标准资料是只读参考，不经变更申请：本命令用迁移账号（HDIP_MIGRATION_DATABASE_URL）写入，
  应用账号只读。
- 直接读 ZIP 成员，不解压、不运行包内程序。可重复运行：同字节的包、已接入的源记录都复用；
  扩大 --select 只补新记录。任何一条读不通就报位置并整体回滚，已有内容不变。
- --select 只接入列出的 DE / CV（值域带上全部代码行）；不给则接入所读成员的全部记录。
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from hdip_api.core.config import get_settings
from hdip_api.core.db import make_engine
from hdip_api.services.standards_import import READERS, ImportFailure, import_package


def main() -> int:
    ap = argparse.ArgumentParser(description="导入标准资料包")
    ap.add_argument("zip", type=Path)
    ap.add_argument("--family", required=True, choices=sorted(READERS))
    ap.add_argument("--select", help="逗号分隔的 DE / CV 标识")
    ap.add_argument("--expected-sha256")
    ap.add_argument("--release")
    ap.add_argument("--drive-id")
    ap.add_argument("--url")
    args = ap.parse_args()

    settings = get_settings()
    engine = make_engine(settings.migration_database_url)
    select_ids = {s.strip() for s in args.select.split(",") if s.strip()} if args.select else None
    try:
        with Session(engine) as session, session.begin():
            result = import_package(
                session,
                args.zip,
                Path(settings.standards_dir),
                args.family,
                select_ids=select_ids,
                expected_sha256=args.expected_sha256,
                release_id=args.release,
                drive_file_id=args.drive_id,
                source_url=args.url,
            )
    except ImportFailure as e:
        print(f"导入失败，未写入任何内容：{e}", file=sys.stderr)
        return 1
    print(f"资料包 #{result.package_id}（{'已登记，复用' if result.package_reused else '新登记'}）")
    if not args.expected_sha256:
        print("  未与清单摘要比对：只记录了本地摘要")
    for d in result.documents:
        print(
            f"  文档修订 #{d['document_id']} {d['standard']}（{d['reader']}）："
            f"本次新增 {d['added']}，已接入 {d['covered']} / {d['total']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
