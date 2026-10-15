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
        "fields": {"name": name, "node_role": "HIGH_TECH", **fields},
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
    """本院 + 高新两个院区，都由成都市第三人民医院主要运营。"""
    return [
        inst_create(),
        campus_create(code="BY", name="本院院区", valid_from="2020-01-01", status="RUNNING"),
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
