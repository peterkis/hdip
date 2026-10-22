"""人员模块 P1.3：结束任用 / 调整结束日 / 撤销计划的确认规则

表结构不变（0016 的 hdip_guard_open_end 已允许结束日在到达前修改）。

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO approval_rule (object_type, action) VALUES ('person', 'engagement_set_end');"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM approval_rule WHERE object_type = 'person' AND action = 'engagement_set_end';"
    )
