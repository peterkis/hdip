"""草稿写入的请求键：新建、更新草稿可重试且不重复写入（U3.1 遗留 R01-1）

- change_request_write：每次带请求键、成功写入的草稿操作登记一行
  （谁、哪个键、新建还是更新、哪张申请、何时）。
  只追加、不可修改；同一用户同一请求键只能登记一次。
- 同一用户用同一请求键再次新建或更新时：提交内容（变更项 + 说明的摘要 payload_hash）相同 = 重试，
  不再执行写入，原样返回那张申请；内容不同 = 上次保存已写入、之后又改过，
  拒绝并说明，不把旧结果当成新内容已保存。
  这样网络中断、响应丢失后的重试不会再建一张草稿，也不会把变更项重复追加进已有草稿。

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE change_request_write (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            bigint NOT NULL REFERENCES app_user,
  request_key        text NOT NULL
    CONSTRAINT change_request_write_key_check CHECK (length(request_key) BETWEEN 8 AND 100),
  action             text NOT NULL
    CONSTRAINT change_request_write_action_check CHECK (action IN ('create', 'update')),
  change_request_id  bigint NOT NULL REFERENCES change_request,
  payload_hash       text NOT NULL
    CONSTRAINT change_request_write_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  written_at         timestamp NOT NULL DEFAULT LOCALTIMESTAMP,
  CONSTRAINT change_request_write_key_uniq UNIQUE (user_id, request_key)
);
COMMENT ON TABLE change_request_write IS
  '带请求键的草稿写入（新建 / 更新）登记；只追加。'
  '同一用户同一请求键再次写入时原样返回那张申请，不重复写入';
CREATE TRIGGER change_request_write_guard BEFORE UPDATE ON change_request_write
  FOR EACH ROW EXECUTE FUNCTION hdip_guard_update();
""")


def downgrade() -> None:
    op.execute("DROP TABLE change_request_write;")
