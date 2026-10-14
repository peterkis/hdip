"""第 3 步：服务单元演变关系（拆分、合并）与单元类型中文名

- service_unit_lineage：前身单元 → 后继单元，一行一对；拆分是一对多、合并是多对一，各写多行。
  只追加，不更新；后继是新身份、新代码，不继承前身历史，也不自动迁移任何引用。
- 单元类型中文名改用旧仓库院内建议码表的名称，按统一语言把“业务单元”改称“单元”；码值不变。

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = r"""
CREATE TABLE service_unit_lineage (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  predecessor_id bigint NOT NULL REFERENCES service_unit,
  successor_id   bigint NOT NULL REFERENCES service_unit,
  lineage_type   text NOT NULL,
  -- 后继单元的开始日；前身的最后有效日为其前一日
  effective_date date NOT NULL,
  change_id      bigint NOT NULL REFERENCES change_request,
  recorded_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  recorded_by    bigint NOT NULL REFERENCES app_user,
  CONSTRAINT service_unit_lineage_type_check CHECK (lineage_type IN ('SPLIT', 'MERGE')),
  CONSTRAINT service_unit_lineage_self_check CHECK (predecessor_id <> successor_id),
  CONSTRAINT service_unit_lineage_pair_uniq UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX service_unit_lineage_successor_idx ON service_unit_lineage (successor_id);
CREATE TRIGGER service_unit_lineage_guard BEFORE UPDATE ON service_unit_lineage
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

UPDATE option_item SET name = v.name
  FROM (VALUES
    ('OPD', '门诊单元'), ('IPD', '住院单元'), ('ED', '急诊单元'),
    ('EXAM', '检查执行单元'), ('LAB', '检验执行单元'), ('PHARMACY', '药房'),
    ('OR', '手术服务单元'), ('OTHER', '其他')
  ) AS v(code, name)
  WHERE option_item.category = 'service_unit_type' AND option_item.code = v.code;

INSERT INTO approval_rule (object_type, action) VALUES
  ('service_unit', 'split'), ('service_unit', 'merge');
"""

DOWNGRADE = r"""
DELETE FROM approval_rule WHERE object_type = 'service_unit' AND action IN ('split', 'merge');
UPDATE option_item SET name = v.name
  FROM (VALUES
    ('OPD', '门诊'), ('IPD', '住院'), ('ED', '急诊'), ('EXAM', '检查'), ('LAB', '检验'),
    ('PHARMACY', '药学'), ('OR', '手术'), ('OTHER', '其他')
  ) AS v(code, name)
  WHERE option_item.category = 'service_unit_type' AND option_item.code = v.code;
DROP TABLE service_unit_lineage;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
