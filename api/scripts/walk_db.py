"""重建剧本走查用的独立数据库（原库名加 _walk），并放入走查的起点数据。

在浏览器里走验收剧本会留下真实记录，而业务表没有物理删除，所以走查不在开发库里做。
用法（在项目根目录）：先停掉 make api-walk，再 make walk-db，
然后 make api-walk、make web-walk，打开 http://localhost:5174。

起点数据（经一张申请确认）：主体成都市第三人民医院、本部院区（运行）及其运营关系、
部门心血管内科，都自 2020-01-01 起。默认再加一张申请：高新 / 中心院区（筹建）、呼吸内科
（带下级部门与三个单元）、放射科与核医学科、几个未分类部门、HIS 科室字典的待裁决代码，
供剧本 18–20 与批量操作实测；`--minimal` 只建最小起点（剧本 1–17）。
"""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ProgrammingError

from hdip_api.core.config import Settings, get_settings

base = Settings()
owner = make_url(base.migration_database_url)
app = make_url(base.database_url)
WALK = os.environ.get("HDIP_WALK_DB", f"{owner.database}_walk")  # 另建临时库验证时可改名

if "--url" in sys.argv:  # 供 make api-walk 取应用连接串
    print(app.set(database=WALK).render_as_string(False))
    sys.exit()

admin = create_engine(owner, isolation_level="AUTOCOMMIT")
with admin.connect() as c:
    try:
        c.execute(text(f'DROP DATABASE IF EXISTS "{WALK}" WITH (FORCE)'))
    except ProgrammingError:  # 迁移账号无权断开 hdip_app 的连接
        sys.exit(f"{WALK} 仍有连接（多半是 make api-walk 还开着），请先停掉它再重建。")
    c.execute(text(f'CREATE DATABASE "{WALK}"'))
admin.dispose()

os.environ["HDIP_DATABASE_URL"] = app.set(database=WALK).render_as_string(False)
os.environ["HDIP_MIGRATION_DATABASE_URL"] = owner.set(database=WALK).render_as_string(False)
get_settings.cache_clear()
command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")

from hdip_api.core.db import SessionLocal  # noqa: E402  按走查库建连接
from hdip_api.models import AppUser  # noqa: E402
from hdip_api.schemas.items import ITEMS_ADAPTER  # noqa: E402
from hdip_api.services import codes, workflow  # noqa: E402

# 下面的院区、部门、服务单元代码（BY、XNK、SU-101…）只是脚本里便于阅读的临时代码：
# 写入前按新规则换成系统分配的代码（院区 C + 3 位、部门 D + 6 位、服务单元 SU + 6 位，迁移 0015）。
KNOWN: dict[str, str] = {}

START = [
    {
        "kind": "institution.create",
        "code": "CD3",
        "valid_from": "2020-01-01",
        "fields": {"name": "成都市第三人民医院", "nature": "事业单位法人"},
    },
    {
        "kind": "campus.create",
        "code": "BY",
        "valid_from": "2020-01-01",
        "operating_status": "RUNNING",
        "fields": {"name": "本部院区"},
    },
    {
        "kind": "operator_relation.create",
        "institution_code": "CD3",
        "campus_code": "BY",
        "relation_type": "OPERATE",
        "is_primary": True,
        "valid_from": "2020-01-01",
    },
    {
        "kind": "department.create",
        "code": "XNK",
        "name": "心血管内科",
        "valid_from": "2020-01-01",
        "lifecycle": "ACTIVE",
        "institution_code": "CD3",
    },
]

# ---------------------------------------- 第二批起点数据（默认带上；--minimal 只要上面的最小起点）
# 用于实测：剧本 18–20（部门组织变更）、批量裁决外部代码、批量设置主分类、主体—院区关系图。
# 全部是模拟数据，经一张申请确认。


def _dept(code, name, **kw):
    return {
        "kind": "department.create",
        "code": code,
        "name": name,
        "valid_from": "2020-01-01",
        "lifecycle": "ACTIVE",
        "institution_code": "CD3",
        **kw,
    }


def _unit(code, name, unit_type, dept, campus="BY", valid_from="2020-01-01"):
    return {
        "kind": "service_unit.create",
        "code": code,
        "unit_type": unit_type,
        "valid_from": valid_from,
        "fields": {
            "name": name,
            "department_code": dept,
            "campus_code": campus,
            "institution_code": "CD3",
        },
    }


def _code(code, source_name):
    return {
        "kind": "external_code.register",
        "system_code": "HIS",
        "namespace_code": "DEPT",
        "external_code": code,
        "source_name": source_name,
    }


def _assign(code, **target):
    return {
        "kind": "external_code.assign",
        "system_code": "HIS",
        "namespace_code": "DEPT",
        "external_code": code,
        "valid_from": "2020-01-01",
        "evidence_note": "走查起点数据（模拟）",
        **target,
    }


PLUS = [
    # 关系图：本部运行（流动虚线），高新、中心筹建（实线 + 标签）
    {
        "kind": "campus.create",
        "code": "GX",
        "valid_from": "2026-10-01",
        "operating_status": "PLANNING",
        "fields": {"name": "高新院区"},
    },
    {
        "kind": "operator_relation.create",
        "institution_code": "CD3",
        "campus_code": "GX",
        "relation_type": "OPERATE",
        "is_primary": True,
        "valid_from": "2026-10-01",
    },
    {
        "kind": "campus.create",
        "code": "ZX",
        "valid_from": "2027-12-27",
        "operating_status": "PLANNING",
        "fields": {"name": "中心院区", "public_name": "成都市中心医院"},
    },
    {
        "kind": "operator_relation.create",
        "institution_code": "CD3",
        "campus_code": "ZX",
        "relation_type": "OPERATE",
        "is_primary": True,
        "valid_from": "2027-12-27",
    },
    # 剧本 18 / 19：呼吸内科带一个下级部门、三个单元（含高新院区）、一条 HIS 部门码
    _dept("HXNK", "呼吸内科"),
    _dept("HXJR", "呼吸介入室"),
    {
        "kind": "department.set_parent",
        "code": "HXJR",
        "view_code": "ADMIN",
        "parent_code": "HXNK",
        "effective_date": "2020-01-01",
    },
    {
        "kind": "department.classify",
        "code": "HXNK",
        "scheme_code": "DEPT_MAIN_CLASS",
        "class_code": "CLINICAL",
        "effective_date": "2020-01-01",
    },
    _unit("SU-101", "呼吸内科门诊", "OPD", "HXNK"),
    _unit("SU-102", "呼吸内科病房", "IPD", "HXNK"),
    _unit("SU-201", "呼吸内科高新病房", "IPD", "HXNK", campus="GX", valid_from="2026-11-01"),
    # 剧本 20：核医学科并入放射科；放射科有别名“影像科”
    _dept("FSK", "放射科"),
    _dept("HYX", "核医学科"),
    {
        "kind": "department.alias_add",
        "code": "FSK",
        "alias_kind": "ALIAS",
        "value": "影像科",
        "valid_from": "2020-01-01",
    },
    _unit("SU-301", "核医学检查", "EXAM", "HYX"),
    _unit("XNK-MZ", "心血管内科门诊", "OPD", "XNK"),
    # 批量设置主分类：几个未分类的部门
    _dept("YB", "医院办公室"),
    _dept("CWB", "财务部"),
    _dept("YWB", "医务部"),
    _dept("NFM", "内分泌代谢病科"),
    _dept("XHNK", "消化内科"),
    # 隶属与管理关系图：医务部管理呼吸内科、呼吸内科与心血管内科协作、医院办公室管理高新院区事务
    {
        "kind": "department.relation_create",
        "relation_kind": "PROFESSIONAL_MGMT",
        "from_code": "YWB",
        "to_code": "HXNK",
        "scope": "临床医疗质量",
        "valid_from": "2020-01-01",
    },
    {
        "kind": "department.relation_create",
        "relation_kind": "COLLABORATION",
        "from_code": "HXNK",
        "to_code": "XNK",
        "scope": "心肺联合门诊",
        "valid_from": "2020-01-01",
    },
    {
        "kind": "department.relation_create",
        "relation_kind": "CAMPUS_MGMT",
        "from_code": "YB",
        "campus_code": "GX",
        "scope": "高新院区事务",
        "valid_from": "2026-10-01",
    },
    # 编码映射台账：已解释的两条，其余待裁决（覆盖五档候选与无候选）
    _code("D010", "呼吸内科"),
    _assign("D010", target_type="department", department_code="HXNK"),
    _code("M101", "呼吸内科门诊"),
    _assign("M101", target_type="service_unit", service_unit_code="SU-101"),
    _code("D020", "心血管内科"),
    _code("D030", "影像科"),
    _code("D040", "消化内科专家"),
    _code("D050", "内分泌科专家门诊"),
    _code("D060", "心血管内科门诊专家"),
    _code("H101", "心内科专家1"),
    _code("H102", "心内科专家2"),
    _code("H103", "心内科特需门诊"),
    _code("N501", "五病区护理单元"),
    _code("S901", "收费处"),
]


def _register_his(s, user) -> None:
    """来源系统与字典是配置，维护人直接维护（不经申请）。"""
    from hdip_api.models import CodeNamespace, SourceSystem

    his = SourceSystem(
        code="HIS", name="HIS 本院实例（模拟）", kind="HIS", is_active=True, updated_by=user.id
    )
    s.add(his)
    s.flush()
    s.add(
        CodeNamespace(
            source_system_id=his.id,
            code="DEPT",
            name="科室字典",
            note="混装字典：部门、服务单元、号别、护理单元都在里面，逐条解释",
            is_active=True,
            updated_by=user.id,
        )
    )
    s.flush()


def _apply(s, user, items, note):
    items = codes.issue_for_script(s, user, items, "walk", KNOWN)
    cr = workflow.create_draft(s, user, ITEMS_ADAPTER.validate_python(items), note)
    workflow.submit(s, user, cr.id)
    workflow.confirm(s, user, cr.id)
    return cr.id


with SessionLocal() as s:
    user = s.query(AppUser).filter_by(username="solo").one()
    first = _apply(s, user, START, "剧本走查的起点数据")
    second = None
    if "--minimal" not in sys.argv:
        _register_his(s, user)
        second = _apply(s, user, PLUS, "走查起点数据：组织变更、批量裁决、批量分类、关系图（模拟）")
    s.commit()
suffix = f"、#{second}（组织变更与批量操作）" if second else "；只含最小起点（--minimal）"
print(f"已重建 {WALK}（起点数据：申请 #{first}{suffix}）")
print("代码对照：" + "、".join(f"{k} → {v}" for k, v in KNOWN.items()))
