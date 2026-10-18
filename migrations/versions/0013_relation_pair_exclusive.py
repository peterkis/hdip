"""同一主体与同一院区，同一时期只能有一条关系（2026-10-19 Peter 决定）

原约束 operator_relation_dup_excl 只禁止同类型重叠，所以“运营”生效期间还能再建一条“收费”。
改为不论类型：同一主体—同一院区的关系期间不得重叠。
要换类型 = 关闭旧关系（最后有效日 D-1）+ 自 D 新建。
已有重叠数据时迁移失败并列出（历史不能删，需人工处理或重建走查库）。

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(
           format('#%s(%s) 与 #%s(%s)', a.id, a.relation_type, b.id, b.relation_type), '；')
    INTO clash
    FROM operator_relation a
    JOIN operator_relation b
      ON a.institution_id = b.institution_id AND a.campus_id = b.campus_id AND a.id < b.id
     AND daterange(a.valid_from, a.valid_to, '[]') && daterange(b.valid_from, b.valid_to, '[]');
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION '已有同一主体与同一院区期间重叠的关系：%', clash;
  END IF;
END $$;
ALTER TABLE operator_relation DROP CONSTRAINT operator_relation_dup_excl;
ALTER TABLE operator_relation ADD CONSTRAINT operator_relation_pair_excl EXCLUDE USING gist (
  institution_id WITH =, campus_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE operator_relation DROP CONSTRAINT operator_relation_pair_excl;
ALTER TABLE operator_relation ADD CONSTRAINT operator_relation_dup_excl EXCLUDE USING gist (
  institution_id WITH =, campus_id WITH =, relation_type WITH =,
  daterange(valid_from, valid_to, '[]') WITH &&);
""")
