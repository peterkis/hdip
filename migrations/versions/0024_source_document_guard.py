"""标准资料库：source_document 的更新保护改用允许列（PR #4 审查）

0023 的 source_document_guard() 手工列举不可改字段，漏了 title、source_version、source_pdf、
source_url 等。改用通用的 hdip_guard_update('covered_keys', 'imported_at')：只有接入覆盖与导入时间
可以随导入范围扩大而更新，其余列一律不可改；移除不再使用的自定义函数。已导入的数据不动。

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
DROP TRIGGER source_document_guard ON source_document;
DROP FUNCTION source_document_guard();
CREATE TRIGGER source_document_guard BEFORE UPDATE ON source_document
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('covered_keys', 'imported_at');
""")


def downgrade() -> None:
    op.execute("""
DROP TRIGGER source_document_guard ON source_document;
CREATE OR REPLACE FUNCTION source_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.package_id, NEW.standard_no, NEW.standard_year, NEW.family, NEW.members,
      NEW.reader, NEW.reader_version, NEW.total_records, NEW.source_sha256)
     IS DISTINCT FROM
     (OLD.package_id, OLD.standard_no, OLD.standard_year, OLD.family, OLD.members,
      OLD.reader, OLD.reader_version, OLD.total_records, OLD.source_sha256) THEN
    RAISE EXCEPTION 'source_document 的身份字段不可修改' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'source_document_identity_guard';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_document_guard BEFORE UPDATE ON source_document
  FOR EACH ROW EXECUTE FUNCTION source_document_guard();
""")
