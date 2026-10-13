"""第 1 步：主体、院区、运营关系、变更申请与配置

- 应用账号 hdip_app 的默认权限：SELECT / INSERT / UPDATE，无 DELETE。
- 身份表（institution、campus）不可更新；版本行与运营关系只允许把结束日从空设为某日
  （由 hdip_guard_update 触发器在数据库层保证“不覆盖历史”）。
- 同一对象版本期间不重叠、同一院区重叠期间最多一个主要运营方：排他约束。
- 种子：开发期用户、院区节点角色选项、各类变更的确认规则。

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CODE_CHECK = r"code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'"

UPGRADE = rf"""
-- ---------------------------------------------------------------- 权限
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdip_app') THEN
    GRANT USAGE ON SCHEMA public TO hdip_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO hdip_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hdip_app;
  ELSE
    RAISE NOTICE 'role hdip_app not found, skip grants';
  END IF;
END $$;

-- ---------------------------------------------------------------- 历史保护
-- 用法：hdip_guard_update('col1', 'col2', ...) —— 只有列出的列可以修改；
-- 其中 valid_to 只能从空设为某日，不能再改。未列任何列 = 整行不可更新。
CREATE FUNCTION hdip_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable text[] := coalesce(TG_ARGV, '{{}}'::text[]);
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

-- ---------------------------------------------------------------- 用户与配置
-- 开发期用户。正式认证方案待确认（设计文档第 12 节），届时替换来源，保留本表作为本地映射。
CREATE TABLE app_user (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username     text NOT NULL CONSTRAINT app_user_username_uniq UNIQUE,
  display_name text NOT NULL,
  roles        text[] NOT NULL DEFAULT '{{}}',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT app_user_roles_check CHECK (roles <@ ARRAY['maintainer', 'confirmer', 'viewer'])
);

CREATE TABLE option_item (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category   text NOT NULL,
  code       text NOT NULL,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  CONSTRAINT option_item_uniq UNIQUE (category, code)
);

-- 谁能确认哪类变更、是否允许提交人自己确认。改规则不改代码。
CREATE TABLE approval_rule (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_type        text NOT NULL,
  action             text NOT NULL,
  confirmer_role     text NOT NULL DEFAULT 'confirmer',
  allow_self_confirm boolean NOT NULL DEFAULT true,
  CONSTRAINT approval_rule_uniq UNIQUE (object_type, action),
  CONSTRAINT approval_rule_role_check CHECK (confirmer_role IN ('maintainer', 'confirmer'))
);

-- ---------------------------------------------------------------- 变更申请
CREATE TABLE change_request (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status         text NOT NULL DEFAULT 'draft',
  note           text,
  items          jsonb NOT NULL DEFAULT '[]',
  results        jsonb,
  copied_from_id bigint REFERENCES change_request,
  created_by     bigint NOT NULL REFERENCES app_user,
  created_at     timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  updated_at     timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  submitted_by   bigint REFERENCES app_user,
  submitted_at   timestamp,
  confirmed_by   bigint REFERENCES app_user,
  confirmed_at   timestamp,
  returned_by    bigint REFERENCES app_user,
  returned_at    timestamp,
  return_reason  text,
  cancelled_by   bigint REFERENCES app_user,
  cancelled_at   timestamp,
  CONSTRAINT change_request_status_check
    CHECK (status IN ('draft', 'submitted', 'confirmed', 'returned', 'cancelled')),
  CONSTRAINT change_request_items_check CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT change_request_submitted_check
    CHECK (status NOT IN ('submitted', 'confirmed', 'returned') OR submitted_by IS NOT NULL),
  CONSTRAINT change_request_confirmed_check
    CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND results IS NOT NULL)),
  CONSTRAINT change_request_returned_check
    CHECK (status <> 'returned' OR (returned_by IS NOT NULL AND btrim(return_reason) <> ''))
);
CREATE INDEX change_request_status_idx ON change_request (status);

-- 终态（已确认、已退回、已撤销）不可再改。
CREATE FUNCTION hdip_guard_change_request() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status IN ('confirmed', 'returned', 'cancelled') THEN
    RAISE EXCEPTION '变更申请已结束，不可修改'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER change_request_guard BEFORE UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_change_request();

-- ---------------------------------------------------------------- 主体
CREATE TABLE institution (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL CONSTRAINT institution_code_uniq UNIQUE,
  created_change_id bigint NOT NULL REFERENCES change_request,
  created_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT institution_code_check CHECK ({CODE_CHECK})
);
CREATE TRIGGER institution_guard BEFORE UPDATE ON institution
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE institution_version (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id     bigint NOT NULL REFERENCES institution,
  version_no         integer NOT NULL,
  valid_from         date NOT NULL,
  valid_to           date,
  change_id          bigint NOT NULL REFERENCES change_request,
  recorded_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by        bigint NOT NULL REFERENCES app_user,
  name               text NOT NULL,
  nature             text,
  unified_credit_code text,
  medical_reg_code   text,
  license_no         text,
  license_valid_from date,
  license_valid_to   date,
  CONSTRAINT institution_version_no_uniq UNIQUE (institution_id, version_no),
  CONSTRAINT institution_version_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT institution_version_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT institution_version_license_check
    CHECK (license_valid_to IS NULL OR license_valid_from IS NULL
           OR license_valid_to >= license_valid_from),
  CONSTRAINT institution_version_no_overlap EXCLUDE USING gist (
    institution_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE TRIGGER institution_version_guard BEFORE UPDATE ON institution_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to');

-- ---------------------------------------------------------------- 院区
CREATE TABLE campus (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL CONSTRAINT campus_code_uniq UNIQUE,
  created_change_id bigint NOT NULL REFERENCES change_request,
  created_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT campus_code_check CHECK ({CODE_CHECK})
);
CREATE TRIGGER campus_guard BEFORE UPDATE ON campus
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE campus_version (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campus_id           bigint NOT NULL REFERENCES campus,
  version_no          integer NOT NULL,
  valid_from          date NOT NULL,
  valid_to            date,
  change_id           bigint NOT NULL REFERENCES change_request,
  recorded_at         timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by         bigint NOT NULL REFERENCES app_user,
  name                text NOT NULL,
  node_role           text,
  address             text,
  admin_division_code text,
  phone               text,
  actual_open_date    date,
  operating_status    text NOT NULL,
  CONSTRAINT campus_version_no_uniq UNIQUE (campus_id, version_no),
  CONSTRAINT campus_version_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT campus_version_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT campus_version_status_check
    CHECK (operating_status IN ('PLANNING', 'TRIAL_RUNNING', 'RUNNING', 'SUSPENDED')),
  CONSTRAINT campus_version_no_overlap EXCLUDE USING gist (
    campus_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE TRIGGER campus_version_guard BEFORE UPDATE ON campus_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to');

-- ---------------------------------------------------------------- 主体—院区关系
-- 每行自带期间，端点不可改；调整 = 关闭旧行 + 新建行。
CREATE TABLE operator_relation (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id    bigint NOT NULL REFERENCES institution,
  campus_id         bigint NOT NULL REFERENCES campus,
  relation_type     text NOT NULL,
  is_primary        boolean NOT NULL DEFAULT false,
  valid_from        date NOT NULL,
  valid_to          date,
  created_change_id bigint NOT NULL REFERENCES change_request,
  recorded_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by       bigint NOT NULL REFERENCES app_user,
  closed_change_id  bigint REFERENCES change_request,
  closed_at         timestamp,
  closed_by         bigint REFERENCES app_user,
  CONSTRAINT operator_relation_type_check
    CHECK (relation_type IN ('OPERATE', 'REGISTER', 'MANAGE', 'CHARGE')),
  CONSTRAINT operator_relation_primary_operate_check
    CHECK (NOT is_primary OR relation_type = 'OPERATE'),
  CONSTRAINT operator_relation_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT operator_relation_primary_excl EXCLUDE USING gist (
    campus_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (is_primary),
  CONSTRAINT operator_relation_dup_excl EXCLUDE USING gist (
    institution_id WITH =, campus_id WITH =, relation_type WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX operator_relation_institution_idx ON operator_relation (institution_id);
CREATE TRIGGER operator_relation_guard BEFORE UPDATE ON operator_relation
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'valid_to', 'closed_change_id', 'closed_at', 'closed_by');

-- ---------------------------------------------------------------- 种子
INSERT INTO app_user (username, display_name, roles) VALUES
  ('solo',       '一人维护（维护+确认）', ARRAY['maintainer', 'confirmer']),
  ('maintainer', '维护人',               ARRAY['maintainer']),
  ('confirmer',  '确认人',               ARRAY['confirmer']),
  ('viewer',     '只读',                 ARRAY['viewer']);

-- 沿用旧仓库码值；中文名称按统一语言，可在 option_item 中调整。
INSERT INTO option_item (category, code, name, sort_order) VALUES
  ('campus_node_role', 'HEADQUARTERS', '本院院区',     10),
  ('campus_node_role', 'HIGH_TECH',    '高新院区',     20),
  ('campus_node_role', 'CITY_CENTER',  '中心医院院区', 30);

INSERT INTO approval_rule (object_type, action) VALUES
  ('institution', 'create'), ('institution', 'revise'),
  ('campus', 'create'), ('campus', 'revise'), ('campus', 'change_status'),
  ('operator_relation', 'create'), ('operator_relation', 'close');
"""

DOWNGRADE = """
DROP TABLE operator_relation, campus_version, campus, institution_version, institution,
  change_request, approval_rule, option_item, app_user;
DROP FUNCTION hdip_guard_change_request();
DROP FUNCTION hdip_guard_update();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
