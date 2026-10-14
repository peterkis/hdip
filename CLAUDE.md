# CLAUDE.md

HDIP（Hospital Data Intelligence Platform）轻量 MVP：成都市第三人民医院“一院两区一中心”的主数据维护，首版只做**主体、院区、主体—院区运营关系、部门（仅引用）、服务单元**的维护与按日期查询。

**设计依据**：`docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md`（下称“设计文档”）。本文件只摘出写代码时不能违反的规则；两者冲突时以设计文档为准，并提醒维护者同步本文件。

## 工作方式

- **剧本驱动**：设计文档第 7 节的 8 条验收剧本是唯一的完成标准。新增对象、表、字段的唯一理由，是某条剧本因缺它而失败。不要“顺手”加范围外的东西（见下方“范围外”）。
- **按实施顺序推进**（设计文档第 9 节）：① 院区 + 主体 + 运营关系 + 变更申请流 → ② 部门引用 + 服务单元基础动作 → ③ 拆分、合并、按日期查询、只读导出。每一步结束都要是能用的闭环。
- **进度**：第 ①②③ 步的后端、接口契约与生成的 hooks 已完成，8 条剧本都有后端测试（`api/tests/test_scriptN.py`）；剧本 1–4、8 在浏览器里走通。第 ③ 步（拆分、合并、按日期查询、导出）**尚无页面**：UI 视觉规范与整体风格待与维护者共同设计后再做。
- 每条剧本都要有对应的后端测试（`test_scriptN.py`）；新约束要有 `test_rules.py` 里的反例。
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

- 状态：草稿 → 已提交 → 已确认（生效）/ 已退回；草稿和已提交可由创建人**撤销**（因为无物理删除）。已确认、已退回、已撤销是终态，数据库触发器禁止再改；退回或撤销的申请可“复制为新草稿”。提交与确认是两次独立动作，各自记录人和时间。
- 一张申请可含多项变更，确认时在**一个事务**里全部应用，失败整体回滚（拆分、合并、“新建部门 + 新建服务单元”都靠它）。
- 不提供“创建即生效”的捷径，**初始导入也是一张批量申请**，确认一次。
- 同一人可提交并确认（`approval_rule.allow_self_confirm`，默认开），但确认这一步不能省。
- 提交前、确认页、确认时用同一段代码（`services/apply.py`）：提交与查看时在 SAVEPOINT 里预演再回滚，确认时真正写入；校验不过不能提交/确认。退回必须写原因。
- 变更项按 `kind` 区分（`schemas/items.py`，如 `campus.create`、`operator_relation.close`）。对象之间**用 code 引用**，所以同一张申请里后一项可引用前一项新建的对象；运营关系无 code，关闭时用 id。新增一种变更 = 加 schema + `HANDLERS` 里的处理函数 + `approval_rule` 种子 + 测试。
- 数据库拒绝时由 `CONSTRAINT_MESSAGES` 把约束名翻译成中文。新约束请显式命名并补上翻译。
- API 只暴露“创建/提交/确认/退回申请”和只读查询，**不提供业务表的直接增改接口**。
- 前后内容存 JSONB。确认规则（谁能确认哪类变更）按对象类型 × 动作配置在 `approval_rule`，改规则不改代码。

## 领域规则速查

- 统一称**“部门”**，不用“科室”。服务单元必须挂所属部门；单元只引用部门 id，不复制部门名称。
- 部门 MVP 无版本表，改动记录在变更申请里（为将来补版本表回填）；状态预留“弃用”“被替代”。
- 运营关系：每行自带期间，端点（主体、院区）不可改；调整 = 关闭旧行 + 新建行。同一院区在重叠期间最多一个主要运营方，且只有“运营”类型可为主要运营方。关系类型码：`OPERATE/REGISTER/MANAGE/CHARGE`。
- 院区运营状态码沿用旧仓库：`PLANNING`（筹建）→ `TRIAL_RUNNING`（试运行）→ `RUNNING`（运行）→ `SUSPENDED`（停用），只能前进，停用后不可恢复。节点角色在 `option_item`（`campus_node_role`：`HEADQUARTERS/HIGH_TECH/CITY_CENTER`）。
- 修订只作用于最新版本，生效日须晚于其开始日；内容无变化的修订被拒绝。修订项只写改动的字段，写 `null` 表示清空。
- 版本表、身份表、运营关系由触发器 `hdip_guard_update` 保护：只允许把 `valid_to` 从空设为某日（关系另可在同一次 UPDATE 里写关闭信息），结束后整行不可再改。
- 服务单元每个版本须满足：所属部门在用；院区非停用；运营主体与该院区有覆盖整个单元期间的“运营”关系（可由多段运营关系首尾相接覆盖）。“部门在用”只在单元**选用**部门时校验（新建、更换所属部门），已停用部门下的已有单元仍可修订、暂停、退出。
- 单元类型码沿用 `OPD/IPD/ED/EXAM/LAB/PHARMACY/OR/OTHER`，**不新增、不重释码值**；类型不允许修订（职责变化走拆分或新建）。中文名（门诊单元、住院单元…）在 `option_item`。“医技单元”与码值的映射未定，不要自行推断。
- 关闭运营关系或停用院区时，若仍有在用单元依赖，阻止确认并列出受影响单元。院区、关系类依赖在一张申请**全部变更项应用后**统一校验（`apply.py` 的 `_check_units`），所以“停用院区 + 改挂单元”可放在同一张申请里，不论先后。
- 服务单元永久退出 = 最新版本写上 `valid_to`（最后有效日，当天仍有效），之后不再有版本；“已退出”由此推出，不另存状态。版本状态只有 `ACTIVE`（在用）/`SUSPENDED`（暂停）。
- 部门无版本，名称与状态直接改在 `department` 行上（触发器只放开这几列），前后内容记在申请的 `results` 里。
- 拆分/合并（`service_unit.split` / `service_unit.merge`）：只填一个生效日 D，前身最后有效日 = D-1，后继自 D 起；后继新身份新代码、不继承前身版本历史、不自动迁移引用，可与前身不同部门/院区/运营主体。`service_unit_lineage` 一对前身—后继一行，只追加。
- “某日在运营的单元”= 当天有有效版本，含暂停；`GET /api/service-units?include_future=false`。
- 只读导出：`GET /api/export/{dataset}.csv?as_of=`（六类，见 `services/export.py`）。列名与列顺序是对外契约，新增列只加在末尾。
- 为将来守住：部门上不写院区和管理方式；名称与代码不拼院区；单元代码不由“部门代码 + 院区”拼出；管理归属与核算归属分开。

## 范围外（不要实现，除非某条剧本因此失败）

审批模板版本、双时态读取、发布快照与投递、证照核验、批文/引文/依据机制、病区/护理单元/地点、人员与负责人、层级视图、价表、部门—院区服务关系、部门拆分合并（预留但不做）。MVP 不引入 Redis、Kafka、消息队列。

## 技术栈与目录

```
api/                FastAPI + Pydantic v2 + SQLAlchemy 2.0（psycopg 3），uv 管理，Python 版本见 api/.python-version
  src/hdip_api/
    core/           配置（HDIP_ 前缀环境变量）、数据库连接、错误、开发期身份
    models.py       ORM 映射（表结构以迁移为准）
    schemas/        items.py 变更项；read.py 查询与申请的响应
    services/       apply.py 应用变更；workflow.py 申请流；queries.py 只读查询；export.py CSV 导出
    routes/         路由，前缀 /api；master.py 只读，changes.py 是唯一写入口
  scripts/export_openapi.py   导出 web/openapi.json
  tests/            pytest；自动建独立测试库 <库名>_test（需 CREATEDB），每个测试前清空业务表
migrations/         Alembic 迁移（api/alembic.ini 指向这里），约束与索引手写 SQL
db/local-setup.sh   本机 PostgreSQL 18 建 hdip_owner/hdip_app 与库（make db-init）
db/init/            备选 docker（make db-docker）首次初始化：建 hdip_app 角色
web/                Vite + React 19 + TypeScript + Tailwind v4 + TanStack Query + React Router
  src/api/fetcher.ts          orval 统一请求函数（带 X-HDIP-User，出错抛 ApiError）
  src/api/generated/          orval 生成，禁止手改
  src/styles/tokens.css       设计令牌（原始 → 语义）；index.css 桥接到 Tailwind 与 shadcn 变量
  src/components/ui/          shadcn 组件（Base UI，base-mira），按 shadcn 生成，尽量不手改（新加组件若写死任意字号，改成令牌类）
  src/components/kit/         自建的 Notion 风格组件：Icon（统一图标）、Tag、Callout、PropertyList、database（列表页的数据库视图）、toaster（轻提示）
  src/components/shell/       外壳辅助：nav.ts 侧栏按业务主题域分组的配置（规划中条目进 /planned/:key）、面包屑 useCrumb；外壳本身在 components/layout.tsx
  src/components/forms/       各类变更的表单；每个表单只拼一个变更项，保存到新的或已有草稿
  src/pages/                  各页面；service-unit-list.tsx 是第一个按新规范做的列表页（其余页面待迁移）；design.tsx 为 /design 视觉规范页
  src/lib/                    码值中文名（format.ts）、状态标签色（tones.ts）、主题（theme.ts）、查看日期（app-context.tsx）、开发期身份（session.ts）
docs/               设计文档；docs/design/ 视觉规范；docs/refer/ 参考资料（不入库）
```

- 数据库规则在数据库层强制（唯一、排他、外键、检查约束）；应用层校验只负责给出可读的中文错误信息，两者不一致以数据库为准。前端校验只做即时提示。
- 迁移用 `hdip_owner` 执行（`HDIP_MIGRATION_DATABASE_URL`），应用用 `hdip_app`（`HDIP_DATABASE_URL`）。新表的权限依赖 `ALTER DEFAULT PRIVILEGES`，所以**新表必须由 `hdip_owner` 创建**。
- 契约链路：改后端接口 → `make gen` →（导出 OpenAPI + orval 生成）→ 前端用生成的 `useXxx` hooks。每个路由写明 `operation_id`，生成的 hook 名由它决定。
- “查看日期”作为 TanStack Query 查询键的一部分；确认申请后使相关查询失效重取。
- **视觉规范（Notion 风格）**：见 `docs/design/ui-tokens.md`，应用内 `/design` 可看。样式只用 `web/src/styles/tokens.css` 的语义令牌及其生成的 Tailwind 类（`text-fg-muted`、`bg-surface-subtle`、`border-line`、`bg-brand`…）；**不写色值和任意值**（`#xxx`、`text-[13px]`），页面不引用原始令牌（`--hd-blue-600`）。状态用 `components/kit/tag.tsx`，颜色取 `lib/tones.ts`。图标统一用 `components/kit/icon.tsx` 的 `<Icon>`：先选 hugeicons（shadcn/ReUI 的 iconLibrary），没有合适的再用 lucide-react。轻提示用 `lib/notify.ts`（react-hot-toast，样式已按令牌定制），只用于成功和轻量结果；需要逐条处理的校验错误留在页面上。深色与强调色只重定义语义令牌（`.dark`、`[data-accent]`），切换用 `lib/theme.ts`。
- UI 组件用 shadcn/ui 的 **Base UI 版本**（`components.json`：style `base-mira`，图标 hugeicons），全项目统一。加组件：在 `web/` 下 `npx shadcn@latest add <name>`。Base UI 组件用 `render` 属性替换元素（不是 Radix 的 `asChild`）。主题变量在 `src/index.css`。需要 ReUI 组件时选 Base UI 版本：在 `components.json` 的 `registries` 加 `"@reui": "https://reui.io/r/{style}/{name}.json"` 后 `npx shadcn@latest add @reui/<name>`（先确认 ReUI 是否提供 base-mira 风格）。路径别名 `@/` → `web/src/`，`cn()` 在 `src/lib/utils.ts`。
- 表单弹窗只在打开时挂载（`{open && <XxxDialog open … />}`），关闭即丢弃状态。
- 界面文案用中文；代码标识符用英文，与设计文档第 3 节表名一致（`institution`、`campus`、`operator_relation`、`department`、`service_unit`、`service_unit_lineage`、`change_request`、`option_item`、`approval_rule`）。

## 常用命令

```bash
make db        # 启动本机 PostgreSQL 18（brew services）
make db-init   # 首次：按 .env 建账号与 hdip 库（只动 hdip 相关对象）
make migrate   # alembic upgrade head
make api       # 后端 http://localhost:8000（/docs 查看接口）
make web       # 前端 http://localhost:5173（/api 代理到后端）
make gen       # 导出 OpenAPI 并生成前端类型与 hooks
make test      # 后端测试
make check     # ruff + 前端类型检查
```

首次：`cp .env.example .env` 并改密码，`make db && make db-init`，`cd api && uv sync`（uv 按 `.python-version` 自动装 Python 3.13），`cd web && npm install`。拉取新迁移后执行 `make migrate`。

## 待确认

- 认证与用户来源：目前是**开发期身份**——前端在请求头 `X-HDIP-User` 带用户名，后端只认 `app_user` 里启用的用户（种子：solo 维护+确认、maintainer、confirmer、viewer）。这不是安全措施。正式方案（本地账号或内网门户登录）确定后只替换 `api/src/hdip_api/core/auth.py` 与 `web/src/lib/session.ts`。
- 主体性质目前是自由文本（旧仓库为“按登记证照确认”），是否改为选项待定。
