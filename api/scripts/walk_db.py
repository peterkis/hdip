"""重建剧本走查用的独立数据库（原库名加 _walk），并放入走查的起点数据。

在浏览器里走验收剧本会留下真实记录，而业务表没有物理删除，所以走查不在开发库里做。
用法：make walk-db，然后 make api-walk、make web-walk，打开 http://localhost:5174。

起点数据（经一张申请确认）：主体成都市第三人民医院、本部院区（运行）及其运营关系、
部门心血管内科，都自 2020-01-01 起。其余全部在页面上按剧本操作。
"""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from hdip_api.core.config import Settings, get_settings

base = Settings()
owner = make_url(base.migration_database_url)
app = make_url(base.database_url)
WALK = f"{owner.database}_walk"

if "--url" in sys.argv:  # 供 make api-walk 取应用连接串
    print(app.set(database=WALK).render_as_string(False))
    sys.exit()

admin = create_engine(owner, isolation_level="AUTOCOMMIT")
with admin.connect() as c:
    c.execute(text(f'DROP DATABASE IF EXISTS "{WALK}" WITH (FORCE)'))
    c.execute(text(f'CREATE DATABASE "{WALK}"'))
admin.dispose()

os.environ["HDIP_DATABASE_URL"] = app.set(database=WALK).render_as_string(False)
os.environ["HDIP_MIGRATION_DATABASE_URL"] = owner.set(database=WALK).render_as_string(False)
get_settings.cache_clear()
command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")

from hdip_api.core.db import SessionLocal  # noqa: E402  按走查库建连接
from hdip_api.models import AppUser  # noqa: E402
from hdip_api.schemas.items import ITEMS_ADAPTER  # noqa: E402
from hdip_api.services import workflow  # noqa: E402

START = [
    {
        "kind": "institution.create",
        "code": "CD3",
        "valid_from": "2020-01-01",
        "fields": {"name": "成都市第三人民医院", "nature": "事业单位法人"},
    },
    {
        "kind": "campus.create",
        "code": "BY",
        "valid_from": "2020-01-01",
        "operating_status": "RUNNING",
        "fields": {"name": "本部院区", "node_role": "HEADQUARTERS"},
    },
    {
        "kind": "operator_relation.create",
        "institution_code": "CD3",
        "campus_code": "BY",
        "relation_type": "OPERATE",
        "is_primary": True,
        "valid_from": "2020-01-01",
    },
    {
        "kind": "department.create",
        "code": "XNK",
        "name": "心血管内科",
        "valid_from": "2020-01-01",
        "lifecycle": "ACTIVE",
        "institution_code": "CD3",
    },
]

with SessionLocal() as s:
    user = s.query(AppUser).filter_by(username="solo").one()
    cr = workflow.create_draft(s, user, ITEMS_ADAPTER.validate_python(START), "剧本走查的起点数据")
    workflow.submit(s, user, cr.id)
    workflow.confirm(s, user, cr.id)
    s.commit()
print(f"已重建 {WALK}（起点数据：申请 #{cr.id}）")
