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
