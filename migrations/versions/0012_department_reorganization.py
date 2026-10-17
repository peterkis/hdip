"""部门组织变更第一期：组织变更事件与参与部门（docs/部门组织变更-评估与分期.md）

- department_change_event：一次组织变更（整体拆分 / 分设 / 吸收合并 / 合并新设）——类型、生效日、
  正式依据（必填）、承接范围与需其他系统办理事项的说明、来源申请。只追加。
- department_change_participant：参与部门，一行一个部门一个角色：
  原部门（SOURCE）/ 结果部门（RESULT），
  身份结论 存续（CONTINUES）/ 退出（EXITS）/ 新设（NEW），各自的承接范围说明。只追加。
  演变关系不是行政上下级；A → B → A 允许出现，不做成环检查。
- “被替代”只由组织变更事件产生（手工改生命周期本就不能选被替代）。

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
CREATE TABLE department_change_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type     text NOT NULL,
  -- 结果部门的开始日；退出部门的最后有效日为其前一日
  effective_date date NOT NULL,
  basis_note     text NOT NULL,
  scope_note     text,
  other_matters  text,
  change_id      bigint NOT NULL REFERENCES change_request,
  recorded_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by    bigint NOT NULL REFERENCES app_user,
  CONSTRAINT department_change_event_type_check
    CHECK (event_type IN ('SPLIT', 'SPLIT_OFF', 'ABSORB', 'MERGE')),
  CONSTRAINT department_change_event_basis_check CHECK (btrim(basis_note) <> '')
);
CREATE TRIGGER department_change_event_guard BEFORE UPDATE ON department_change_event
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE department_change_participant (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES department_change_event,
  department_id bigint NOT NULL REFERENCES department,
  role          text NOT NULL,
  outcome       text NOT NULL,
  scope_note    text,
  CONSTRAINT department_change_participant_role_check CHECK (role IN ('SOURCE', 'RESULT')),
  CONSTRAINT department_change_participant_outcome_check
    CHECK (outcome IN ('CONTINUES', 'EXITS', 'NEW')),
  CONSTRAINT department_change_participant_uniq UNIQUE (event_id, department_id, role)
);
CREATE INDEX department_change_participant_department_idx
  ON department_change_participant (department_id);
CREATE TRIGGER department_change_participant_guard BEFORE UPDATE ON department_change_participant
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

INSERT INTO approval_rule (object_type, action) VALUES ('department', 'reorganize');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE object_type = 'department' AND action = 'reorganize';
DROP TABLE department_change_participant;
DROP TABLE department_change_event;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
