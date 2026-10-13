from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量或仓库根目录的 .env 读取，变量统一以 HDIP_ 开头。"""

    model_config = SettingsConfigDict(
        env_prefix="HDIP_",
        env_file=("../.env", ".env"),
        extra="ignore",
    )

    # 应用运行账号，无 DELETE 权限；迁移用 HDIP_MIGRATION_DATABASE_URL（见 migrations/env.py）。
    database_url: str = "postgresql+psycopg://hdip_app:hdip_app@localhost:5432/hdip"
    migration_database_url: str = "postgresql+psycopg://hdip_owner:hdip_owner@localhost:5432/hdip"
    # 只决定数据库会话里“现在是几点”（LOCALTIMESTAMP），存储的值仍不带时区。
    timezone: str = "Asia/Shanghai"
    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
