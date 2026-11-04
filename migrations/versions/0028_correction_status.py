"""标准资料库：人工更正可登记状态（现行 / 废止）

计划：docs/标准资料库-封面日期补全.md 第 1 节（Peter 2026-11-04 在官网核实 GB/T 2312—1980、
WS 377.4—2013 为现行，要求经更正表登记）。

- standard_catalog_correction.field 增加 'status'；新值只认“现行 / 废止”（导入时检查，
  这里同样限定，防止绕过导入写入别的值）。生效时核实日期 = 确认日期、核实依据 = 本行，
  满足 standard_edition_version_basis_check；不能清空，回到待核实须撤销那一行。

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "'title', 'issued_on', 'effective_on', 'abolished_on', 'difference', 'file_identity', 'note'"


def upgrade() -> None:
    op.execute(f"""
ALTER TABLE standard_catalog_correction DROP CONSTRAINT standard_catalog_correction_field_check;
ALTER TABLE standard_catalog_correction ADD CONSTRAINT standard_catalog_correction_field_check
  CHECK (field IN ({OLD}, 'status'));
ALTER TABLE standard_catalog_correction ADD CONSTRAINT standard_catalog_correction_status_check
  CHECK (field IS DISTINCT FROM 'status' OR (new_value IN ('现行', '废止') AND NOT clears));
""")


def downgrade() -> None:
    op.execute(f"""
ALTER TABLE standard_catalog_correction DROP CONSTRAINT standard_catalog_correction_status_check;
ALTER TABLE standard_catalog_correction DROP CONSTRAINT standard_catalog_correction_field_check;
ALTER TABLE standard_catalog_correction ADD CONSTRAINT standard_catalog_correction_field_check
  CHECK (field IN ({OLD}));
""")
