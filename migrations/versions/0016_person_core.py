"""人员模块 P1.1：人员、姓名版本、任用、业务工号、部门归属（2026-10-21 Peter 定稿）

设计见 docs/HDIP 轻量人员模块设计：人员、任用、部门归属.md 第 3 节。

- person 只留身份：代码 P + 6 位数字，系统发号（person_code_seq），预留登记在 code_reservation。
- person_version：姓名与拼音码按期间分版本；revise_reason 区分登记 / 更名 / 更正误录。
- person_engagement：人员与主体的任用，带期间；同一人员 + 同一主体的任用期间不重叠（P1 的范围限制，
  以后允许并行任用时删掉 person_engagement_no_overlap 即可）。
- person_work_no：业务工号，挂在任用上、带期间，可换号；同一主体内一个工号永远只属于一个人
  （本人返聘可沿用，发给别人被拒）。
- person_assignment：任用下的部门归属，P1 只有主归属 PRIMARY；同一任用同一时点最多一条主归属。
- 任用、工号、归属的结束日在到达前可以改（提前、推后、清空、撤销计划），到达后不可再改：
  用新的保护函数 hdip_guard_open_end，组织表的 hdip_guard_update（结束日只写一次）保持不变。
- 期间排他一律用半开区间 daterange(valid_from, valid_to + 1)：与闭区间等价，
  空期间（生效前撤销）不参与。

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
-- ---------------------------------------------------------------- 保护：结束日在到达前可改
-- 只有 valid_to、closed_change_id 可改；改 valid_to 时须同时写上本次申请（closed_change_id）。
-- 原结束日已过去（早于今天）或原行是空期间（生效前已撤销）时，整行不可再改。
CREATE FUNCTION hdip_guard_open_end() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (to_jsonb(NEW) - 'valid_to' - 'closed_change_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'closed_change_id') THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to THEN
    IF NEW.closed_change_id IS DISTINCT FROM OLD.closed_change_id THEN
      RAISE EXCEPTION '关闭信息只能随结束日一起写入（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.valid_to IS NOT NULL AND OLD.valid_to < OLD.valid_from THEN
    RAISE EXCEPTION '生效前已撤销的记录不可再改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF OLD.valid_to IS NOT NULL AND OLD.valid_to < current_date THEN
    RAISE EXCEPTION '结束日已经过去，不能再改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_period_passed';
  END IF;
  IF NEW.closed_change_id IS NULL THEN
    RAISE EXCEPTION '改结束日须记下本次申请（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------- 人员代码
CREATE SEQUENCE person_code_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
ALTER TABLE code_reservation DROP CONSTRAINT code_reservation_type_check;
ALTER TABLE code_reservation ADD CONSTRAINT code_reservation_type_check
  CHECK (object_type IN ('campus', 'department', 'service_unit', 'person'));

-- ---------------------------------------------------------------- 人员身份与姓名版本
CREATE TABLE person (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL CONSTRAINT person_code_uniq UNIQUE,
  created_change_id bigint NOT NULL REFERENCES change_request,
  created_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT person_code_check CHECK (code ~ '^P[0-9]{6}$')
);
COMMENT ON TABLE person IS
  '人员身份：代码系统分配、永不复用；姓名在 person_version，任用与归属另表';
CREATE TRIGGER person_guard BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE person_version (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id     bigint NOT NULL REFERENCES person,
  version_no    integer NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date,
  change_id     bigint NOT NULL REFERENCES change_request,
  recorded_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by   bigint NOT NULL REFERENCES app_user,
  name          text NOT NULL,
  pinyin        text,
  revise_reason text NOT NULL DEFAULT 'INITIAL',
  CONSTRAINT person_version_no_uniq UNIQUE (person_id, version_no),
  CONSTRAINT person_version_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from - 1),
  CONSTRAINT person_version_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT person_version_pinyin_check CHECK (pinyin ~ '^[A-Z0-9]{1,64}$'),
  CONSTRAINT person_version_reason_check
    CHECK (revise_reason IN ('INITIAL', 'RENAME', 'CORRECTION')),
  CONSTRAINT person_version_no_overlap EXCLUDE USING gist (
    person_id WITH =, daterange(valid_from, valid_to + 1) WITH &&)
);
CREATE INDEX person_version_person_idx ON person_version (person_id);
CREATE TRIGGER person_version_guard BEFORE UPDATE ON person_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to');

-- ---------------------------------------------------------------- 任用
CREATE TABLE person_engagement (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id        bigint NOT NULL REFERENCES person,
  institution_id   bigint NOT NULL REFERENCES institution,
  engagement_type  text NOT NULL,
  note             text,
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  -- 供工号表用 (id, person_id, institution_id) 外键锁定人员与主体
  CONSTRAINT person_engagement_owner_uniq UNIQUE (id, person_id, institution_id),
  CONSTRAINT person_engagement_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from - 1),
  CONSTRAINT person_engagement_no_overlap EXCLUDE USING gist (
    person_id WITH =, institution_id WITH =, daterange(valid_from, valid_to + 1) WITH &&)
);
CREATE INDEX person_engagement_person_idx ON person_engagement (person_id);
CREATE TRIGGER person_engagement_guard BEFORE UPDATE ON person_engagement
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end();

-- ---------------------------------------------------------------- 业务工号
CREATE TABLE person_work_no (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id    bigint NOT NULL,
  person_id        bigint NOT NULL,
  institution_id   bigint NOT NULL,
  work_no          text NOT NULL,
  revise_reason    text NOT NULL DEFAULT 'INITIAL',
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT person_work_no_engagement_fk FOREIGN KEY (engagement_id, person_id, institution_id)
    REFERENCES person_engagement (id, person_id, institution_id),
  CONSTRAINT person_work_no_value_check
    CHECK (work_no = btrim(work_no) AND length(work_no) BETWEEN 1 AND 64),
  CONSTRAINT person_work_no_reason_check
    CHECK (revise_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),
  CONSTRAINT person_work_no_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from - 1),
  CONSTRAINT person_work_no_no_overlap EXCLUDE USING gist (
    engagement_id WITH =, daterange(valid_from, valid_to + 1) WITH &&),
  -- 同一主体内一个工号永远只属于一个人：本人可沿用，发给别人被拒（不论期间）
  CONSTRAINT person_work_no_one_owner EXCLUDE USING gist (
    institution_id WITH =, work_no WITH =, person_id WITH <>)
);
CREATE INDEX person_work_no_value_idx ON person_work_no (work_no);
CREATE INDEX person_work_no_engagement_idx ON person_work_no (engagement_id);
CREATE TRIGGER person_work_no_guard BEFORE UPDATE ON person_work_no
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end();

-- ---------------------------------------------------------------- 部门归属
CREATE TABLE person_assignment (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id    bigint NOT NULL REFERENCES person_engagement,
  department_id    bigint NOT NULL REFERENCES department,
  kind             text NOT NULL DEFAULT 'PRIMARY',
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT person_assignment_kind_check CHECK (kind IN ('PRIMARY')),
  CONSTRAINT person_assignment_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from - 1),
  -- 同一任用同一时点最多一条主归属（不按部门分桶，否则会放过两个主部门）
  CONSTRAINT person_assignment_primary_no_overlap EXCLUDE USING gist (
    engagement_id WITH =, daterange(valid_from, valid_to + 1) WITH &&) WHERE (kind = 'PRIMARY')
);
CREATE INDEX person_assignment_engagement_idx ON person_assignment (engagement_id);
CREATE INDEX person_assignment_department_idx ON person_assignment (department_id);
CREATE TRIGGER person_assignment_guard BEFORE UPDATE ON person_assignment
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end();

-- ---------------------------------------------------------------- 选项与确认规则
INSERT INTO option_item (category, code, name, sort_order) VALUES
  ('engagement_type', 'STAFF',    '在编',             10),
  ('engagement_type', 'CONTRACT', '合同（人事代理）', 20),
  ('engagement_type', 'DISPATCH', '劳务派遣',         30),
  ('engagement_type', 'REHIRE',   '退休返聘',         40),
  ('engagement_type', 'EXTERNAL', '外聘专家',         50),
  ('engagement_type', 'RESIDENT', '规培',             60),
  ('engagement_type', 'VISITING', '进修',             70),
  ('engagement_type', 'INTERN',   '实习',             80),
  ('assignment_kind', 'PRIMARY',  '主归属',           10),
  ('person_relation_status', 'ENGAGED', '有有效任用', 10),
  ('person_relation_status', 'PLANNED', '仅有计划任用', 20),
  ('person_relation_status', 'NONE',    '无有效任用', 30);

INSERT INTO approval_rule (object_type, action) VALUES
  ('person', 'create'),
  ('person', 'engage'),
  ('person', 'transfer'),
  ('person', 'assignment_set_end');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE object_type = 'person';
DELETE FROM option_item
  WHERE category IN ('engagement_type', 'assignment_kind', 'person_relation_status');
DROP TABLE person_assignment;
DROP TABLE person_work_no;
DROP TABLE person_engagement;
DROP TABLE person_version;
DROP TABLE person;
DELETE FROM code_reservation WHERE object_type = 'person';
ALTER TABLE code_reservation DROP CONSTRAINT code_reservation_type_check;
ALTER TABLE code_reservation ADD CONSTRAINT code_reservation_type_check
  CHECK (object_type IN ('campus', 'department', 'service_unit'));
DROP SEQUENCE person_code_seq;
DROP FUNCTION hdip_guard_open_end();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
