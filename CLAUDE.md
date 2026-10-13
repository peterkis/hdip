# CLAUDE.md

HDIP（Hospital Data Intelligence Platform）轻量 MVP：成都市第三人民医院“一院两区一中心”的主数据维护，首版只做**主体、院区、主体—院区运营关系、部门（仅引用）、服务单元**的维护与按日期查询。

**设计依据**：`docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md`（下称“设计文档”）。本文件只摘出写代码时不能违反的规则；两者冲突时以设计文档为准，并提醒维护者同步本文件。

## 工作方式

- **剧本驱动**：设计文档第 7 节的 8 条验收剧本是唯一的完成标准。新增对象、表、字段的唯一理由，是某条剧本因缺它而失败。不要“顺手”加范围外的东西（见下方“范围外”）。
- **按实施顺序推进**（设计文档第 9 节）：① 院区 + 主体 + 运营关系 + 变更申请流 → ② 部门引用 + 服务单元基础动作 → ③ 拆分、合并、按日期查询、只读导出。每一步结束都要是能用的闭环。
- 剧本走不通时用三分法定位：事实有分歧 → 找责任人定；系统表达不了 → 改模型；操作不顺 → 改页面。
- 业务尚不明确、随时可能调整：优先小而可改的实现，不做提前抽象。

## 三条硬约束（做错无法补救）

1. **身份与代码**：id 永不复用；code 全局唯一且永久绑定，对象退出后也不释放、不复用。
2. **不覆盖历史**：任何改动都产生新版本行，旧版本保留；业务表**无物理删除**（应用账号 `hdip_app` 没有 DELETE 权限，迁移里也不要写依赖删除的逻辑）。
3. **语义边界**：院区 ≠ 法人；服务单元 = 部门 × 院区 × 运营主体 × 期间，≠ 病区/护理单元/地点。服务方向、接诊形式、换房间都**不**产生新单元。

## 日期与时间

- 业务有效期只用 `date`，**闭区间，起止都含当日**；`valid_to` 为空 = 长期有效。修订在 D 生效：旧版 `valid_to = D-1`，新版 `valid_from = D`。允许未来生效日。
- 数据库区间表达：`daterange(valid_from, valid_to, '[]')`，同一对象的版本期间不重叠用 `EXCLUDE USING gist (... WITH =, daterange(...) WITH &&)`（已启用 `btree_gist`）。
- 审计时间用 `timestamp without time zone`，**禁止 `timestamptz`**；写入取数据库 `LOCALTIMESTAMP`。连接时会话时区固定为 `HDIP_TIMEZONE`（默认 Asia/Shanghai），见 `api/src/hdip_api/core/db.py`。
- 接口：日期 `YYYY-MM-DD`；时间戳为不带偏移的 ISO 字符串（`2026-10-13T09:30:00`）。前后端都不做时区转换，原样显示。Python 侧只用 naive `datetime`。

## 写入只经变更申请

- 状态：草稿 → 已提交 → 已确认（生效）/ 已退回。提交与确认是两次独立动作，各自记录人和时间。
- 一张申请可含多项变更，确认时在**一个事务**里全部应用，失败整体回滚（拆分、合并、“新建部门 + 新建服务单元”都靠它）。
- 不提供“创建即生效”的捷径，**初始导入也是一张批量申请**，确认一次。
- 同一人可提交并确认（`HDIP_ALLOW_SELF_CONFIRM`，默认开），但确认这一步不能省。
- 确认时重新校验，校验不过不能确认；退回必须写原因。确认页展示前后差异。
- API 只暴露“创建/提交/确认/退回申请”和只读查询，**不提供业务表的直接增改接口**。
- 前后内容存 JSONB。确认规则（谁能确认哪类变更）按对象类型 × 动作配置在 `approval_rule`，改规则不改代码。

## 领域规则速查

- 统一称**“部门”**，不用“科室”。服务单元必须挂所属部门；单元只引用部门 id，不复制部门名称。
- 部门 MVP 无版本表，改动记录在变更申请里（为将来补版本表回填）；状态预留“弃用”“被替代”。
- 运营关系：每行自带期间，端点（主体、院区）不可改；调整 = 关闭旧行 + 新建行。同一院区在重叠期间最多一个主要运营方，且只有“运营”类型可为主要运营方。
- 服务单元每个版本须满足：所属部门在用；院区非停用；运营主体与该院区有覆盖整个单元期间的“运营”关系。
- 单元类型码沿用 `OPD/IPD/ED/EXAM/LAB/PHARMACY/OR/OTHER`，**不新增、不重释码值**；类型不允许修订（职责变化走拆分或新建）。
- 关闭运营关系或停用院区时，若仍有在用单元依赖，阻止确认并列出受影响单元。
- 拆分/合并：旧单元退出，后继用新身份新代码，写 `service_unit_lineage`。
- 为将来守住：部门上不写院区和管理方式；名称与代码不拼院区；单元代码不由“部门代码 + 院区”拼出；管理归属与核算归属分开。

## 范围外（不要实现，除非某条剧本因此失败）

审批模板版本、双时态读取、发布快照与投递、证照核验、批文/引文/依据机制、病区/护理单元/地点、人员与负责人、层级视图、价表、部门—院区服务关系、部门拆分合并（预留但不做）。MVP 不引入 Redis、Kafka、消息队列。

## 技术栈与目录

```
api/                FastAPI + Pydantic v2 + SQLAlchemy 2.0（psycopg 3），uv 管理
  src/hdip_api/
    core/           配置（HDIP_ 前缀环境变量）、数据库连接
    routes/         路由，前缀 /api
  scripts/export_openapi.py   导出 web/openapi.json
  tests/            pytest，需要可连的 PostgreSQL
migrations/         Alembic 迁移（api/alembic.ini 指向这里），约束与索引手写 SQL
db/init/            docker 首次初始化：建 hdip_app 角色（无 DELETE）
web/                Vite + React 19 + TypeScript + Tailwind v4 + TanStack Query
  src/api/fetcher.ts          orval 统一请求函数
  src/api/generated/          orval 生成，禁止手改
docs/               设计文档
```

- 数据库规则在数据库层强制（唯一、排他、外键、检查约束）；应用层校验只负责给出可读的中文错误信息，两者不一致以数据库为准。前端校验只做即时提示。
- 迁移用 `hdip_owner` 执行（`HDIP_MIGRATION_DATABASE_URL`），应用用 `hdip_app`（`HDIP_DATABASE_URL`）。新表的权限依赖 `ALTER DEFAULT PRIVILEGES`，所以**新表必须由 `hdip_owner` 创建**。
- 契约链路：改后端接口 → `make gen` →（导出 OpenAPI + orval 生成）→ 前端用生成的 `useXxx` hooks。每个路由写明 `operation_id`，生成的 hook 名由它决定。
- “查看日期”作为 TanStack Query 查询键的一部分；确认申请后使相关查询失效重取。
- UI 组件用 ReUI（**Radix 版本**，全项目统一）+ shadcn/ui 体系，组件按需复制进 `web/src/components/`。尚未初始化：首次需要组件时在 `web/` 下执行 `npx shadcn@latest init`（选 Radix），再在 `components.json` 的 `registries` 加 `"@reui": "https://reui.io/r/{style}/{name}.json"`，用 `npx shadcn@latest add @reui/<name>` 添加。路径别名 `@/` → `web/src/`，`cn()` 在 `src/lib/utils.ts`。
- 界面文案用中文；代码标识符用英文，与设计文档第 3 节表名一致（`institution`、`campus`、`operator_relation`、`department`、`service_unit`、`service_unit_lineage`、`change_request`、`option_item`、`approval_rule`）。

## 常用命令

```bash
make db        # 启动 PostgreSQL 16（docker compose）
make migrate   # alembic upgrade head
make api       # 后端 http://localhost:8000（/docs 查看接口）
make web       # 前端 http://localhost:5173（/api 代理到后端）
make gen       # 导出 OpenAPI 并生成前端类型与 hooks
make test      # 后端测试
make check     # ruff + 前端类型检查
```

首次：`cp .env.example .env`，`cd api && uv sync`，`cd web && npm install`。

## 待确认

- 认证与用户来源：默认 MVP 用最简本地账号 + 三个角色（维护人、确认人、只读），预留对接内网门户登录。实现前先和维护者确认。
