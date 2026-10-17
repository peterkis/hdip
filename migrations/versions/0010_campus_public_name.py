"""院区“对外名称”（2026-10-17 Peter 决定：节点角色采用方案 B）

节点角色的三个码值与三个院区一一对应，和院区名称重复，表单不再维护；已有取值留在历史版本里。
院区对外叫法不同时（中心院区对外称“成都市中心医院”）写在新列 public_name，随版本走。

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE campus_version ADD COLUMN public_name text;
ALTER TABLE campus_version ADD CONSTRAINT campus_version_public_name_check
  CHECK (public_name IS NULL OR btrim(public_name) <> '');
COMMENT ON COLUMN campus_version.public_name IS '对外名称：对外使用、与院区名称不同的叫法';
COMMENT ON COLUMN campus_version.node_role IS '节点角色（已停用，只保留历史取值）';
""")


def downgrade() -> None:
    op.execute("ALTER TABLE campus_version DROP COLUMN public_name")
