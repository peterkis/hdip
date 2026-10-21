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
    "person_assignment, person_work_no, person_engagement, person_version, person, "
    "department_change_participant, department_change_event, "
    "external_code_assignment, external_code, service_unit_classification, "
    "service_unit_lineage, service_unit_version, service_unit, "
    "department_hierarchy, department_relation, "
    "department_alias, department_classification, department_institution, department_version, "
    "department, "
    "operator_relation, campus_version, campus, institution_version, institution, change_request, "
    "code_reservation"
)
CODE_SEQUENCES = (
    "campus_code_seq",
    "department_code_seq",
    "service_unit_code_seq",
    "person_code_seq",
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
        for seq in CODE_SEQUENCES:
            c.execute(text(f"ALTER SEQUENCE {seq} RESTART"))
        c.execute(text("UPDATE approval_rule SET allow_self_confirm = true"))
        # 字典测试新增的代码（配置表不在 TRUNCATE 之列）
        c.execute(text("DELETE FROM classification_code WHERE code LIKE 'TEST\\_%'"))
        # 测试登记的外部分类方案、来源系统与字典（配置，测试库里整表清空）
        c.execute(
            text(
                "DELETE FROM classification_code WHERE scheme_id IN "
                "(SELECT id FROM classification_scheme WHERE code LIKE 'TEST\\_%')"
            )
        )
        c.execute(text("DELETE FROM classification_scheme WHERE code LIKE 'TEST\\_%'"))
        c.execute(text("DELETE FROM code_namespace"))
        c.execute(text("DELETE FROM source_system"))
    yield


@pytest.fixture
def app_engine():
    from hdip_api.core.db import engine

    return engine


CREATE_TYPES = {
    "campus.create": "campus",
    "department.create": "department",
    "service_unit.create": "service_unit",
    "person.create": "person",
}


def _issued(items: list) -> list[tuple[str, str]]:
    """申请里要新建的对象代码与类型（含拆分 / 合并的后继）。"""
    out = []
    for i in items or []:
        k = i.get("kind")
        if k in CREATE_TYPES:
            out.append((CREATE_TYPES[k], str(i["code"]).upper()))
        elif k == "service_unit.split":
            out += [("service_unit", str(x["code"]).upper()) for x in i.get("successors", [])]
        elif k == "service_unit.merge":
            out.append(("service_unit", str(i["successor"]["code"]).upper()))
    return out


class Api:
    """带身份的测试客户端：api.as_("solo").post(...)

    新建院区 / 部门 / 服务单元的代码须由系统预留（迁移 0015）。多数测试关心的不是取号，
    所以写申请时自动把其中要新建的代码登记为已预留（沿用 XNK、GX 这类可读的测试代码）；
    测试取号规则本身时用 api.strict() 关掉。
    """

    def __init__(
        self, client: TestClient, user: str = "solo", engine=None, auto_issue=True
    ) -> None:
        self.client, self.user, self.engine, self.auto_issue = client, user, engine, auto_issue

    def as_(self, user: str) -> "Api":
        return Api(self.client, user, self.engine, self.auto_issue)

    def strict(self) -> "Api":
        return Api(self.client, self.user, self.engine, auto_issue=False)

    def _issue(self, url: str, body) -> None:
        if not (self.auto_issue and self.engine is not None and isinstance(body, dict)):
            return
        if not url.startswith("/api/change-requests"):
            return
        pairs = _issued(body.get("items", []))
        if not pairs:
            return
        with self.engine.begin() as c:
            for object_type, code in pairs:
                c.execute(
                    text(
                        "INSERT INTO code_reservation "
                        "(object_type, code, request_key, slot, reserved_by) "
                        "SELECT :t, :c, 'test-reserve-' || :c, 0, id "
                        "FROM app_user WHERE username = 'solo' "
                        "ON CONFLICT DO NOTHING"
                    ),
                    {"t": object_type, "c": code},
                )

    def _h(self):
        return {"X-HDIP-User": self.user}

    def get(self, url, **kw):
        return self.client.get(url, headers=self._h(), **kw)

    def post(self, url, json=None, **kw):
        self._issue(url, json)
        return self.client.post(url, json=json, headers=self._h(), **kw)

    def patch(self, url, json=None, **kw):
        return self.client.patch(url, json=json, headers=self._h(), **kw)

    def put(self, url, json=None, **kw):
        self._issue(url, json)
        return self.client.put(url, json=json, headers=self._h(), **kw)

    # 常用流程
    def draft(self, *items, note=None):
        r = self.post("/api/change-requests", {"items": list(items), "note": note})
        assert r.status_code == 200, r.text
        return r.json()

    def submit(self, cid):
        return self.post(f"/api/change-requests/{cid}/submit")

    def cancel(self, cid):
        """撤销草稿：它里面要新建的代码随之不再被占用（同一代码同时只能由一张进行中的申请使用）。"""
        r = self.post(f"/api/change-requests/{cid}/cancel")
        assert r.status_code == 200, r.text
        return r.json()

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

    return Api(TestClient(app), engine=owner_engine)


@pytest.fixture
def client(owner_engine) -> TestClient:
    from hdip_api.main import app

    return TestClient(app)
