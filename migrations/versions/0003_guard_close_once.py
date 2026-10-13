"""收紧历史保护：可改列只能在“结束日从空设为某日”的那一次写入里改

0002 的 hdip_guard_update 只防住了 valid_to 被二次修改，运营关系的关闭信息
（closed_change_id、closed_at、closed_by）在关闭后仍可改写，违反“不覆盖历史”。
现在：未结束的行，可改列只能随 valid_to 一起写入；已结束的行，整行不可再改。

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
-- 用法：hdip_guard_update('valid_to', 'col2', ...) —— 只有列出的列可以修改，
-- 而且只能在 valid_to 从空设为某日的那一次写入里修改；之后整行不可再改。
-- 未列任何列 = 整行不可更新。
CREATE OR REPLACE FUNCTION hdip_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable text[] := coalesce(TG_ARGV, '{}'::text[]);
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF 'valid_to' = ANY (mutable)
     AND (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to')
     AND NOT (OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL) THEN
    RAISE EXCEPTION '关闭信息只能在结束时写入一次（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF 'valid_to' = ANY (mutable)
     AND OLD.valid_to IS NOT NULL
     AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION '已结束的期间不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
"""

DOWNGRADE = r"""
CREATE OR REPLACE FUNCTION hdip_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable text[] := coalesce(TG_ARGV, '{}'::text[]);
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF 'valid_to' = ANY (mutable)
     AND OLD.valid_to IS NOT NULL
     AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION '已结束的期间不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
