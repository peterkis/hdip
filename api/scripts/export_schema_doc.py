"""从当前数据库生成表结构参考文档 docs/database/schema-reference.md。

内容全部读自 PostgreSQL 系统目录（列、约束、索引、触发器、函数、应用账号权限、配置表种子），
所以文档与迁移不会走样。迁移之后执行 make db-doc
（或在 api/ 下 uv run python scripts/export_schema_doc.py）。
叙述性的设计说明在 docs/database/README.md，手写维护。
"""

from pathlib import Path

from sqlalchemy import create_engine, text

from hdip_api.core.config import get_settings

OUT = Path(__file__).resolve().parents[2] / "docs" / "database" / "schema-reference.md"

# 表的一句话说明与分组（新增表时在这里补一行；未登记的表会列在“其他”里）
TABLES: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "配置与用户",
        [
            ("app_user", "开发期用户与角色（认证方案确定后只换来源，保留本表作本地映射）"),
            ("option_item", "选项（院区节点角色、服务单元类型等）的码值与中文名"),
            ("approval_rule", "确认规则：对象类型 × 动作 → 确认角色、是否允许自确认"),
        ],
    ),
    (
        "变更申请",
        [("change_request", "唯一写入入口：一张申请含多个变更项，确认时在一个事务里全部应用")],
    ),
    (
        "主体与院区",
        [
            ("institution", "主体身份（id、code 永久）"),
            ("institution_version", "主体属性版本"),
            ("campus", "院区身份"),
            ("campus_version", "院区属性版本（含运营状态）"),
            ("operator_relation", "主体—院区关系，每行自带期间，端点不可改"),
        ],
    ),
    (
        "部门与服务单元",
        [
            ("department", "部门（当前无版本表；见 README 第 6 节的深化计划）"),
            ("service_unit", "服务单元身份（单元类型属于身份，不可修订）"),
            ("service_unit_version", "服务单元版本：部门 × 院区 × 运营主体 × 期间"),
            ("service_unit_lineage", "拆分 / 合并的前身 → 后继，只追加"),
        ],
    ),
]

SKIP = {"alembic_version"}


def md_escape(v: object) -> str:
    return str(v).replace("|", "\\|").replace("\n", " ")


def main() -> None:
    settings = get_settings()
    engine = create_engine(settings.migration_database_url)
    lines: list[str] = []
    w = lines.append
    with engine.connect() as c:
        revision = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
        all_tables = [
            r[0]
            for r in c.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
                )
            )
            if r[0] not in SKIP
        ]
        known = {t for _, ts in TABLES for t, _ in ts}
        groups = [*TABLES]
        others = [(t, "") for t in all_tables if t not in known]
        if others:
            groups.append(("其他（未登记说明）", others))

        w("# 数据库表结构参考")
        w("")
        w(f"> 由 `api/scripts/export_schema_doc.py` 从数据库生成，迁移版本 **{revision}**。")
        w("> 不要手改；改迁移后执行 `make db-doc`。设计说明见 [README.md](README.md)。")
        w("")
        w("## 目录")
        w("")
        for title, ts in groups:
            w(f"- **{title}**：" + "、".join(f"[`{t}`](#{t})" for t, _ in ts))
        w("- [触发器函数](#触发器函数)、[应用账号权限](#应用账号权限)、[配置表种子](#配置表种子)")
        w("")

        for title, ts in groups:
            w(f"## {title}")
            w("")
            for table, desc in ts:
                if table not in all_tables:
                    continue
                write_table(c, w, table, desc)

        write_functions(c, w)
        write_grants(c, w)
        write_seeds(c, w)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


def write_table(c, w, table: str, desc: str) -> None:
    w(f"### {table}")
    w("")
    if desc:
        w(desc)
        w("")
    cols = c.execute(
        text(
            """
            SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                   pg_get_expr(d.adbin, d.adrelid), a.attidentity
            FROM pg_attribute a
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = CAST(:t AS regclass) AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum
            """
        ),
        {"t": table},
    ).all()
    fks = {
        r[0]: r[1]
        for r in c.execute(
            text(
                """
                SELECT a.attname, confrelid::regclass::text
                FROM pg_constraint k
                JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                WHERE k.conrelid = CAST(:t AS regclass) AND k.contype = 'f'
                  AND array_length(k.conkey, 1) = 1
                """
            ),
            {"t": table},
        )
    }
    w("| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |")
    w("| --- | --- | --- | --- | --- |")
    for name, typ, notnull, default, identity in cols:
        gen = "IDENTITY" if identity else (default or "")
        w(
            f"| `{name}` | {typ} | {'是' if notnull else ''} | {md_escape(gen)} | "
            f"{('→ `' + fks[name] + '`') if name in fks else ''} |"
        )
    w("")
    cons = c.execute(
        text(
            """
            SELECT conname, contype, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = CAST(:t AS regclass) AND contype IN ('p', 'u', 'c', 'x', 'f')
            ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2
                                  WHEN 'c' THEN 3 ELSE 4 END, conname
            """
        ),
        {"t": table},
    ).all()
    kinds = {"p": "主键", "u": "唯一", "x": "排他", "c": "检查", "f": "外键"}
    shown = [r for r in cons if r[1] != "f"]
    if shown:
        w("约束：")
        w("")
        for name, kind, definition in shown:
            w(f"- `{name}`（{kinds[kind]}）：`{md_escape(definition)}`")
        w("")
    idx = c.execute(
        text(
            """
            SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = :t
              AND indexname NOT IN (SELECT conname FROM pg_constraint)
            ORDER BY 1
            """
        ),
        {"t": table},
    ).all()
    if idx:
        w("索引：")
        w("")
        for name, definition in idx:
            w(f"- `{name}`：`{md_escape(definition)}`")
        w("")
    trg = c.execute(
        text(
            """
            SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
            WHERE tgrelid = CAST(:t AS regclass) AND NOT tgisinternal ORDER BY 1
            """
        ),
        {"t": table},
    ).all()
    if trg:
        w("触发器：")
        w("")
        for name, definition in trg:
            w(f"- `{name}`：`{md_escape(definition)}`")
        w("")


def write_functions(c, w) -> None:
    w("## 触发器函数")
    w("")
    for name, body in c.execute(
        text(
            """
            SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'hdip\\_%' ORDER BY 1
            """
        )
    ):
        w(f"### {name}")
        w("")
        w("```sql")
        w(body.strip())
        w("```")
        w("")


def write_grants(c, w) -> None:
    w("## 应用账号权限")
    w("")
    w("应用以 `hdip_app` 连接；它没有 DELETE 权限，从权限上保证业务表无物理删除。")
    w("")
    w("| 表 | 权限 |")
    w("| --- | --- |")
    for table, privs in c.execute(
        text(
            """
            SELECT table_name, string_agg(privilege_type, '、' ORDER BY privilege_type)
            FROM information_schema.role_table_grants
            WHERE grantee = 'hdip_app' AND table_schema = 'public'
            GROUP BY table_name ORDER BY 1
            """
        )
    ):
        w(f"| `{table}` | {privs} |")
    w("")


def write_seeds(c, w) -> None:
    w("## 配置表种子")
    w("")
    w("### option_item")
    w("")
    w("| 类别 | 代码 | 名称 | 排序 | 启用 |")
    w("| --- | --- | --- | --- | --- |")
    for row in c.execute(
        text("SELECT category, code, name, sort_order, is_active FROM option_item ORDER BY 1, 4")
    ):
        w(f"| {row[0]} | `{row[1]}` | {row[2]} | {row[3]} | {'是' if row[4] else '否'} |")
    w("")
    w("### approval_rule")
    w("")
    w("| 对象类型 | 动作 | 确认角色 | 允许自确认 |")
    w("| --- | --- | --- | --- |")
    for row in c.execute(
        text(
            "SELECT object_type, action, confirmer_role, allow_self_confirm "
            "FROM approval_rule ORDER BY 1, 2"
        )
    ):
        w(f"| {row[0]} | {row[1]} | {row[2]} | {'是' if row[3] else '否'} |")
    w("")
    w("### app_user")
    w("")
    w("| 用户名 | 显示名 | 角色 |")
    w("| --- | --- | --- |")
    for row in c.execute(text("SELECT username, display_name, roles FROM app_user ORDER BY id")):
        w(f"| {row[0]} | {row[1]} | {'、'.join(row[2])} |")
    w("")


if __name__ == "__main__":
    main()
