"""人员模块 P1.2：姓名修订（更名 / 更正）、换工号、补主部门归属的确认规则

表结构不变（0016 已有 revise_reason 与带期间的工号、归属）；只登记三类新变更的确认规则。

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
INSERT INTO approval_rule (object_type, action) VALUES
  ('person', 'revise'),
  ('person', 'change_work_no'),
  ('person', 'assign');
""")


def downgrade() -> None:
    op.execute("""
DELETE FROM approval_rule
  WHERE object_type = 'person' AND action IN ('revise', 'change_work_no', 'assign');
""")
