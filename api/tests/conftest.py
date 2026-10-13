"""测试使用独立的数据库（原库名加 _test），每次测试会话重建并跑完迁移。

- 迁移与清理用表属主账号（需要 CREATEDB 权限；docker 里的 hdip_owner 是超级用户）。
- 应用请求用 hdip_app 账号，和生产一样没有 DELETE 权限。
- 每个测试前清空业务表；种子（用户、选项、确认规则）保留。
"""

import os

from sqlalchemy.engine import make_url

from hdip_api.core.config import Settings, get_settings

_base = Settings()
_app_url = make_url(_base.database_url)
_owner_url = make_url(_base.migration_database_url)
TEST_DB = f"{_owner_url.database}_test"
os.environ["HDIP_DATABASE_URL"] = _app_url.set(database=TEST_DB).render_as_string(False)
os.environ["HDIP_MIGRATION_DATABASE_URL"] = _owner_url.set(database=TEST_DB).render_as_string(False)
get_settings.cache_clear()

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

BUSINESS_TABLES = (
    "service_unit_version, service_unit, department, "
    "operator_relation, campus_version, campus, institution_version, institution, change_request"
)


@pytest.fixture(scope="session")
def owner_engine():
    admin = create_engine(_owner_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{TEST_DB}"'))
    admin.dispose()
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    engine = create_engine(_owner_url.set(database=TEST_DB))
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def clean(owner_engine):
    with owner_engine.begin() as c:
        c.execute(text(f"TRUNCATE {BUSINESS_TABLES} RESTART IDENTITY CASCADE"))
        c.execute(text("UPDATE approval_rule SET allow_self_confirm = true"))
    yield


@pytest.fixture
def app_engine():
    from hdip_api.core.db import engine

    return engine


class Api:
    """带身份的测试客户端：api.as_("solo").post(...)"""

    def __init__(self, client: TestClient, user: str = "solo") -> None:
        self.client, self.user = client, user

    def as_(self, user: str) -> "Api":
        return Api(self.client, user)

    def _h(self):
        return {"X-HDIP-User": self.user}

    def get(self, url, **kw):
        return self.client.get(url, headers=self._h(), **kw)

    def post(self, url, json=None, **kw):
        return self.client.post(url, json=json, headers=self._h(), **kw)

    def put(self, url, json=None, **kw):
        return self.client.put(url, json=json, headers=self._h(), **kw)

    # 常用流程
    def draft(self, *items, note=None):
        r = self.post("/api/change-requests", {"items": list(items), "note": note})
        assert r.status_code == 200, r.text
        return r.json()

    def submit(self, cid):
        return self.post(f"/api/change-requests/{cid}/submit")

    def confirm(self, cid):
        return self.post(f"/api/change-requests/{cid}/confirm")

    def apply(self, *items):
        """草稿 → 提交 → 确认，三步都必须成功。"""
        cr = self.draft(*items)
        r = self.submit(cr["id"])
        assert r.status_code == 200, r.text
        r = self.confirm(cr["id"])
        assert r.status_code == 200, r.text
        return r.json()


@pytest.fixture
def api(owner_engine) -> Api:
    from hdip_api.main import app

    return Api(TestClient(app))


@pytest.fixture
def client(owner_engine) -> TestClient:
    from hdip_api.main import app

    return TestClient(app)
