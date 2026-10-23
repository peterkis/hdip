"""人员模块 P3：附加归属与部门职务（人员设计第 10.1 节，2026-10-21 Peter 提供院内实际）

- person_assignment 增加 ADDITIONAL（附加归属）：同一任用同一部门的附加归属期间不重叠；
  主归属仍是同一任用同一时点最多一条。附加归属与主归属不能是同一部门（应用层检查）。
- person_duty：部门职务，挂在“任用 × 部门”上，不挂在归属上（代管的部门不是此人的归属部门）。
  duty：HEAD 部长 / DEPUTY 副部长；mode：FORMAL 正式 / ACTING 主持工作（代理）/ CARETAKER 代管。
  同一部门同一天：正式部长最多一位；主持工作者（代理或代管的部长）最多一位；两者可以并存
  （部长外出学习、派驻期间由他人主持工作）。副部长不限人数。同一人同一部门同一职务期间不重叠。
  “副部长（主持工作）”= 同一人一条 DEPUTY FORMAL + 一条 HEAD ACTING。
  结束日在到达前可改（hdip_guard_open_end），代理、代管不强制结束日。
- 职务不等于系统权限，不授予任何 app_user 角色。

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
ALTER TABLE person_assignment DROP CONSTRAINT person_assignment_kind_check;
ALTER TABLE person_assignment ADD CONSTRAINT person_assignment_kind_check
  CHECK (kind IN ('PRIMARY', 'ADDITIONAL'));
ALTER TABLE person_assignment ADD CONSTRAINT person_assignment_additional_no_overlap
  EXCLUDE USING gist (
    engagement_id WITH =, department_id WITH =, daterange(valid_from, valid_to + 1) WITH &&)
  WHERE (kind = 'ADDITIONAL');

CREATE TABLE person_duty (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id    bigint NOT NULL REFERENCES person_engagement,
  department_id    bigint NOT NULL REFERENCES department,
  duty             text NOT NULL,
  mode             text NOT NULL DEFAULT 'FORMAL',
  valid_from       date NOT NULL,
  valid_to         date,
  change_id        bigint NOT NULL REFERENCES change_request,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by      bigint NOT NULL REFERENCES app_user,
  closed_change_id bigint REFERENCES change_request,
  CONSTRAINT person_duty_duty_check CHECK (duty IN ('HEAD', 'DEPUTY')),
  CONSTRAINT person_duty_mode_check CHECK (mode IN ('FORMAL', 'ACTING', 'CARETAKER')),
  CONSTRAINT person_duty_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from - 1),
  -- 同一部门同一天最多一位正式部长
  CONSTRAINT person_duty_formal_head_excl EXCLUDE USING gist (
    department_id WITH =, daterange(valid_from, valid_to + 1) WITH &&)
    WHERE (duty = 'HEAD' AND mode = 'FORMAL'),
  -- 同一部门同一天最多一位主持工作者（代理或代管的部长）；可与正式部长并存
  CONSTRAINT person_duty_presiding_excl EXCLUDE USING gist (
    department_id WITH =, daterange(valid_from, valid_to + 1) WITH &&)
    WHERE (duty = 'HEAD' AND mode <> 'FORMAL'),
  -- 同一人同一部门同一职务期间不重叠
  CONSTRAINT person_duty_same_excl EXCLUDE USING gist (
    engagement_id WITH =, department_id WITH =, duty WITH =,
    daterange(valid_from, valid_to + 1) WITH &&)
);
COMMENT ON TABLE person_duty IS
  '部门职务：任用 × 部门 × 职务 × 方式 × 期间；不要求此人归属该部门（代管）；不是系统权限';
CREATE INDEX person_duty_department_idx ON person_duty (department_id);
CREATE INDEX person_duty_engagement_idx ON person_duty (engagement_id);
CREATE TRIGGER person_duty_guard BEFORE UPDATE ON person_duty
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end();

INSERT INTO option_item (category, code, name, sort_order) VALUES
  ('assignment_kind', 'ADDITIONAL', '附加归属', 20),
  ('duty', 'HEAD', '部长', 10),
  ('duty', 'DEPUTY', '副部长', 20),
  ('duty_mode', 'FORMAL', '正式', 10),
  ('duty_mode', 'ACTING', '主持工作（代理）', 20),
  ('duty_mode', 'CARETAKER', '代管', 30);

INSERT INTO approval_rule (object_type, action) VALUES
  ('person', 'duty_assign'),
  ('person', 'duty_set_end'),
  ('person', 'duty_handover');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule
  WHERE object_type = 'person' AND action IN ('duty_assign', 'duty_set_end', 'duty_handover');
DELETE FROM option_item WHERE category IN ('duty', 'duty_mode')
  OR (category = 'assignment_kind' AND code = 'ADDITIONAL');
DROP TABLE person_duty;
ALTER TABLE person_assignment DROP CONSTRAINT person_assignment_additional_no_overlap;
ALTER TABLE person_assignment DROP CONSTRAINT person_assignment_kind_check;
ALTER TABLE person_assignment ADD CONSTRAINT person_assignment_kind_check
  CHECK (kind IN ('PRIMARY'));
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
