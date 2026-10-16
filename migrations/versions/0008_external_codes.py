"""部门深化 D3：外部标识（编码映射台账）与分类关联扩展

设计见 docs/database/README.md 第 6.3 节。

- source_system / code_namespace：来源系统实例与字典（配置，维护人直接维护）。
- external_code：台账里的一条源记录（业务数据，经变更申请；身份行不可更新）。
- external_code_assignment：一条源记录在某段期间的解释——部门、服务单元或“对象未建模”，
  可带院区条件。同一源记录、同一条件、同一时点只有一个解释（排他约束）。
  某日没有任何解释覆盖的源记录，当天即“待裁决”，不单独存状态。
- service_unit_classification：服务单元分类赋值，与 department_classification 同形。
- classification_scheme 增加“用于部门 / 用于服务单元时的含义”，为空表示不适用。
- 分类代码放宽为外部正式代码表的写法（如 03.05、0305），代码以正式代码表为准。
- 院区节点角色名称按三个直属院区更正：本部院区、高新院区、中心院区。

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
UPDATE option_item SET name = '本部院区'
  WHERE category = 'campus_node_role' AND code = 'HEADQUARTERS';
UPDATE option_item SET name = '中心院区'
  WHERE category = 'campus_node_role' AND code = 'CITY_CENTER';

-- ---------------------------------------------------------------- 分类方案扩展
ALTER TABLE classification_scheme
  ADD COLUMN meaning_for_department text,
  ADD COLUMN meaning_for_unit text;
DROP TRIGGER classification_scheme_guard ON classification_scheme;
CREATE TRIGGER classification_scheme_guard BEFORE UPDATE ON classification_scheme
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'purpose', 'is_active', 'meaning_for_department', 'meaning_for_unit',
    'updated_by', 'updated_at');
UPDATE classification_scheme SET meaning_for_department = '管理主分类'
  WHERE code = 'DEPT_MAIN_CLASS';

ALTER TABLE classification_code DROP CONSTRAINT classification_code_code_check;
ALTER TABLE classification_code ADD CONSTRAINT classification_code_code_check
  CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

-- ---------------------------------------------------------------- 服务单元分类赋值（业务数据）
CREATE TABLE service_unit_classification (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_unit_id  bigint NOT NULL REFERENCES service_unit,
  scheme_id        bigint NOT NULL,
  is_exclusive     boolean NOT NULL,
  code             text NOT NULL,
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT service_unit_classification_scheme_fk
    FOREIGN KEY (scheme_id, is_exclusive) REFERENCES classification_scheme (id, is_exclusive),
  CONSTRAINT service_unit_classification_code_fk
    FOREIGN KEY (scheme_id, code) REFERENCES classification_code (scheme_id, code),
  CONSTRAINT service_unit_classification_period_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT service_unit_classification_exclusive_excl EXCLUDE USING gist (
    service_unit_id WITH =, scheme_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
    WHERE (is_exclusive),
  CONSTRAINT service_unit_classification_dup_excl EXCLUDE USING gist (
    service_unit_id WITH =, scheme_id WITH =, code WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX service_unit_classification_unit_idx ON service_unit_classification (service_unit_id);
CREATE TRIGGER service_unit_classification_guard BEFORE UPDATE ON service_unit_classification
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

-- ---------------------------------------------------------------- 来源系统与字典（配置）
CREATE TABLE source_system (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL CONSTRAINT source_system_code_uniq UNIQUE,
  name       text NOT NULL,
  kind       text NOT NULL,
  note       text,
  is_active  boolean NOT NULL DEFAULT true,
  updated_by bigint REFERENCES app_user,
  updated_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT source_system_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT source_system_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT source_system_kind_check
    CHECK (kind IN ('HIS', 'MEDICAL_RECORD', 'INTEROP', 'OTHER'))
);
CREATE TRIGGER source_system_guard BEFORE UPDATE ON source_system
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'kind', 'note', 'is_active', 'updated_by', 'updated_at');

CREATE TABLE code_namespace (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system_id bigint NOT NULL REFERENCES source_system,
  code             text NOT NULL,
  name             text NOT NULL,
  note             text,
  is_active        boolean NOT NULL DEFAULT true,
  updated_by       bigint REFERENCES app_user,
  updated_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT code_namespace_code_uniq UNIQUE (source_system_id, code),
  CONSTRAINT code_namespace_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT code_namespace_name_check CHECK (btrim(name) <> '')
);
CREATE TRIGGER code_namespace_guard BEFORE UPDATE ON code_namespace
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'note', 'is_active', 'updated_by', 'updated_at');

-- ---------------------------------------------------------------- 源记录与解释（业务数据）
CREATE TABLE external_code (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  namespace_id      bigint NOT NULL REFERENCES code_namespace,
  code              text NOT NULL,
  source_name       text,
  semantic_note     text,
  created_change_id bigint NOT NULL REFERENCES change_request,
  recorded_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by       bigint NOT NULL REFERENCES app_user,
  CONSTRAINT external_code_uniq UNIQUE (namespace_id, code),
  CONSTRAINT external_code_code_check CHECK (btrim(code) = code AND code <> '')
);
CREATE TRIGGER external_code_guard BEFORE UPDATE ON external_code
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE external_code_assignment (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_code_id bigint NOT NULL REFERENCES external_code,
  target_type      text NOT NULL,
  department_id    bigint REFERENCES department,
  service_unit_id  bigint REFERENCES service_unit,
  unmodeled_type   text,
  campus_id        bigint REFERENCES campus,
  evidence_note    text,
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT external_code_assignment_target_check CHECK (
    (target_type = 'department' AND department_id IS NOT NULL
       AND service_unit_id IS NULL AND unmodeled_type IS NULL)
    OR (target_type = 'service_unit' AND service_unit_id IS NOT NULL
       AND department_id IS NULL AND unmodeled_type IS NULL)
    OR (target_type = 'unmodeled' AND unmodeled_type IS NOT NULL
       AND department_id IS NULL AND service_unit_id IS NULL)),
  CONSTRAINT external_code_assignment_unmodeled_check CHECK (
    unmodeled_type IS NULL
    OR unmodeled_type IN ('NURSING_UNIT', 'WARD', 'LOCATION', 'STAT_GROUP', 'COMPOSITE', 'OTHER')),
  CONSTRAINT external_code_assignment_period_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- 同一源记录、同一条件、同一时点只有一个解释
  CONSTRAINT external_code_assignment_single_excl EXCLUDE USING gist (
    external_code_id WITH =, (coalesce(campus_id, 0)) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX external_code_assignment_code_idx ON external_code_assignment (external_code_id);
CREATE INDEX external_code_assignment_dept_idx ON external_code_assignment (department_id);
CREATE INDEX external_code_assignment_unit_idx ON external_code_assignment (service_unit_id);
CREATE TRIGGER external_code_assignment_guard BEFORE UPDATE ON external_code_assignment
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

INSERT INTO approval_rule (object_type, action) VALUES
  ('external_code', 'register'), ('external_code', 'assign'),
  ('external_code', 'assignment_close'), ('service_unit', 'classify');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE (object_type = 'external_code')
  OR (object_type = 'service_unit' AND action = 'classify');
DROP TABLE external_code_assignment, external_code, code_namespace, source_system,
  service_unit_classification;
ALTER TABLE classification_code DROP CONSTRAINT classification_code_code_check;
ALTER TABLE classification_code ADD CONSTRAINT classification_code_code_check
  CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$');
DROP TRIGGER classification_scheme_guard ON classification_scheme;
ALTER TABLE classification_scheme DROP COLUMN meaning_for_department, DROP COLUMN meaning_for_unit;
CREATE TRIGGER classification_scheme_guard BEFORE UPDATE ON classification_scheme
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'purpose', 'is_active', 'updated_by', 'updated_at');
UPDATE option_item SET name = '本院院区'
  WHERE category = 'campus_node_role' AND code = 'HEADQUARTERS';
UPDATE option_item SET name = '中心医院院区'
  WHERE category = 'campus_node_role' AND code = 'CITY_CENTER';
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
