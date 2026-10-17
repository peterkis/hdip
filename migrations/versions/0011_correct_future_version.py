"""未生效版本可更正（2026-10-17 Peter：生效前的修改不必等到生效日）

尚未生效的最新版本，可以在它的开始日当天修订：原版本的结束日写为开始日前一日，成为“空期间”
（从未生效，记录保留），新版本自同一天起。为此放宽四张版本表的期间检查（允许结束日 = 开始日 - 1），
排他约束改用半开区间 daterange(valid_from, valid_to + 1)：与原闭区间等价，空期间不与任何期间重叠。

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = {
    "institution_version": "institution_id",
    "campus_version": "campus_id",
    "department_version": "department_id",
    "service_unit_version": "service_unit_id",
}


def upgrade() -> None:
    for t, fk in TABLES.items():
        op.execute(f"""
ALTER TABLE {t} DROP CONSTRAINT {t}_period_check;
ALTER TABLE {t} ADD CONSTRAINT {t}_period_check
  CHECK (valid_to IS NULL OR valid_to >= valid_from - 1);
ALTER TABLE {t} DROP CONSTRAINT {t}_no_overlap;
ALTER TABLE {t} ADD CONSTRAINT {t}_no_overlap EXCLUDE USING gist (
  {fk} WITH =, daterange(valid_from, valid_to + 1) WITH &&);
""")


def downgrade() -> None:
    for t, fk in TABLES.items():
        op.execute(f"""
ALTER TABLE {t} DROP CONSTRAINT {t}_period_check;
ALTER TABLE {t} ADD CONSTRAINT {t}_period_check
  CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE {t} DROP CONSTRAINT {t}_no_overlap;
ALTER TABLE {t} ADD CONSTRAINT {t}_no_overlap EXCLUDE USING gist (
  {fk} WITH =, daterange(valid_from, valid_to, '[]') WITH &&);
""")
