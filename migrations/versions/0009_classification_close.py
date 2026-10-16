"""结束单条分类赋值（剧本走查发现）

可多选的分类方案只能新增、无法结束一条已有的分类；单选方案虽可“改为另一个”，也没有只结束不替换
以外的写法。新增变更项 department.classification_close / service_unit.classification_close，
按赋值 id 写最后有效日（当天仍有效）。表结构不变，只加确认规则。

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO approval_rule (object_type, action) VALUES "
        "('department', 'classification_close'), ('service_unit', 'classification_close')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM approval_rule WHERE action = 'classification_close'")
