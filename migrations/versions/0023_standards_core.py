"""标准资料库 F0：来源包、结构化文档修订、类型化条目、来源中的引用

计划：docs/标准资料库-F0F1开发计划.md

标准资料是外部原文的只读参考，不是院内主数据：
- 只由本地导入命令（api/scripts/import_standards.py，用 hdip_owner 连接）写入，不经变更申请，
  没有任何 API 写入口；应用账号 hdip_app 只有 SELECT。
- source_package、standard_entry、standard_reference 登记后整行不可改（hdip_guard_update）；
  source_document 只允许导入命令随接入范围扩大更新覆盖清单（covered_keys / imported_at），
  身份字段不变。读取器修正导致结果不同 = 新的 reader_version = 新的文档修订行。
- 引用只保存来源中写明的内容（标准号、年份文字、值域标识）；指向本库哪条条目在读取时按目录计算，
  原文未写年份的不写成指定了某一年。

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ---------------------------------------------------------------- 来源包
CREATE TABLE source_package (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_name        text NOT NULL,
  stored_path      text NOT NULL,
  bytes            bigint NOT NULL CONSTRAINT source_package_bytes_check CHECK (bytes > 0),
  sha256           text NOT NULL
    CONSTRAINT source_package_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  expected_sha256  text
    CONSTRAINT source_package_expected_check CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  release_id       text,
  drive_file_id    text,
  source_url       text,
  members          jsonb NOT NULL,
  registered_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT source_package_sha_uniq UNIQUE (sha256),
  CONSTRAINT source_package_expected_match_check
    CHECK (expected_sha256 IS NULL OR expected_sha256 = sha256)
);
COMMENT ON TABLE source_package IS
  '收录的标准资料包（ZIP）：身份、本地摘要与预期摘要、成员清单；同字节只登记一次，登记后不可改';
COMMENT ON COLUMN source_package.expected_sha256 IS
  '清单给出的预期 SHA-256；为空 = 未与预期比对（不写成已验真）。与本地摘要不一致的包不能登记';
COMMENT ON COLUMN source_package.stored_path IS '相对 HDIP_STANDARDS_DIR 的保存位置';
CREATE TRIGGER source_package_guard BEFORE UPDATE ON source_package
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- ---------------------------------------------------------------- 结构化文档修订
CREATE TABLE source_document (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id       bigint NOT NULL REFERENCES source_package,
  standard_no      text NOT NULL
    CONSTRAINT source_document_no_check CHECK (btrim(standard_no) <> ''),
  standard_year    text CONSTRAINT source_document_year_check CHECK (standard_year ~ '^[0-9]{4}$'),
  title            text,
  family           text NOT NULL,
  members          jsonb NOT NULL,
  source_version   text,
  source_sha256    text,
  source_pdf       text,
  source_url       text,
  reader           text NOT NULL,
  reader_version   text NOT NULL,
  total_records    integer NOT NULL
    CONSTRAINT source_document_total_check CHECK (total_records >= 0),
  covered_keys     integer NOT NULL DEFAULT 0,
  imported_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT source_document_rev_uniq
    UNIQUE NULLS NOT DISTINCT
    (package_id, family, standard_no, standard_year, reader, reader_version)
);
COMMENT ON TABLE source_document IS
  '某标准原文版本（标准号 + 年份）在某个资料包、某个读取器版本下的一份结构化修订视图。'
  '一个汇总 JSON 可含多个分册，各分册分别成行；原文年份不是整理年份';
COMMENT ON COLUMN source_document.members IS '读取的包内成员：[{path, sha256, bytes}]';
COMMENT ON COLUMN source_document.source_sha256 IS
  '原文件（PDF）的 SHA-256，取自资料；不是 ZIP 摘要';
COMMENT ON COLUMN source_document.total_records IS '该修订在所读成员中的源记录总数（各类型合计）';
COMMENT ON COLUMN source_document.covered_keys IS '已接入的源记录数；导入范围扩大时更新';
CREATE INDEX source_document_std_idx ON source_document (standard_no, standard_year);
CREATE OR REPLACE FUNCTION source_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.package_id, NEW.standard_no, NEW.standard_year, NEW.family, NEW.members,
      NEW.reader, NEW.reader_version, NEW.total_records, NEW.source_sha256)
     IS DISTINCT FROM
     (OLD.package_id, OLD.standard_no, OLD.standard_year, OLD.family, OLD.members,
      OLD.reader, OLD.reader_version, OLD.total_records, OLD.source_sha256) THEN
    RAISE EXCEPTION 'source_document 的身份字段不可修改' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'source_document_identity_guard';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_document_guard BEFORE UPDATE ON source_document
  FOR EACH ROW EXECUTE FUNCTION source_document_guard();

-- ---------------------------------------------------------------- 类型化条目
CREATE TABLE standard_entry (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id    bigint NOT NULL REFERENCES source_document,
  entry_type     text NOT NULL
    CONSTRAINT standard_entry_type_check
    CHECK (entry_type IN ('data_element', 'value_domain', 'code_row')),
  source_key     text NOT NULL CONSTRAINT standard_entry_key_check CHECK (btrim(source_key) <> ''),
  identifier     text,
  name           text,
  parent_id      bigint REFERENCES standard_entry,
  seq            integer NOT NULL,
  body           jsonb NOT NULL,
  raw            jsonb NOT NULL,
  provenance     jsonb NOT NULL,
  search_text    text NOT NULL,
  imported_at    timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_entry_source_uniq UNIQUE (document_id, entry_type, source_key)
);
COMMENT ON TABLE standard_entry IS
  '来源条目（数据元、值域表、代码行…）；类型由代码固定，正文 body 按类型固定结构，'
  'raw 为原记录。同一码值在不同表或年份各有条目，不按码值去重';
COMMENT ON COLUMN standard_entry.source_key IS
  '源记录键：优先原 row_id / record_id，缺少时用“成员路径#JSON 位置”';
COMMENT ON COLUMN standard_entry.identifier IS 'DE / CV 编号或码值，只用于检索，不是跨版本主键';
COMMENT ON COLUMN standard_entry.search_text IS
  '检索用派生文本（空白归一、小写），原值在 body / raw';
CREATE INDEX standard_entry_doc_idx ON standard_entry (document_id, entry_type, seq);
CREATE INDEX standard_entry_ident_idx ON standard_entry (identifier);
CREATE INDEX standard_entry_parent_idx ON standard_entry (parent_id);
CREATE TRIGGER standard_entry_guard BEFORE UPDATE ON standard_entry
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- ---------------------------------------------------------------- 来源中的引用
CREATE TABLE standard_reference (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_entry_id      bigint NOT NULL REFERENCES standard_entry,
  field              text NOT NULL,
  ref_kind           text NOT NULL
    CONSTRAINT standard_reference_kind_check
    CHECK (ref_kind IN ('value_domain', 'external_standard')),
  raw_text           text NOT NULL,
  target_standard    text NOT NULL,
  target_year        text
    CONSTRAINT standard_reference_year_check CHECK (target_year ~ '^[0-9]{4}$'),
  target_identifier  text,
  target_label       text,
  CONSTRAINT standard_reference_from_uniq UNIQUE (from_entry_id, field)
);
COMMENT ON TABLE standard_reference IS
  '条目原文里出现的引用：只记原文写明的标准号、年份文字与目标标识；'
  '指向本库哪条条目在读取时按目录计算（原文指定 / 目录定位 / 未解析 / 多候选）';
COMMENT ON COLUMN standard_reference.target_year IS '原文写明的年份；为空 = 原文未写年份';
CREATE INDEX standard_reference_target_idx ON standard_reference (target_identifier);
CREATE TRIGGER standard_reference_guard BEFORE UPDATE ON standard_reference
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- 应用账号只读：写入只经导入命令（hdip_owner）
REVOKE INSERT, UPDATE ON source_package, source_document, standard_entry, standard_reference
  FROM hdip_app;
""")


def downgrade() -> None:
    op.execute("""
DROP TABLE standard_reference;
DROP TABLE standard_entry;
DROP TABLE source_document;
DROP FUNCTION source_document_guard();
DROP TABLE source_package;
""")
