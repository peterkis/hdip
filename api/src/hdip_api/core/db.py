from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from hdip_api.core.config import get_settings


class Base(DeclarativeBase):
    """ORM 基类。表结构以 migrations/ 中手写的迁移为准，模型只用于读写映射。"""


def make_engine(database_url: str | None = None, timezone: str | None = None) -> Engine:
    settings = get_settings()
    return create_engine(
        database_url or settings.database_url,
        # 连接时固定会话时区，避免数据库主机设成 UTC 时 LOCALTIMESTAMP 写错。
        connect_args={"options": f"-c timezone={timezone or settings.timezone}"},
        pool_pre_ping=True,
    )


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
