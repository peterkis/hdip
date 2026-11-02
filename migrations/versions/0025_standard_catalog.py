"""标准资料库：标准目录与原文文件

计划：docs/标准资料库-目录与原文实施计划.md 第 3 节

- standard_edition：一项标准的一个版次（标准号 + 年份），只留身份；
- standard_edition_version：目录信息（名称、官网状态与日期、核实依据…），只追加，最新一行为当前；
- standard_file：原件层里挂在标准下的文件（路径、大小、摘要、角色、来源、身份核对）。
与其他标准资料表相同：只由本地导入命令（api/scripts/import_catalog.py，hdip_owner）
写入，hdip_app 只读；登记后整行不可改。已有结构化成果（source_document）
按标准号 + 年份、原文摘要在读取时挂上，不建挂接表，不改已有数据。

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ---------------------------------------------------------------- 标准（身份）
CREATE TABLE standard_edition (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series         text NOT NULL
    CONSTRAINT standard_edition_series_check CHECK (series IN ('GB', 'GB/T', 'WS', 'WS/T')),
  standard_no    text NOT NULL,
  standard_year  text NOT NULL
    CONSTRAINT standard_edition_year_check CHECK (standard_year ~ '^[0-9]{4}$'),
  registered_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_edition_no_check
    CHECK (standard_no LIKE series || ' %' AND standard_no ~ ' [0-9]+(\\.[0-9]+)*$'),
  CONSTRAINT standard_edition_uniq UNIQUE (standard_no, standard_year)
);
COMMENT ON TABLE standard_edition IS
  '一项标准的一个版次（标准号 + 年份），只留身份；WS 与 WS/T 写法不同算两项。'
  '目录信息在 standard_edition_version';
COMMENT ON COLUMN standard_edition.standard_no IS
  '标准号，写法与 source_document.standard_no 相同（WS/T 363.3），以 series 开头';
CREATE TRIGGER standard_edition_guard BEFORE UPDATE ON standard_edition
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- ---------------------------------------------------------------- 目录信息（只追加）
CREATE TABLE standard_edition_version (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  edition_id        bigint NOT NULL REFERENCES standard_edition,
  seq               integer NOT NULL CONSTRAINT standard_edition_version_seq_check CHECK (seq >= 1),
  title             text NOT NULL
    CONSTRAINT standard_edition_version_title_check CHECK (btrim(title) <> ''),
  catalog_code      text,
  catalog_category  text,
  status            text
    CONSTRAINT standard_edition_version_status_check CHECK (status IN ('CURRENT', 'ABOLISHED')),
  issued_on         date,
  effective_on      date,
  abolished_on      date,
  verified_on       date,
  basis_url         text,
  basis_note        text,
  online_url        text,
  difference        text,
  file_identity     text,
  note              text,
  change_note       text NOT NULL,
  recorded_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_edition_version_uniq UNIQUE (edition_id, seq),
  CONSTRAINT standard_edition_version_basis_check CHECK (
    status IS NULL
    OR (verified_on IS NOT NULL AND (basis_url IS NOT NULL OR basis_note IS NOT NULL))
  ),
  CONSTRAINT standard_edition_version_abolished_check
    CHECK (abolished_on IS NULL OR status = 'ABOLISHED')
);
COMMENT ON TABLE standard_edition_version IS
  '标准的目录信息，每改一次追加一行（seq 递增），最新一行为当前；没有业务有效期';
COMMENT ON COLUMN standard_edition_version.status IS
  '官方来源核实到的状态：CURRENT 现行（含官网“即将实施”，读取时按实施日期推算）/ ABOLISHED 废止；'
  '空 = 待核实，不当作现行';
COMMENT ON COLUMN standard_edition_version.catalog_code IS '官网目录写法（如 WS/T 118-1999），原样';
COMMENT ON COLUMN standard_edition_version.difference IS
  '官网目录与文件不一致的类别（前缀不同 / 错链 / 目录与文件标识不一致），原件层整理结论，原样';
COMMENT ON COLUMN standard_edition_version.file_identity IS '文件封面写法与目录不同时的文件内标识';
CREATE TRIGGER standard_edition_version_guard BEFORE UPDATE ON standard_edition_version
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- ---------------------------------------------------------------- 原文文件
CREATE TABLE standard_file (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  edition_id      bigint NOT NULL REFERENCES standard_edition,
  role            text NOT NULL
    CONSTRAINT standard_file_role_check
    CHECK (role IN ('TEXT', 'BOUND', 'ERRATA', 'PAGE_IMAGE', 'ORIGINAL_FORMAT')),
  source          text NOT NULL,
  identity_check  text NOT NULL,
  page_image      boolean NOT NULL DEFAULT false,
  stored_path     text NOT NULL
    CONSTRAINT standard_file_path_check
    CHECK (stored_path LIKE 'originals/%' AND stored_path NOT LIKE '%..%'),
  file_name       text NOT NULL,
  media_type      text NOT NULL,
  bytes           bigint NOT NULL CONSTRAINT standard_file_bytes_check CHECK (bytes > 0),
  sha256          text NOT NULL
    CONSTRAINT standard_file_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note            text,
  registered_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT standard_file_path_uniq UNIQUE (stored_path),
  CONSTRAINT standard_file_edition_sha_uniq UNIQUE (edition_id, sha256)
);
COMMENT ON TABLE standard_file IS
  '原件层里挂在某项标准下的文件；同一标准可有多份，按摘要认同一份文件';
COMMENT ON COLUMN standard_file.source IS
  '取得渠道（官网下载 / Drive 归档 NN），原样；不表示身份已核对';
COMMENT ON COLUMN standard_file.identity_check IS
  '文件身份核对结论（与官网目录一致 / Drive 已核对封面 / 未逐份核对封面…），原样';
COMMENT ON COLUMN standard_file.stored_path IS '相对 HDIP_STANDARDS_DIR 的路径，须在 originals/ 下';
CREATE INDEX standard_file_sha_idx ON standard_file (sha256);
CREATE TRIGGER standard_file_guard BEFORE UPDATE ON standard_file
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();

-- 应用账号只读：写入只经导入命令（hdip_owner）
REVOKE INSERT, UPDATE ON standard_edition, standard_edition_version, standard_file FROM hdip_app;
""")


def downgrade() -> None:
    op.execute("""
DROP TABLE standard_file;
DROP TABLE standard_edition_version;
DROP TABLE standard_edition;
""")
