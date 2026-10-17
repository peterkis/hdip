"""部门组织变更（剧本 18–20）共用的构造与读取。"""


def reorganize(event_type, day, sources, results, basis="院发〔2026〕12 号（模拟）", **kw):
    """sources / results：代码，或 (代码, 承接范围说明)。"""

    def parts(xs):
        return [
            {"code": x} if isinstance(x, str) else {"code": x[0], "scope_note": x[1]} for x in xs
        ]

    return {
        "kind": "department.reorganize",
        "event_type": event_type,
        "effective_date": day,
        "basis_note": basis,
        "sources": parts(sources),
        "results": parts(results),
        **kw,
    }


def dept(api, code, day):
    rows = api.get("/api/departments", params={"as_of": day}).json()
    return next(r for r in rows if r["code"] == code)


def detail(api, code, day):
    return api.get(f"/api/departments/{dept(api, code, day)['id']}", params={"as_of": day}).json()


def units_of(api, day):
    """单元代码 → (单元 id, 所属部门代码)。"""
    rows = api.get("/api/service-units", params={"as_of": day}).json()
    return {u["code"]: (u["id"], u["version"]["department_code"]) for u in rows}


def problem(resp):
    assert resp.status_code == 422, resp.text
    return resp.json()["message"]
