.PHONY: db migrate api web gen test check

db:
	docker compose up -d db

migrate:
	cd api && uv run alembic upgrade head

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
