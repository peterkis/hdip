"""人员剧本（PERS-xx）共用的读取。"""

from datetime import date, timedelta


def today() -> date:
    return date.today()


def days(n: int) -> str:
    """今天起 n 天后的日期（结束日“到达前可改”等规则与今天有关，测试按今天推算）。"""
    return (date.today() + timedelta(days=n)).isoformat()


def roster(api, day=None, **params):
    if day:
        params["as_of"] = day
    r = api.get("/api/persons", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def person(api, code, day=None):
    row = next(p for p in roster(api, day, scope="all") if p["code"] == code)
    params = {"as_of": day} if day else {}
    return api.get(f"/api/persons/{row['id']}", params=params).json()


def assignment_ids(detail):
    """详情里全部未撤销的归属：(id, 部门代码, 开始日, 结束日)。"""
    return [
        (a["id"], a["department"]["code"], a["valid_from"], a["valid_to"])
        for e in detail["engagements"]
        for a in e["assignments"]
        if not a["void"]
    ]
