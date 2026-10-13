"""baseline：扩展与公共约定

btree_gist 用于“同一对象版本期间不重叠”的排他约束：
    EXCLUDE USING gist (xxx_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
valid_to 为 NULL 表示长期有效，daterange 的上界为空即无穷，闭区间 '[]' 两端含当日。

Revision ID: 0001
Revises:
Create Date: 2026-10-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS btree_gist")
