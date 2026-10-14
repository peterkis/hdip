"""只读导出：按日期、UTF-8 带 BOM、列名稳定。"""

import csv
import io

import pytest
from factories import dept_create, unit_create, world


def _rows(api, dataset, day):
    r = api.get(f"/api/export/{dataset}.csv", params={"as_of": day})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert f"hdip-{dataset}-{day}.csv" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")
    return list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))


@pytest.mark.parametrize(
    "dataset",
    [
        "service-units",
        "departments",
        "campuses",
        "institutions",
        "operator-relations",
        "service-unit-lineage",
    ],
)
def test_every_dataset_exports_with_header(api, dataset):
    r = api.get(f"/api/export/{dataset}.csv", params={"as_of": "2026-11-01"})
    assert r.status_code == 200
    assert r.content.decode("utf-8-sig").split("\r\n")[0]


def test_export_reflects_the_date(api):
    api.apply(*world())
    api.apply(dept_create(), unit_create(code="U1", phone="028-1"))
    campuses = _rows(api, "campuses", "2026-09-30")
    assert [c["campus_code"] for c in campuses] == ["BY"]  # 高新 10-01 才生效
    campuses = _rows(api, "campuses", "2026-11-01")
    gx = next(c for c in campuses if c["campus_code"] == "GX")
    assert gx["primary_operator_code"] == "CD3"
    assert gx["operating_status_name"] == "筹建"

    units = _rows(api, "service-units", "2026-11-01")
    assert units[0]["unit_code"] == "U1"
    assert units[0]["unit_type_name"] == "门诊单元"
    assert units[0]["valid_to"] == ""
    assert _rows(api, "service-units", "2026-10-31") == []

    rels = _rows(api, "operator-relations", "2026-11-01")
    assert {(r["campus_code"], r["is_primary"]) for r in rels} == {("BY", "true"), ("GX", "true")}
    assert _rows(api, "departments", "2026-11-01")[0]["unit_count"] == "1"


def test_export_rejects_unknown_dataset_and_needs_user(api, client):
    assert api.get("/api/export/people.csv").status_code == 422
    assert client.get("/api/export/campuses.csv").status_code == 401
