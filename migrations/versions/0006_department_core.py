"""部门深化 D1：部门属性版本、组织生命周期、别名、分类字典与赋值、主体归属、组织视图

设计见 docs/database/README.md 第 6.1 节，决定见 docs/部门主数据深化-实施计划.md。

- department 只保留身份（id、code、创建申请）；名称、状态迁到 department_version，
  身份行此后整行不可更新。
- 现有部门回填第 1 版：名称取当前名称；在用 → 正式履职，停用 → 暂停履职；设立形式取常设；
  生效日取“创建申请的确认日”与“最早引用它的单元版本开始日”中较早者，保证已有单元仍然成立。
  主分类、承担职责、行政级别、主体归属留空，由维护人补齐。
- 分类方案与代码是配置：维护人可直接维护（不经变更申请），代码值与单选属性不可改，不删除只停用。
- 部门上的分类赋值、主体归属、别名是业务数据：经变更申请，带期间。
- 组织视图：行政视图启用；运营、病案视图占位（D2 起使用）。

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
-- ---------------------------------------------------------------- 部门属性版本
CREATE TABLE department_version (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id      bigint NOT NULL REFERENCES department,
  version_no         integer NOT NULL,
  valid_from         date NOT NULL,
  valid_to           date,
  change_id          bigint NOT NULL REFERENCES change_request,
  recorded_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by        bigint NOT NULL REFERENCES app_user,
  name               text NOT NULL,
  short_name         text,
  description        text,
  establishment_form text NOT NULL DEFAULT 'STANDING',
  temporary_until    date,
  lifecycle          text NOT NULL,
  admin_grade        text,
  duties             text[] NOT NULL DEFAULT '{}',
  basis_note         text,
  CONSTRAINT department_version_no_uniq UNIQUE (department_id, version_no),
  CONSTRAINT department_version_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT department_version_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT department_version_form_check CHECK (establishment_form IN ('STANDING', 'TEMPORARY')),
  -- 经批准的临时部门必须有期限；常设部门不填期限
  CONSTRAINT department_version_temporary_check CHECK (
    (establishment_form = 'TEMPORARY') = (temporary_until IS NOT NULL)),
  CONSTRAINT department_version_lifecycle_check
    CHECK (lifecycle IN ('PREPARING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'SUPERSEDED')),
  CONSTRAINT department_version_no_overlap EXCLUDE USING gist (
    department_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE TRIGGER department_version_guard BEFORE UPDATE ON department_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to');

INSERT INTO department_version (
  department_id, version_no, valid_from, change_id, recorded_at, recorded_by,
  name, establishment_form, lifecycle)
SELECT d.id, 1,
       LEAST(cr.confirmed_at::date,
             (SELECT min(v.valid_from) FROM service_unit_version v WHERE v.department_id = d.id)),
       d.created_change_id, d.created_at, cr.confirmed_by,
       d.name, 'STANDING', CASE d.status WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END
FROM department d
JOIN change_request cr ON cr.id = d.created_change_id;

-- 身份行只保留身份；此后整行不可更新
DROP TRIGGER department_guard ON department;
ALTER TABLE department DROP COLUMN name, DROP COLUMN status,
  DROP COLUMN last_change_id, DROP COLUMN updated_at;
CREATE TRIGGER department_guard BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- ---------------------------------------------------------------- 别名
CREATE TABLE department_alias (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id bigint NOT NULL REFERENCES department,
  kind          text NOT NULL,
  value         text NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date,
  change_id     bigint NOT NULL REFERENCES change_request,
  recorded_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by   bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT department_alias_kind_check CHECK (kind IN ('ALIAS', 'SEARCH_CODE')),
  CONSTRAINT department_alias_value_check CHECK (btrim(value) <> ''),
  CONSTRAINT department_alias_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT department_alias_dup_excl EXCLUDE USING gist (
    department_id WITH =, kind WITH =, value WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX department_alias_value_idx ON department_alias (value);
CREATE TRIGGER department_alias_guard BEFORE UPDATE ON department_alias
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

-- ---------------------------------------------------------------- 分类字典
-- 配置：维护人可直接维护
CREATE TABLE classification_scheme (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL CONSTRAINT classification_scheme_code_uniq UNIQUE,
  name         text NOT NULL,
  version      text NOT NULL,
  purpose      text,
  is_exclusive boolean NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  updated_by   bigint REFERENCES app_user,
  updated_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT classification_scheme_name_check CHECK (btrim(name) <> ''),
  -- 供赋值表用 (scheme_id, is_exclusive) 外键锁定单选属性
  CONSTRAINT classification_scheme_exclusive_uniq UNIQUE (id, is_exclusive)
);
CREATE TRIGGER classification_scheme_guard BEFORE UPDATE ON classification_scheme
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'purpose', 'is_active', 'updated_by', 'updated_at');

CREATE TABLE classification_code (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheme_id  bigint NOT NULL REFERENCES classification_scheme,
  code       text NOT NULL,
  name       text NOT NULL,
  criterion  text,
  caution    text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  updated_by bigint REFERENCES app_user,
  updated_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT classification_code_uniq UNIQUE (scheme_id, code),
  CONSTRAINT classification_code_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT classification_code_name_check CHECK (btrim(name) <> '')
);
CREATE TRIGGER classification_code_guard BEFORE UPDATE ON classification_code
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update(
    'name', 'criterion', 'caution', 'sort_order', 'is_active', 'updated_by', 'updated_at');

-- ---------------------------------------------------------------- 部门分类赋值（业务数据）
CREATE TABLE department_classification (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id    bigint NOT NULL REFERENCES department,
  scheme_id        bigint NOT NULL,
  is_exclusive     boolean NOT NULL,
  code             text NOT NULL,
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT department_classification_scheme_fk
    FOREIGN KEY (scheme_id, is_exclusive) REFERENCES classification_scheme (id, is_exclusive),
  CONSTRAINT department_classification_code_fk
    FOREIGN KEY (scheme_id, code) REFERENCES classification_code (scheme_id, code),
  CONSTRAINT department_classification_period_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- 单选方案：同一部门同一时点只有一个赋值
  CONSTRAINT department_classification_exclusive_excl EXCLUDE USING gist (
    department_id WITH =, scheme_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
    WHERE (is_exclusive),
  -- 多选方案：同一代码不重复
  CONSTRAINT department_classification_dup_excl EXCLUDE USING gist (
    department_id WITH =, scheme_id WITH =, code WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX department_classification_dept_idx ON department_classification (department_id);
CREATE TRIGGER department_classification_guard BEFORE UPDATE ON department_classification
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

-- ---------------------------------------------------------------- 部门主体归属
CREATE TABLE department_institution (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id    bigint NOT NULL REFERENCES department,
  institution_id   bigint NOT NULL REFERENCES institution,
  is_primary       boolean NOT NULL DEFAULT true,
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT department_institution_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT department_institution_primary_excl EXCLUDE USING gist (
    department_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (is_primary)
);
CREATE INDEX department_institution_dept_idx ON department_institution (department_id);
CREATE TRIGGER department_institution_guard BEFORE UPDATE ON department_institution
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

-- ---------------------------------------------------------------- 组织视图（D2 起使用）
CREATE TABLE org_view (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL CONSTRAINT org_view_code_uniq UNIQUE,
  name          text NOT NULL,
  purpose       text,
  single_parent boolean NOT NULL DEFAULT true,
  status        text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  CONSTRAINT org_view_status_check CHECK (status IN ('ACTIVE', 'PLANNED'))
);

-- ---------------------------------------------------------------- 种子
INSERT INTO classification_scheme (code, name, version, purpose, is_exclusive) VALUES
  ('DEPT_MAIN_CLASS', '部门管理主分类', 'v1',
   '描述部门主要承担什么职责；同一时点一个主类。与成本分类分开，允许有依据地不同', true);

INSERT INTO classification_code (scheme_id, code, name, criterion, caution, sort_order)
SELECT s.id, v.code, v.name, v.criterion, v.caution, v.sort_order
FROM classification_scheme s, (VALUES
  ('CLINICAL', '临床诊疗类', '以承担患者诊疗责任为主要设立目的',
   '不要求必须有住院床位；不能因没有床位就改成医技', 10),
  ('MEDTECH', '医疗技术类', '以提供专业医疗技术服务为主要设立目的',
   '不能仅凭“检查”“中心”等名称判定', 20),
  ('SUPPORT', '医疗辅助与专业支持类', '以支持医疗服务运行的专业业务为主要职责',
   '这是院内管理分类，不自动等于成本规范的“医疗辅助类”', 30),
  ('ADMIN', '行政与业务管理类', '以组织管理、制度执行、业务监督、协调等为主要职责',
   '医务部、护理部承担业务管理，不等于其本身就是诊疗或护理执行单元', 40),
  ('OPERATIONS', '运行保障类', '以医院运行、设施、技术或后勤保障为主要职责',
   '信息部门不能仅因服务临床就变成医技部门', 50),
  ('RESEARCH_EDU', '科研教学业务类', '以直接组织实施科研或教学业务为主要职责',
   '科教管理部门不因名称带“科教”就自动归入本类', 60)
) AS v(code, name, criterion, caution, sort_order)
WHERE s.code = 'DEPT_MAIN_CLASS';

INSERT INTO org_view (code, name, purpose, single_parent, status, sort_order) VALUES
  ('ADMIN', '行政视图', '行政隶属：一级 / 二级部门的组织层级', true, 'ACTIVE', 10),
  ('OPERATIONS', '运营视图', '运营口径的组织结构（占位）', true, 'PLANNED', 20),
  ('MEDICAL_RECORD', '病案视图', '病案口径的组织结构（占位）', true, 'PLANNED', 30);

INSERT INTO approval_rule (object_type, action) VALUES
  ('department', 'revise'), ('department', 'change_lifecycle'), ('department', 'classify'),
  ('department', 'affiliate'), ('department', 'alias_add'), ('department', 'alias_close');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE object_type = 'department'
  AND action IN ('revise', 'change_lifecycle', 'classify', 'affiliate', 'alias_add', 'alias_close');
DROP TABLE org_view, department_institution, department_classification,
  classification_code, classification_scheme, department_alias;

DROP TRIGGER department_guard ON department;
ALTER TABLE department
  ADD COLUMN name text, ADD COLUMN status text, ADD COLUMN last_change_id bigint
    REFERENCES change_request, ADD COLUMN updated_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP;
UPDATE department d SET
  name = v.name,
  status = CASE v.lifecycle WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'SUSPENDED' THEN 'INACTIVE'
                            WHEN 'SUPERSEDED' THEN 'SUPERSEDED' ELSE 'DEPRECATED' END,
  last_change_id = v.change_id
FROM department_version v
WHERE v.department_id = d.id
  AND v.version_no = (SELECT max(version_no) FROM department_version WHERE department_id = d.id);
ALTER TABLE department ALTER COLUMN name SET NOT NULL, ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN last_change_id SET NOT NULL,
  ADD CONSTRAINT department_name_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT department_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED', 'SUPERSEDED'));
CREATE TRIGGER department_guard BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'status', 'last_change_id', 'updated_at');
DROP TABLE department_version;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
