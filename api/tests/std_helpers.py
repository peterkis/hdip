"""标准资料库测试用的小资料包：与主题 01 包同样的成员路径与记录结构，只放几条记录。"""

import json
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from hdip_api.services.standards_import import import_package

DE_MEMBER = "p001/files/enhanced-current-official-data-elements.json"
CV_TABLES = "p002/files/data/tables.json"
CV_ROWS = "p002/files/data/rows.json"
URL_363 = "https://www.nhc.gov.cn/example/363.3.pdf"
URL_364 = "https://www.nhc.gov.cn/example/364.3.pdf"

CODES = [
    ("01", "居民身份证"),
    ("02", "居民户口簿"),
    ("03", "护照"),
    ("04", "军官证"),
    ("05", "驾驶证"),
    ("06", "港澳居民来往内地通行证"),
    ("07", "台湾居民来往大陆通行证"),
    ("08", "临时居民身份证"),
    ("09", "武装警察身份证件"),
    ("10", "中华人民共和国港澳居民居住证"),
    ("11", "中华人民共和国台湾居民居住证"),
    ("12", "社会保障卡"),
    ("99", "其他法定有效证件"),
]


def de(ident: str, name: str, allowed: str, std: str = "WS/T 363.3—2023", pages=(15, 16)) -> dict:
    cells = {
        "数据元标识符": ident,
        "数据元名称": name,
        "定义": f"{name}的定义",
        "数据元值的数据类型": "S3",
        "表示格式": "N2",
        "数据元允许值": allowed,
    }
    return {
        "standard": std,
        "part": "3",
        "raw_cells": cells,
        "normalized": cells,
        "source_pdf_pages": list(pages),
        "source_printed_pages": [str(p - 3) for p in pages],
        "source_section": "4.2 数据元专用属性",
        "qa_status": "official_body_and_index_image_reviewed",
        "source_version": "official_current_20261006",
        "source_sha256": "be" * 32,
        "source_url": URL_363,
        "source_pdf": "official-source-crosscheck/official-WST363.3-2023.pdf",
        "qa_evidence": {"image_paths": ["audit/part-03/pdf-015.png"]},
        "source_issues": [],
        "automatic_import_gate": "ready_at_source_schema_level",
        "data_element_version": "V1.1",
    }


def table(cv: str = "CV02.01.101", name: str = "身份证件类别代码表") -> dict:
    return {
        "cv_id": cv,
        "table_name": name,
        "standard_part": "WS/T 364.3—2023",
        "part": 3,
        "source_physical_page": 3,
        "source_printed_page": "1",
        "definition_and_structure_raw": "4.1.1 身份证件类别代码\n采用2位数字顺序代码。见表1。",
        "qa_status": "field_matched_or_rechecked",
        "definition": "身份证件类别代码规定了公民个人身份证件的代码。",
        "structure": "采用2位数字顺序代码。见表1。",
        "source_sha256": "9f" * 32,
        "source_url": URL_364,
        "qa_note": "",
    }


def row(cv: str, code: str, name: str, n: int) -> dict:
    return {
        "cv_id": cv,
        "table_name": "身份证件类别代码表",
        "standard_part": "WS/T 364.3—2023",
        "part": 3,
        "source_physical_page": 3,
        "source_printed_page": "1",
        "code": code,
        "name": name,
        "description": "",
        "raw_cells": [code, name],
        "source_fragment": 1,
        "source_row": n + 2,
        "hierarchy_level": 1,
        "parent_code": "",
        "source_url": URL_364,
        "source_physical_pages": [3],
        "source_printed_pages": ["1"],
        "source_path": "recovery/WST364.3-2023-official.pdf",
        "source_image": "recovery/source-images/364.3-3.png",
        "qa_note": "",
        "row_id": f"official:364.3:{cv}:3:1:{n + 2}",
    }


def default_records() -> tuple[list, list, list]:
    des = [
        de("DE02.01.031.00", "身份证件类别代码", "WS/T 364.3 CV02.01.101 身份证件类别代码表"),
        # 原文写明年份、本库只收录 2023：不能跳到 2023
        de("DE99.00.001.00", "旧版证件类别", "WS/T 364.3—2011 CV02.01.101 身份证件类别代码表"),
        de("DE02.01.039.00", "城乡类型", "1.城市2.农村"),
        de("DE02.01.017.00", "国籍代码", "GB/T 2659 世界各国和地区名称代码"),
    ]
    tables = [table(), table("CV02.01.102", "出生地点类别代码表")]
    rows = [row("CV02.01.101", c, n, i) for i, (c, n) in enumerate(CODES)]
    rows.append(row("CV02.01.102", "1", "医院", 0))
    return des, tables, rows


def build_zip(dirpath: Path, des=None, tables=None, rows=None, name="theme01-test.zip") -> Path:
    d_des, d_tables, d_rows = default_records()
    path = dirpath / "packages" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(DE_MEMBER, json.dumps(des if des is not None else d_des, ensure_ascii=False))
        zf.writestr(CV_TABLES, json.dumps(tables if tables is not None else d_tables))
        zf.writestr(CV_ROWS, json.dumps(rows if rows is not None else d_rows, ensure_ascii=False))
    return path


def run_import(engine, zip_path: Path, select_ids=None, **kw):
    with Session(engine) as session, session.begin():
        return import_package(
            session, zip_path, zip_path.parents[1], "ws363-364", select_ids=select_ids, **kw
        )
