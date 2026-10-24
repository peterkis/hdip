"""部门职务的任职依据 basis_note（A1，docs/人员域边界复审与实施计划.md 决定 B-3）

任命、交接时必填（应用层检查，1–500 字）；结束的依据选填，只留在申请里。
列可空：之前登记的职务没有依据，显示“历史记录未提供依据”，不补写、不伪造。

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE person_duty ADD COLUMN basis_note text
  CONSTRAINT person_duty_basis_note_check
  CHECK (basis_note IS NULL OR char_length(basis_note) BETWEEN 1 AND 500);
COMMENT ON COLUMN person_duty.basis_note IS
  '任职依据（任命文件、会议纪要等的文字说明）；任命、交接时必填，A1 之前的记录为空';
""")


def downgrade() -> None:
    op.execute("ALTER TABLE person_duty DROP COLUMN basis_note;")
