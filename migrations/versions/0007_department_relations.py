"""部门深化 D2：行政隶属（视图内上下级）与部门管理关系

设计见 docs/database/README.md 第 6.2 节。

- department_hierarchy：某组织视图内的一条上下级边（带期间）。同一视图、同一时点每个部门最多一个
  直接上级（排他约束）；不能以自己为上级（检查约束）；禁止成环由应用在申请全部应用后统一检查。
  一级 / 二级部门 = 行政视图中的组织层级，由边在查看日期计算，不保存。
- department_relation：专业管理、协作、院区管理。专业管理按事项记录，不构成行政上级；
  院区管理 = 某院区管理组织（一个部门）在某院区对某范围的管理职责，可指向一个部门，也可只到院区。
- 运营、病案视图仍为占位（PLANNED），不能写入。

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
CREATE TABLE department_hierarchy (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  view_id              bigint NOT NULL REFERENCES org_view,
  parent_department_id bigint NOT NULL REFERENCES department,
  child_department_id  bigint NOT NULL REFERENCES department,
  valid_from           date NOT NULL,
  valid_to             date,
  change_id            bigint NOT NULL REFERENCES change_request,
  recorded_at          timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by          bigint NOT NULL REFERENCES app_user,
  closed_change_id     bigint REFERENCES change_request,
  CONSTRAINT department_hierarchy_self_check CHECK (parent_department_id <> child_department_id),
  CONSTRAINT department_hierarchy_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- 同一视图、同一时点每个部门最多一个直接上级
  CONSTRAINT department_hierarchy_single_parent_excl EXCLUDE USING gist (
    view_id WITH =, child_department_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX department_hierarchy_parent_idx
  ON department_hierarchy (view_id, parent_department_id);
CREATE TRIGGER department_hierarchy_guard BEFORE UPDATE ON department_hierarchy
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

CREATE TABLE department_relation (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind               text NOT NULL,
  from_department_id bigint NOT NULL REFERENCES department,
  to_department_id   bigint REFERENCES department,
  campus_id          bigint REFERENCES campus,
  scope              text NOT NULL,
  valid_from         date NOT NULL,
  valid_to           date,
  change_id          bigint NOT NULL REFERENCES change_request,
  recorded_at        timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by        bigint NOT NULL REFERENCES app_user,
  closed_change_id   bigint REFERENCES change_request,
  CONSTRAINT department_relation_kind_check
    CHECK (kind IN ('PROFESSIONAL_MGMT', 'COLLABORATION', 'CAMPUS_MGMT')),
  CONSTRAINT department_relation_scope_check CHECK (btrim(scope) <> ''),
  CONSTRAINT department_relation_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT department_relation_self_check
    CHECK (to_department_id IS NULL OR to_department_id <> from_department_id),
  -- 院区管理必须指明院区；专业管理、协作必须指明另一个部门
  CONSTRAINT department_relation_target_check CHECK (
    (kind = 'CAMPUS_MGMT' AND campus_id IS NOT NULL)
    OR (kind <> 'CAMPUS_MGMT' AND campus_id IS NULL AND to_department_id IS NOT NULL)),
  CONSTRAINT department_relation_dup_excl EXCLUDE USING gist (
    kind WITH =, from_department_id WITH =, (coalesce(to_department_id, 0)) WITH =,
    (coalesce(campus_id, 0)) WITH =, scope WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX department_relation_from_idx ON department_relation (from_department_id);
CREATE INDEX department_relation_to_idx ON department_relation (to_department_id);
CREATE TRIGGER department_relation_guard BEFORE UPDATE ON department_relation
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id');

INSERT INTO approval_rule (object_type, action) VALUES
  ('department', 'set_parent'), ('department', 'relation_create'),
  ('department', 'relation_close');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE object_type = 'department'
  AND action IN ('set_parent', 'relation_create', 'relation_close');
DROP TABLE department_relation, department_hierarchy;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
