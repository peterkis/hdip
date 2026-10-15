"""剧本 11：调整部门主分类：旧赋值保留在历史中；同一时点只有一个主类。"""

from factories import classify, dept_create


def _main(api, day):
    rows = api.get("/api/departments", params={"as_of": day}).json()
    return {r["code"]: (r["main_class"] or {}).get("code") for r in rows}


def test_script11_reclassify_keeps_history_and_one_main_class(api):
    api.apply(
        dept_create(),
        dept_create(code="YWB", name="医务部"),
        dept_create(code="JYK", name="检验科"),
        dept_create(code="KJB", name="科教部"),
        dept_create(code="XXZX", name="信息中心"),
        dept_create(code="YXB", name="药学部"),
    )
    # 首次分类：Peter 给出的示例
    api.apply(
        classify("XNK", "CLINICAL", "2026-01-01"),
        classify("YWB", "ADMIN", "2026-01-01"),
        classify("JYK", "MEDTECH", "2026-01-01"),
        classify("KJB", "RESEARCH_EDU", "2026-01-01"),
        classify("XXZX", "MEDTECH", "2026-01-01"),  # 先误分为医疗技术类
        classify("YXB", "SUPPORT", "2026-01-01"),
    )
    # 更正：信息中心不能因服务临床就算医技，改为运行保障类
    done = api.apply(classify("XXZX", "OPERATIONS", "2026-06-01"))
    out = done["outcomes"][0]
    assert (out["before"]["class_code"], out["after"]["class_code"]) == ("MEDTECH", "OPERATIONS")

    assert _main(api, "2025-12-31")["XXZX"] is None
    assert _main(api, "2026-03-01")["XXZX"] == "MEDTECH"
    assert _main(api, "2026-06-01")["XXZX"] == "OPERATIONS"

    xx = next(r for r in api.get("/api/departments").json() if r["code"] == "XXZX")
    hist = api.get(f"/api/departments/{xx['id']}").json()["classifications"]
    assert [(c["code"], c["valid_from"], c["valid_to"]) for c in hist] == [
        ("OPERATIONS", "2026-06-01", None),
        ("MEDTECH", "2026-01-01", "2026-05-31"),
    ]
    # 按主分类计数，每个部门只计一次
    counts: dict[str, int] = {}
    for code in _main(api, "2026-06-01").values():
        counts[code] = counts.get(code, 0) + 1
    assert sum(counts.values()) == 6
    assert counts["OPERATIONS"] == 1 and "MEDTECH" in counts
