"""人员状态名称改为“有效任用 / 计划中 / 无效任用”（2026-10-23 Peter）

只改 option_item 里 person_relation_status 的中文名
（导出 persons.csv 的 relation_status_name 列随之变化），码值 ENGAGED / PLANNED / NONE 不变。

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
UPDATE option_item SET name = '有效任用'
  WHERE category = 'person_relation_status' AND code = 'ENGAGED';
UPDATE option_item SET name = '计划中'
  WHERE category = 'person_relation_status' AND code = 'PLANNED';
UPDATE option_item SET name = '无效任用'
  WHERE category = 'person_relation_status' AND code = 'NONE';
""")


def downgrade() -> None:
    op.execute("""
UPDATE option_item SET name = '有有效任用'
  WHERE category = 'person_relation_status' AND code = 'ENGAGED';
UPDATE option_item SET name = '仅有计划任用'
  WHERE category = 'person_relation_status' AND code = 'PLANNED';
UPDATE option_item SET name = '无有效任用'
  WHERE category = 'person_relation_status' AND code = 'NONE';
""")
