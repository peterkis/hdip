"""标准资料库：参考资料（没有标准号的官方资料）

计划：docs/标准资料库-uniData接入计划.md G1、决定 U5

- reference_material：统计报表、官方参考资料、医保更新等没有标准号的资料，只留身份
  （类别 + 名称 + 年份），不冒充标准：没有官方状态、没有目录版本，不进标准统计；
- standard_file 放宽为“属于一项标准或一份参考资料，二者恰有其一”。已登记的文件行不动。
与其他标准资料表相同：只由 api/scripts/import_catalog.py（hdip_owner）写入，hdip_app 只读，
登记后整行不可改。

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE reference_material (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category       text NOT NULL
    CONSTRAINT reference_material_category_check
    CHECK (category IN ('STAT_FORM', 'OFFICIAL_REFERENCE', 'PAYER_UPDATE')),
  title          text NOT NULL
    CONSTRAINT reference_material_title_check CHECK (btrim(title) <> ''),
  year           text CONSTRAINT reference_material_year_check CHECK (year ~ '^[0-9]{4}$'),
  note           text,
  registered_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT reference_material_uniq UNIQUE NULLS NOT DISTINCT (category, title, year)
);
COMMENT ON TABLE reference_material IS
  '没有标准号的官方资料（统计报表 / 官方参考资料 / 医保更新），只留身份；不编造标准号，'
  '没有官方状态与目录版本，不进标准统计';
COMMENT ON COLUMN reference_material.year IS '资料年份文字（取自归档目录），不是标准年份';
CREATE TRIGGER reference_material_guard BEFORE UPDATE ON reference_material
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

ALTER TABLE standard_file ALTER COLUMN edition_id DROP NOT NULL;
ALTER TABLE standard_file ADD COLUMN reference_id bigint REFERENCES reference_material;
ALTER TABLE standard_file ADD CONSTRAINT standard_file_owner_check
  CHECK (num_nonnulls(edition_id, reference_id) = 1);
ALTER TABLE standard_file ADD CONSTRAINT standard_file_reference_sha_uniq
  UNIQUE (reference_id, sha256);
COMMENT ON COLUMN standard_file.reference_id IS
  '所属参考资料；与 edition_id 恰有其一（standard_file_owner_check）';

REVOKE INSERT, UPDATE ON reference_material FROM hdip_app;
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE standard_file DROP CONSTRAINT standard_file_reference_sha_uniq;
ALTER TABLE standard_file DROP CONSTRAINT standard_file_owner_check;
ALTER TABLE standard_file DROP COLUMN reference_id;
ALTER TABLE standard_file ALTER COLUMN edition_id SET NOT NULL;
DROP TABLE reference_material;
""")
