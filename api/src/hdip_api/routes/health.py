from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from hdip_api.core.db import SessionDep

router = APIRouter(tags=["system"])


class Health(BaseModel):
    status: str
    db_timezone: str
    db_time: datetime  # 不带时区的本地时间


@router.get("/health", response_model=Health, operation_id="getHealth")
def health(session: SessionDep) -> Health:
    tz, now = session.execute(text("SELECT current_setting('TimeZone'), LOCALTIMESTAMP")).one()
    return Health(status="ok", db_timezone=tz, db_time=now)
