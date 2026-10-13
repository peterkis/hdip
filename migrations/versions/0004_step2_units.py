"""第 2 步：部门（仅引用）与服务单元

- department：无版本表，名称与状态可改（改动的前后内容记在变更申请里，将来补版本表时回填）；
  状态预留“弃用”“被替代”。code 永不复用。
- hdip_guard_update 改为经 jsonb 读 valid_to（0003 的写法在没有 valid_to 的表上会报错）。
- service_unit：身份表，单元类型属于身份（不允许修订，职责变化走拆分或新建）。
- service_unit_version：部门 × 院区 × 运营主体 × 期间。
  永久退出 = 最新版本写上结束日，之后不再有版本。
  “部门在用、院区非停用、运营主体与院区有覆盖整个期间的运营关系”跨多张表，由 services/apply.py
  在每张申请应用完全部变更项后统一校验。

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CODE_CHECK = r"code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'"

UPGRADE = rf"""
-- ---------------------------------------------------------------- 历史保护
-- 与 0003 语义相同；改为经 jsonb 读取 valid_to，部门这类没有 valid_to 的表也能用
CREATE OR REPLACE FUNCTION hdip_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable  text[] := coalesce(TG_ARGV, '{{}}'::text[]);
  old_row  jsonb := to_jsonb(OLD);
  new_row  jsonb := to_jsonb(NEW);
BEGIN
  IF (new_row - mutable) IS DISTINCT FROM (old_row - mutable) THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF 'valid_to' = ANY (mutable) THEN
    IF old_row ->> 'valid_to' IS NOT NULL
       AND (new_row ->> 'valid_to') IS DISTINCT FROM (old_row ->> 'valid_to') THEN
      RAISE EXCEPTION '已结束的期间不可修改（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
    IF (new_row - 'valid_to') IS DISTINCT FROM (old_row - 'valid_to')
       AND NOT (old_row ->> 'valid_to' IS NULL AND new_row ->> 'valid_to' IS NOT NULL) THEN
      RAISE EXCEPTION '关闭信息只能在结束时写入一次（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------- 部门（仅引用）
CREATE TABLE department (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL CONSTRAINT department_code_uniq UNIQUE,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'ACTIVE',
  created_change_id bigint NOT NULL REFERENCES change_request,
  created_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  last_change_id    bigint NOT NULL REFERENCES change_request,
  updated_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT department_code_check CHECK ({CODE_CHECK}),
  CONSTRAINT department_name_check CHECK (btrim(name) <> ''),
  -- DEPRECATED（弃用，无后继）、SUPERSEDED（被替代，有后继）为部门拆分合并预留，MVP 不使用
  CONSTRAINT department_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED', 'SUPERSEDED'))
);
CREATE TRIGGER department_guard BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'status', 'last_change_id', 'updated_at');

-- ---------------------------------------------------------------- 服务单元
CREATE TABLE service_unit (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL CONSTRAINT service_unit_code_uniq UNIQUE,
  unit_type         text NOT NULL,
  created_change_id bigint NOT NULL REFERENCES change_request,
  created_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT service_unit_code_check CHECK ({CODE_CHECK}),
  -- 沿用既有码值，不新增、不重释
  CONSTRAINT service_unit_type_check
    CHECK (unit_type IN ('OPD', 'IPD', 'ED', 'EXAM', 'LAB', 'PHARMACY', 'OR', 'OTHER'))
);
CREATE TRIGGER service_unit_guard BEFORE UPDATE ON service_unit
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE service_unit_version (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_unit_id bigint NOT NULL REFERENCES service_unit,
  version_no      integer NOT NULL,
  valid_from      date NOT NULL,
  valid_to        date,
  change_id       bigint NOT NULL REFERENCES change_request,
  recorded_at     timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by     bigint NOT NULL REFERENCES app_user,
  name            text NOT NULL,
  department_id   bigint NOT NULL REFERENCES department,
  campus_id       bigint NOT NULL REFERENCES campus,
  institution_id  bigint NOT NULL REFERENCES institution,
  status          text NOT NULL DEFAULT 'ACTIVE',
  phone           text,
  scope_note      text,
  CONSTRAINT service_unit_version_no_uniq UNIQUE (service_unit_id, version_no),
  CONSTRAINT service_unit_version_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT service_unit_version_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT service_unit_version_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT service_unit_version_no_overlap EXCLUDE USING gist (
    service_unit_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX service_unit_version_campus_idx ON service_unit_version (campus_id);
CREATE INDEX service_unit_version_department_idx ON service_unit_version (department_id);
CREATE INDEX service_unit_version_institution_idx ON service_unit_version (institution_id);
CREATE TRIGGER service_unit_version_guard BEFORE UPDATE ON service_unit_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to');

-- ---------------------------------------------------------------- 种子
-- 码值沿用旧仓库；中文名称可在 option_item 中调整
INSERT INTO option_item (category, code, name, sort_order) VALUES
  ('service_unit_type', 'OPD',      '门诊',   10),
  ('service_unit_type', 'IPD',      '住院',   20),
  ('service_unit_type', 'ED',       '急诊',   30),
  ('service_unit_type', 'EXAM',     '检查',   40),
  ('service_unit_type', 'LAB',      '检验',   50),
  ('service_unit_type', 'PHARMACY', '药学',   60),
  ('service_unit_type', 'OR',       '手术',   70),
  ('service_unit_type', 'OTHER',    '其他',   80);

INSERT INTO approval_rule (object_type, action) VALUES
  ('department', 'create'), ('department', 'rename'), ('department', 'change_status'),
  ('service_unit', 'create'), ('service_unit', 'revise'), ('service_unit', 'rebind'),
  ('service_unit', 'change_department'), ('service_unit', 'change_status'),
  ('service_unit', 'retire');
"""

DOWNGRADE = """
DELETE FROM approval_rule WHERE object_type IN ('department', 'service_unit');
DELETE FROM option_item WHERE category = 'service_unit_type';
DROP TABLE service_unit_version, service_unit, department;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
