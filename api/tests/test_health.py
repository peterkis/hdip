from datetime import datetime

from hdip_api.core.config import get_settings


def test_health_returns_naive_local_time(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # 会话时区由 HDIP_TIMEZONE 固定，与数据库主机时区无关。
    assert body["db_timezone"] == get_settings().timezone
    # 审计时间一律不带时区：不应出现 Z 或 +08:00 之类的偏移。
    assert datetime.fromisoformat(body["db_time"]).tzinfo is None
