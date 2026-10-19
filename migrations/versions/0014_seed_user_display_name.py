"""种子账号 solo 的显示名称改为“张三”（2026-10-19 Peter 要求）

原名“一人维护（维护+确认）”出现在申请进度条的操作人位置不像人名。只改显示名称；
用户名 solo、角色不变，已有申请里记录的仍是同一用户 id。

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE app_user SET display_name = '张三' WHERE username = 'solo'")


def downgrade() -> None:
    op.execute("UPDATE app_user SET display_name = '一人维护（维护+确认）' WHERE username = 'solo'")
