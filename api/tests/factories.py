"""测试用的变更项。"""


def inst_create(code="CD3", name="成都市第三人民医院", valid_from="2020-01-01", **fields):
    return {
        "kind": "institution.create",
        "code": code,
        "valid_from": valid_from,
        "fields": {"name": name, "nature": "事业单位法人", **fields},
    }


def campus_create(code="GX", name="高新院区", valid_from="2026-10-01", status=None, **fields):
    item = {
        "kind": "campus.create",
        "code": code,
        "valid_from": valid_from,
        "fields": {"name": name, **fields},
    }
    if status:
        item["operating_status"] = status
    return item


def relation_create(
    inst="CD3", campus="GX", type_="OPERATE", primary=True, valid_from="2026-10-01", valid_to=None
):
    return {
        "kind": "operator_relation.create",
        "institution_code": inst,
        "campus_code": campus,
        "relation_type": type_,
        "is_primary": primary,
        "valid_from": valid_from,
        "valid_to": valid_to,
    }


def change_status(code="GX", status="TRIAL_RUNNING", effective_date="2026-11-01"):
    return {
        "kind": "campus.change_status",
        "code": code,
        "effective_date": effective_date,
        "operating_status": status,
    }


def dept_create(code="XNK", name="心血管内科", valid_from="2020-01-01", **fields):
    return {
        "kind": "department.create",
        "code": code,
        "name": name,
        "valid_from": valid_from,
        **fields,
    }


def unit_create(
    code="XNK-GX-OPD",
    name="心内科高新门诊",
    unit_type="OPD",
    dept="XNK",
    campus="GX",
    inst="CD3",
    valid_from="2026-11-01",
    **fields,
):
    return {
        "kind": "service_unit.create",
        "code": code,
        "unit_type": unit_type,
        "valid_from": valid_from,
        "fields": {
            "name": name,
            "department_code": dept,
            "campus_code": campus,
            "institution_code": inst,
            **fields,
        },
    }


def unit_item(kind, code, effective_date, **kw):
    return {"kind": f"service_unit.{kind}", "code": code, "effective_date": effective_date, **kw}


def world():
    """本部 + 高新两个院区，都由成都市第三人民医院主要运营。"""
    return [
        inst_create(),
        campus_create(code="BY", name="本部院区", valid_from="2020-01-01", status="RUNNING"),
        relation_create(campus="BY", valid_from="2020-01-01"),
        campus_create(code="GX", name="高新院区", valid_from="2026-10-01"),
        relation_create(campus="GX", valid_from="2026-10-01"),
    ]


def successor(code, name, unit_type="OPD", dept="XNK", campus="GX", inst="CD3"):
    return {
        "code": code,
        "unit_type": unit_type,
        "fields": {
            "name": name,
            "department_code": dept,
            "campus_code": campus,
            "institution_code": inst,
        },
    }


def split(code, effective_date, *successors):
    return {
        "kind": "service_unit.split",
        "code": code,
        "effective_date": effective_date,
        "successors": list(successors),
    }


def merge(codes, effective_date, successor_spec):
    return {
        "kind": "service_unit.merge",
        "codes": list(codes),
        "effective_date": effective_date,
        "successor": successor_spec,
    }


def dept_item(kind, code="XNK", **kw):
    return {"kind": f"department.{kind}", "code": code, **kw}


def classify(code, class_code, day, scheme="DEPT_MAIN_CLASS"):
    return dept_item(
        "classify", code, scheme_code=scheme, class_code=class_code, effective_date=day
    )


def set_parent(code, parent, day, view="ADMIN"):
    return dept_item("set_parent", code, view_code=view, parent_code=parent, effective_date=day)


def dept_relation(kind, frm, scope, day="2026-01-01", to=None, campus=None, valid_to=None):
    return {
        "kind": "department.relation_create",
        "relation_kind": kind,
        "from_code": frm,
        "to_code": to,
        "campus_code": campus,
        "scope": scope,
        "valid_from": day,
        "valid_to": valid_to,
    }


# ------------------------------------------------------------------ 外部标识与分类关联（D3）
def setup_ledger(api, system="HIS", namespace="DEPT", name="科室字典"):
    """登记来源系统与字典（配置，维护人直接维护）。"""
    r = api.as_("maintainer").post(
        "/api/dictionary/source-systems",
        {"code": system, "name": f"{system} 本院实例", "kind": "HIS"},
    )
    assert r.status_code == 200, r.text
    r = api.as_("maintainer").post(
        f"/api/dictionary/source-systems/{r.json()['id']}/namespaces",
        {"code": namespace, "name": name},
    )
    assert r.status_code == 200, r.text
    return next(n for n in r.json()["namespaces"] if n["code"] == namespace)


def ext_register(code, source_name=None, system="HIS", namespace="DEPT", **kw):
    return {
        "kind": "external_code.register",
        "system_code": system,
        "namespace_code": namespace,
        "external_code": code,
        "source_name": source_name,
        **kw,
    }


def ext_assign(code, valid_from="2026-01-01", system="HIS", namespace="DEPT", **kw):
    """kw: department_code= / service_unit_code= / unmodeled_type=，以及 campus_code、valid_to。"""
    target_type = (
        "department"
        if "department_code" in kw
        else "service_unit"
        if "service_unit_code" in kw
        else "unmodeled"
    )
    return {
        "kind": "external_code.assign",
        "system_code": system,
        "namespace_code": namespace,
        "external_code": code,
        "target_type": target_type,
        "valid_from": valid_from,
        **kw,
    }


def ext_close(assignment_id, valid_to):
    return {
        "kind": "external_code.assignment_close",
        "assignment_id": assignment_id,
        "valid_to": valid_to,
    }


def unit_classify(code, scheme, class_code, day):
    return unit_item("classify", code, day, scheme_code=scheme, class_code=class_code)


def ledger(api, as_of=None, **params):
    """台账行：代码 → (状态, [解释指向的对象代码或未建模类型])。"""
    if as_of:
        params["as_of"] = as_of
    page = api.get("/api/external-codes", params=params).json()
    return {
        r["code"]: (
            r["status"],
            [
                (a["department"] or a["service_unit"] or {}).get("code") or a["unmodeled_type"]
                for a in r["current"]
            ],
        )
        for r in page["rows"]
    }


# ------------------------------------------------------------------ 人员（迁移 0016）
def person_create(code="P000001", name="张伟", valid_from="2020-01-01", **fields):
    return {"kind": "person.create", "code": code, "name": name, "valid_from": valid_from, **fields}


def engage(
    person="P000001",
    dept="XNK",
    valid_from="2020-01-01",
    inst="CD3",
    type_="CONTRACT",
    valid_to=None,
    work_no=None,
):
    item = {
        "kind": "person.engage",
        "person_code": person,
        "institution_code": inst,
        "engagement_type": type_,
        "valid_from": valid_from,
        "department_code": dept,
    }
    if valid_to:
        item["valid_to"] = valid_to
    if work_no:
        item["work_no"] = work_no
    return item


def register(code="P000001", name="张伟", dept="XNK", valid_from="2020-01-01", **kw):
    """登记向导生成的两项：人员 + 任用与主归属（同一开始日）。"""
    return [person_create(code, name, valid_from), engage(code, dept, valid_from, **kw)]


def transfer(assignment_id, dept, day, expected=None):
    return {
        "kind": "person.transfer",
        "assignment_id": assignment_id,
        "expected_valid_to": expected,
        "department_code": dept,
        "effective_date": day,
    }


def assignment_end(assignment_id, valid_to, expected=None):
    return {
        "kind": "person.assignment_set_end",
        "assignment_id": assignment_id,
        "expected_valid_to": expected,
        "valid_to": valid_to,
    }


def person_revise(code, name, day, reason="RENAME", **kw):
    return {
        "kind": "person.revise",
        "code": code,
        "reason": reason,
        "effective_date": day,
        "name": name,
        **kw,
    }


def change_work_no(engagement_id, expected, new, day, reason="CHANGE"):
    return {
        "kind": "person.change_work_no",
        "engagement_id": engagement_id,
        "expected_work_no": expected,
        "reason": reason,
        "work_no": new,
        "effective_date": day,
    }


def assign(engagement_id, dept, valid_from, valid_to=None):
    item = {
        "kind": "person.assign",
        "engagement_id": engagement_id,
        "department_code": dept,
        "valid_from": valid_from,
    }
    if valid_to:
        item["valid_to"] = valid_to
    return item
