"""院区、部门、服务单元的代码改由系统分配；名称带拼音码（2026-10-19 Peter 决定）

- 代码规则：院区 C + 3 位数字，部门 D + 6 位数字，服务单元 SU + 6 位数字；大小写等价，一律存大写。
  三个序列发号，号码只增不回收（撤销、退回的草稿留下空号，不影响识别）。
- code_reservation：发出的每个号登记一行（类型、代码、请求键 + 槽位、谁、何时），只追加、不可修改。
  请求键 + 槽位唯一：同一次保存重试时拿回同一个号。新建院区 / 部门 / 服务单元（含拆分、合并的后继、
  组织变更新设的部门）只能使用已登记的同类型代码，由应用层在确认与预演时检查。
- 拼音码 pinyin：名称的拼音首字母（大写字母与数字），随名称进版本，用于检索，不要求唯一。
  旧版本没有拼音码（空）；新版本由表单生成、可修改，未给出时后端按名称生成。

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
CREATE SEQUENCE campus_code_seq MINVALUE 1 MAXVALUE 999 NO CYCLE;
CREATE SEQUENCE department_code_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;
CREATE SEQUENCE service_unit_code_seq MINVALUE 1 MAXVALUE 999999 NO CYCLE;

CREATE TABLE code_reservation (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_type  text NOT NULL
    CONSTRAINT code_reservation_type_check
    CHECK (object_type IN ('campus', 'department', 'service_unit')),
  code         text NOT NULL CONSTRAINT code_reservation_code_uniq UNIQUE,
  request_key  text NOT NULL
    CONSTRAINT code_reservation_key_check CHECK (length(request_key) BETWEEN 8 AND 100),
  slot         integer NOT NULL CONSTRAINT code_reservation_slot_check CHECK (slot >= 0),
  reserved_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  reserved_by  bigint NOT NULL REFERENCES app_user,
  CONSTRAINT code_reservation_request_uniq UNIQUE (request_key, object_type, slot)
);
COMMENT ON TABLE code_reservation IS
  '系统发出的院区 / 部门 / 服务单元代码；只追加。新建对象只能用这里登记的同类型代码';
CREATE TRIGGER code_reservation_guard BEFORE UPDATE ON code_reservation
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

ALTER TABLE campus_version ADD COLUMN pinyin text
  CONSTRAINT campus_version_pinyin_check CHECK (pinyin ~ '^[A-Z0-9]{1,64}$');
ALTER TABLE department_version ADD COLUMN pinyin text
  CONSTRAINT department_version_pinyin_check CHECK (pinyin ~ '^[A-Z0-9]{1,64}$');
ALTER TABLE service_unit_version ADD COLUMN pinyin text
  CONSTRAINT service_unit_version_pinyin_check CHECK (pinyin ~ '^[A-Z0-9]{1,64}$');
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE service_unit_version DROP COLUMN pinyin;
ALTER TABLE department_version DROP COLUMN pinyin;
ALTER TABLE campus_version DROP COLUMN pinyin;
DROP TABLE code_reservation;
DROP SEQUENCE service_unit_code_seq;
DROP SEQUENCE department_code_seq;
DROP SEQUENCE campus_code_seq;
""")
