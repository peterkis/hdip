"""标准资料库 G2：来源声明与人工更正

计划：docs/标准资料库-uniData接入计划.md G2

- standard_edition_claim：每条来源记录对一项标准的原样写法（编号、名称、日期、状态、地址、
  文件摘要），冲突全部保留，只追加；它说的是“该来源当时这样记载”，不覆盖当前目录。与标准的关联在读取时计算
  （按原样写的标准号 + 年份、按文件摘要），不在表里替人选定；
- standard_catalog_correction：仓库 data/standards/catalog-corrections.csv 的每一行（更正或撤销），
  登记后不可改；导入时把生效的更正叠在生成的目录上，有差异才追加目录版本；
- standard_edition_version.correction_keys：这一版目录信息用到的人工更正编号。
与其他标准资料表相同：只由 api/scripts/import_catalog.py（hdip_owner）写入，hdip_app 只读。

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE standard_edition_claim (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source           text NOT NULL
    CONSTRAINT standard_edition_claim_source_check CHECK (btrim(source) <> ''),
  source_file      text NOT NULL,
  source_sha256    text NOT NULL
    CONSTRAINT standard_edition_claim_source_sha_check CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  record_key       text NOT NULL,
  recorded_at      text,
  standard_no      text,
  standard_year    text
    CONSTRAINT standard_edition_claim_year_check CHECK (standard_year ~ '^[0-9]{4}$'),
  code_as_written  text,
  title            text,
  status           text,
  issued           text,
  effective        text,
  abolished        text,
  url              text,
  file_sha256      text
    CONSTRAINT standard_edition_claim_file_sha_check CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  raw              jsonb NOT NULL,
  registered_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_edition_claim_uniq UNIQUE (source, source_sha256, record_key)
);
COMMENT ON TABLE standard_edition_claim IS
  '来源记录对一项标准的原样写法（官网目录快照、Drive 归档清单、uniData 历史目录 / 补源记录…），'
  '冲突全部保留、只追加；不覆盖当前目录，与标准的关联在读取时按标准号 + 年份、文件摘要计算';
COMMENT ON COLUMN standard_edition_claim.standard_no IS
  '按原样写法解析出的标准号（WS/T 363.3）；解析不出为空，不猜';
COMMENT ON COLUMN standard_edition_claim.issued IS '发布日期，来源原样文字';
COMMENT ON COLUMN standard_edition_claim.file_sha256 IS
  '该记录指向的文件摘要；只证明文件字节，不证明标准身份';
CREATE INDEX standard_edition_claim_std_idx ON standard_edition_claim (standard_no, standard_year);
CREATE INDEX standard_edition_claim_file_idx ON standard_edition_claim (file_sha256);
CREATE TRIGGER standard_edition_claim_guard BEFORE UPDATE ON standard_edition_claim
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

CREATE TABLE standard_catalog_correction (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correction_key  text NOT NULL
    CONSTRAINT standard_catalog_correction_key_check CHECK (correction_key ~ '^C[0-9]{4}$'),
  action          text NOT NULL
    CONSTRAINT standard_catalog_correction_action_check CHECK (action IN ('CORRECT', 'WITHDRAW')),
  edition_id      bigint REFERENCES standard_edition,
  field           text
    CONSTRAINT standard_catalog_correction_field_check CHECK (field IN (
      'title', 'issued_on', 'effective_on', 'abolished_on', 'difference', 'file_identity', 'note')),
  new_value       text,
  clears          boolean NOT NULL DEFAULT false,
  withdraws_key   text,
  basis_url       text,
  basis_sha256    text
    CONSTRAINT standard_catalog_correction_basis_sha_check CHECK (basis_sha256 ~ '^[0-9a-f]{64}$'),
  basis_pages     text,
  note            text,
  confirmed_by    text NOT NULL
    CONSTRAINT standard_catalog_correction_confirmed_check CHECK (btrim(confirmed_by) <> ''),
  confirmed_on    date NOT NULL,
  registered_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_catalog_correction_key_uniq UNIQUE (correction_key),
  CONSTRAINT standard_catalog_correction_shape_check CHECK (
    (action = 'CORRECT' AND edition_id IS NOT NULL AND field IS NOT NULL AND withdraws_key IS NULL
      AND (clears OR new_value IS NOT NULL) AND NOT (clears AND new_value IS NOT NULL)
      AND (basis_url IS NOT NULL OR basis_sha256 IS NOT NULL))
    OR (action = 'WITHDRAW' AND withdraws_key IS NOT NULL AND field IS NULL AND new_value IS NULL
      AND NOT clears)
  )
);
COMMENT ON TABLE standard_catalog_correction IS
  '人工更正表（仓库 data/standards/catalog-corrections.csv）的一行：更正一项标准的一个目录字段，'
  '或撤销先前的一条更正；登记后不可改，撤销只能另起一行。只改目录描述，不改标准号、年份、文件与处理修订';
COMMENT ON COLUMN standard_catalog_correction.clears IS
  '明确清空该字段（CSV 写“（清空）”），区别于未填写';
CREATE TRIGGER standard_catalog_correction_guard BEFORE UPDATE ON standard_catalog_correction
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

ALTER TABLE standard_edition_version
  ADD COLUMN correction_keys text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN standard_edition_version.correction_keys IS
  '这一版目录信息用到的人工更正编号（生效中的）；空 = 完全取自生成的目录';

REVOKE INSERT, UPDATE ON standard_edition_claim, standard_catalog_correction FROM hdip_app;
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE standard_edition_version DROP COLUMN correction_keys;
DROP TABLE standard_catalog_correction;
DROP TABLE standard_edition_claim;
""")
