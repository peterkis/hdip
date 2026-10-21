"""PERS-02（登记部分）：登记下月入职的人——今天名册人数不变，切到入职日可见；计划中的人在“含计划”里标出。

撤销计划（“生效前已撤销”）属于 P1.3，见 test_pers02_cancel（待实施）。
"""

from factories import dept_create, register, world
from person_helpers import days, roster


def test_pers02_future_joiner(api):
    api.apply(*world(), dept_create())
    api.apply(*register("P000001", "张伟", "XNK", "2020-01-01"))
    start = days(30)
    api.apply(*register("P000002", "赵敏", "XNK", start))

    assert [r["code"] for r in roster(api)] == ["P000001"]
    planned = {r["code"]: r for r in roster(api, include_future=True)}
    assert planned["P000002"]["status"] == "PLANNED"
    assert planned["P000002"]["engagements"][0]["not_yet_effective"] is True
    assert {r["code"] for r in roster(api, status="PLANNED")} == {"P000002"}

    on_start = {r["code"]: r["status"] for r in roster(api, start)}
    assert on_start == {"P000001": "ENGAGED", "P000002": "ENGAGED"}

    # 部门“人员”区块与名册同口径：今天 1 人，入职日 2 人
    dept_id = api.get("/api/departments").json()[0]["id"]
    now = api.get(f"/api/departments/{dept_id}/persons").json()
    later = api.get(f"/api/departments/{dept_id}/persons", params={"as_of": start}).json()
    assert [p["person_code"] for p in now] == ["P000001"]
    assert sorted(p["person_code"] for p in later) == ["P000001", "P000002"]
