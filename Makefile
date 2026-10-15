.PHONY: db db-init db-docker migrate db-doc api web gen test check

# 本机 Homebrew PostgreSQL 18
db:
	brew services start postgresql@18

# 首次：按 .env 建 hdip_owner / hdip_app 账号和 hdip 库（可重复执行，不动其他库）
db-init:
	./db/local-setup.sh

# 备选：有 Docker 时用容器里的 PostgreSQL 18（账号由 db/init/ 初始化）
db-docker:
	docker compose up -d db

migrate:
	cd api && uv run alembic upgrade head

# 从数据库生成表结构参考 docs/database/schema-reference.md（迁移后执行）
db-doc:
	cd api && uv run python scripts/export_schema_doc.py

api:
	cd api && uv run uvicorn hdip_api.main:app --reload --port 8000

web:
	cd web && npm run dev

gen:
	cd api && uv run python scripts/export_openapi.py
	cd web && npm run gen:api

test:
	cd api && uv run pytest -q

check:
	cd api && uv run ruff check . ../migrations && uv run ruff format --check . ../migrations
	cd web && npm run typecheck
