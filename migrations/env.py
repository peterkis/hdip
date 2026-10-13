"""Alembic 环境。

迁移用表的属主账号（HDIP_MIGRATION_DATABASE_URL）执行；应用运行时用的账号
（HDIP_DATABASE_URL）没有 DELETE 权限，见 db/init/01-roles.sql。
约束、排他约束与索引在迁移里手写 SQL，不依赖 autogenerate。
"""

from alembic import context
from sqlalchemy import engine_from_config, pool

from hdip_api.core.config import get_settings

config = context.config
settings = get_settings()
url = settings.migration_database_url
config.set_main_option("sqlalchemy.url", url)

target_metadata = None


def run_migrations_offline() -> None:
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"options": f"-c timezone={settings.timezone}"},
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
