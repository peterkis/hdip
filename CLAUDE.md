# CLAUDE.md

HDIP（Hospital Data Intelligence Platform）轻量 MVP：成都市第三人民医院“一院两区一中心”的主数据维护，首版做**主体、院区、主体—院区运营关系、部门、服务单元**的维护与按日期查询。部门已深化为部门主数据（设计文档第 13 节、`docs/部门主数据深化-实施计划.md`）。人员模块按 `docs/HDIP 轻量人员模块设计：人员、任用、部门归属.md`（下称“人员设计”）推进，P1.1（登记、名册、详情、组织退出的人员依赖）、P1.2（改姓名、换工号、调科、结束 / 补归属、提示）与 P1.3（结束任用、调整结束日、撤销计划、再次任用）已实施，P1 完成。

**设计依据**：`docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md`（下称“设计文档”）。本文件只摘出写代码时不能违反的规则；两者冲突时以设计文档为准，并提醒维护者同步本文件。

## 工作方式

- **剧本驱动**：设计文档第 7 节的 8 条验收剧本是唯一的完成标准。新增对象、表、字段的唯一理由，是某条剧本因缺它而失败。不要“顺手”加范围外的东西（见下方“范围外”）。
- **按实施顺序推进**（设计文档第 9 节）：① 院区 + 主体 + 运营关系 + 变更申请流 → ② 部门引用 + 服务单元基础动作 → ③ 拆分、合并、按日期查询、只读导出。每一步结束都要是能用的闭环。
- **进度**：第 ①②③ 步的后端、接口契约与生成的 hooks 已完成，剧本都有后端测试（`api/tests/test_scriptN.py`）；剧本 1–21 都已在浏览器里走通（18–20 部门组织变更于 2026-10-21 修复后补走查）；人员 P1（PERS-01～09）有后端测试（`test_persXX.py`、`test_rules_persons.py`）并已在浏览器走通（`docs/剧本走查记录.md`，走查用独立库：`make walk-db`（含组织变更、批量操作、组织总览与合成人员的起点，`make walk-db-minimal` 只建最小起点）、`make api-walk`、`make web-walk`；重建前先停掉 api-walk）。拆分、合并表单在服务单元详情页，用 `components/evolve-flow.tsx`（React Flow，只展示与点选）画“前身 → 生效日 → 后继”，申请页与单元演变关系共用。UI 规范已定（Notion 风格），全部业务页面已按新规范迁移（主体、院区、部门、服务单元、变更申请、分类方案、编码映射台账），并适配手机宽度（375px 无横向溢出）。部门深化 D1、D2、D3 已完成（剧本 9–17 有测试；部门列表含层级树（连线、可折叠）、详情含隶属与管理关系与外部编码、分类方案页、编码映射台账页）。主体详情有主体—院区运营关系图（主体列表不再放图）；部门详情“隶属与管理关系”有关系图；各详情页的版本时间线为竖向进度式；变更申请列表合并同类变更项计数、详情分批显示。“组织与关系”第一项是组织总览（`/organization-overview`）：服务布局桑基图（`@nivo/sankey`，按分类 / 按院区）、部门 × 院区矩阵、编码治理图，汇报模式与图片导出待第二步。批量操作：编码映射台账“批量裁决”（按源名称给候选，人勾选确认）、部门列表勾选后批量设置主分类 / 行政上级——都只是生成一张多项草稿。院方资料包经 `api/scripts/import_sample.py` 生成样例数据：配置直接登记，业务数据生成变更申请待确认人确认（院区、部门申请确认后再运行一次，才生成服务单元与 HIS 科室字典申请）；开发库于 2026-10-19 按新代码规则重建（迁移 0015）：起点（主体、三院区与运营关系）与部门树在一张申请（#1）里，确认后再运行一次脚本生成服务单元与 HIS 申请；部门与服务单元自 2020-01-01，中心院区（筹建）自 2027-12-27。直属院区三个：本部院区（C001，运行）、高新院区（C002，筹建）、中心院区（C003，筹建）。走查库同样重建，脚本里的 BY、XNK、SU-101 只是临时代码，写入时换成系统代码（`make walk-db` 末尾打印对照）。
- 每条剧本都要有对应的后端测试（`test_scriptN.py`）；新约束要有 `test_rules.py` 里的反例。
- **文档与改动同步（Peter 2026-10-18 要求）**：迁移、表结构、接口、导出数据集或业务规则有任何改动，**在同一次提交里**同步：`make db-doc`（结构参考）、`docs/database/README.md`（全景表、写入表、读取与导出、迁移史、相应章节）、本文件的规则速查与文档索引，以及相关业务文档（设计文档、实施计划、评估与分期、走查记录）。新定的规则当场写进对应文档，不留到以后。
- 剧本走不通时用三分法定位：事实有分歧 → 找责任人定；系统表达不了 → 改模型；操作不顺 → 改页面。
- 业务尚不明确、随时可能调整：优先小而可改的实现，不做提前抽象。

## 三条硬约束（做错无法补救）

1. **身份与代码**：id 永不复用；code 全局唯一且永久绑定，对象退出后也不释放、不复用。院区、部门、服务单元的 code 由系统分配，不让人手填（见规则速查“代码分配”）。
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
- 申请页按业务分组呈现、逐组“我已核对”（`components/change-review.tsx`，行内片段来自后端 `item_views`）；能提交 / 确认的人全部组核对完，提交、确认才可用（阅读进度存在 sessionStorage，不入库）。
- **申请页只用于核对与提交，不逐项移除变更项**（2026-10-19 Peter：逐项移除会拆散组织变更这类整体变更）。向导生成的草稿用“回到向导调整”：按草稿还原向导，保存时整体替换变更项；后端也拒绝把含组织变更事件的草稿更新成不含事件（`workflow.update_draft`）。其他草稿有误时撤销后重新发起。
- 不提供“创建即生效”的捷径，**初始导入也是一张批量申请**，确认一次。
- 同一人可提交并确认（`approval_rule.allow_self_confirm`，默认开），但确认这一步不能省。
- 提交前、确认页、确认时用同一段代码（`services/apply.py`）：提交与查看时在 SAVEPOINT 里预演再回滚，确认时真正写入；校验不过不能提交/确认。退回必须写原因。预演**逐项试算**（每项一个 SAVEPOINT，失败回滚后继续），一次列出全部问题，通过的项照常给前后内容；确认时遇到第一个问题即停。
- **问题提示写法**（参照 ASD-STE100：短句、主动语态、先说事实再说操作、一句只说一件事）：`ItemError(message, field, hint=..., facts=[(标签, 日期, 'info'|'bad')])`——message 用名称说事实，hint 说怎么改，facts 供前端画日期对照小轴。申请里每项另有一句话说明（`services/describe.py` 的 `item_summaries`，用名称，不依赖预演）。
- 变更项按 `kind` 区分（`schemas/items.py`，如 `campus.create`、`operator_relation.close`）。对象之间**用 code 引用**，所以同一张申请里后一项可引用前一项新建的对象；运营关系无 code，关闭时用 id。新增一种变更 = 加 schema + `HANDLERS` 里的处理函数 + `approval_rule` 种子 + 测试。
- 数据库拒绝时由 `CONSTRAINT_MESSAGES` 把约束名翻译成中文。新约束请显式命名并补上翻译。
- API 只暴露“创建/提交/确认/退回申请”和只读查询，**不提供业务表的直接增改接口**。例外只限**配置/字典**（如部门分类方案与代码）：有维护人角色可直接维护、不需确认，记录维护人与时间，不删除只停用；部门上的分类**赋值**仍是业务数据，照常经变更申请。
- 前后内容存 JSONB。确认规则（谁能确认哪类变更）按对象类型 × 动作配置在 `approval_rule`，改规则不改代码。

## 领域规则速查

- **代码分配（迁移 0015）**：院区 `C` + 3 位、部门 `D` + 6 位、服务单元 `SU` + 6 位数字，大小写等价（`Code` 类型自动转大写）。表单点“保存到申请”时经 `POST /api/code-reservations` 预留（同一表单同一请求键，重试拿回同一个号；号码不回收），变更项里先写占位符 `newCode()`（`forms/new-code.ts`），保存时整体替换。新建院区 / 部门 / 服务单元（含拆分合并后继、组织变更新设部门）只能用已预留的同类型代码（`apply._require_issued`）；同一代码同时只能由一张进行中的申请用来新建（`workflow._check_code_holders`）。主体代码仍由人填。测试客户端自动为新建代码登记预留（`api.strict()` 关掉）。
- **拼音码**：院区 / 部门 / 服务单元版本的 `pinyin`，名称的拼音首字母（大写字母数字），随名称进版本、只用于检索、不唯一。表单按名称生成（`lib/pinyin.ts`，pinyin-pro）、可改，多音字逐个提示核对；“区”固定取 Q、不提示（固定读音前端在 `lib/pinyin.ts` 的 `FIXED`，后端在 `services/codes.py`，两处一致）；未给出时后端生成（pypinyin），改名未给时按新名称重新生成。
- 统一称**“部门”**，不用“科室”。服务单元必须挂所属部门；单元只引用部门 id，不复制部门名称。
- 部门（D1 已实施，迁移 0006）：`department` 只留身份；属性在 `department_version`。
  - 部门属性版本：名称、简称、职责说明、设立形式（常设/临时+期限）、组织生命周期、行政级别（选填）、承担职责（自由标签）、依据文本（选填；维持决策 3，不做依据对象、不校验）。
  - 组织生命周期 `PREPARING` 筹备 → `ACTIVE` 正式履职 ⇄ `SUSPENDED` 暂停履职 → `REVOKED` 撤销；`SUPERSEDED` 被替代留给拆并。部门数只计正式履职；服务单元期间内部门须为正式履职。
  - 部门管理主分类 v1（单选，六类）：同一方案同一时点一个主类，赋值带生效日；成本分类另设。
  - 行政视图（运营、病案占位）：同一视图同一时点一个上级、禁止成环；一级/二级部门 = 行政视图中的子部门层级，由关系计算不保存。只保留服务单元的“所属部门”，不加其他部门—单元关系。
  - 权限按“权限键”判断（角色 → 权限键一处映射），便于以后细化。
- 运营关系：每行自带期间，端点（主体、院区）不可改；调整 = 关闭旧行 + 新建行。同一院区在重叠期间最多一个主要运营方，且只有“运营”类型可为主要运营方。同一主体与同一院区同一时期只能有一条关系，不论类型（迁移 0013，排他约束 `operator_relation_pair_excl`，应用层先给出中文提示）。关系类型码：`OPERATE/REGISTER/MANAGE/CHARGE`。
- 院区运营状态码沿用旧仓库：`PLANNING`（筹建）→ `TRIAL_RUNNING`（试运行）→ `RUNNING`（运行）→ `SUSPENDED`（停用），只能前进，停用后不可恢复。节点角色已停用（2026-10-17，与院区名称重复）：表单不再维护，历史取值保留；对外叫法不同时写“对外名称”`public_name`（如中心院区对外称“成都市中心医院”）。
- 修订只作用于最新版本，生效日须晚于其开始日；内容无变化的修订被拒绝。**例外：最新版本尚未生效（开始日晚于今天）时，可在其开始日当天修订 = 更正**：原版本结束日写为开始日前一日（空期间，从未生效，记录保留，`apply.is_void`），新版本自同一天起（迁移 0011）。读取“某日有效 / 最早计划版本”时跳过空期间版本。修订项只写改动的字段，写 `null` 表示清空。
- 登记时间与业务生效日分开：未来才开始的院区、部门现在就能挂单元、建关系，只是开始日不能早于它们的开始日（表单自动推后并说明）。院区的开始日是它在主数据里开始存在的日子（筹建期也算），开诊用运营状态表达。
- 版本表、身份表、运营关系由触发器 `hdip_guard_update` 保护：只允许把 `valid_to` 从空设为某日（关系另可在同一次 UPDATE 里写关闭信息），结束后整行不可再改。
- 服务单元每个版本须满足：所属部门在单元整个期间内为“正式履职”；院区非停用；运营主体与该院区有覆盖整个单元期间的“运营”关系（可由多段运营关系首尾相接覆盖）。部门改为暂停履职、撤销时，若仍有依赖它的单元，阻止确认并列出（可在同一张申请里先改挂）。
- 单元类型码沿用 `OPD/IPD/ED/EXAM/LAB/PHARMACY/OR/OTHER`，**不新增、不重释码值**；类型不允许修订（职责变化走拆分或新建）。中文名（门诊单元、住院单元…）在 `option_item`。“医技单元”与码值的映射未定，不要自行推断。
- 关闭运营关系或停用院区时，若仍有在用单元依赖，阻止确认并列出受影响单元。院区、关系类依赖在一张申请**全部变更项应用后**统一校验（`apply.py` 的 `_check_units`），所以“停用院区 + 改挂单元”可放在同一张申请里，不论先后。
- 服务单元永久退出 = 最新版本写上 `valid_to`（最后有效日，当天仍有效），之后不再有版本；“已退出”由此推出，不另存状态。版本状态只有 `ACTIVE`（在用）/`SUSPENDED`（暂停）。
- 行政隶属与管理关系（D2，迁移 0007）：`department.set_parent`（视图内换上级，空 = 一级部门）、`department.relation_create/.relation_close`（专业管理 / 协作 / 院区管理）。成环在申请全部应用后检查（`apply.py` 的 `_check_org`）；撤销部门自动结束它自己的上级边与关系，仍有下级则阻止。只能写入 ACTIVE 视图。新建部门表单可选“上级部门”：同一张草稿里生成 `department.create` + `department.set_parent` 两项（生效日 = 设立日期），所以二级、三级部门一次建成。
- 部门变更项：`department.create/.revise/.change_lifecycle/.classify/.classification_close/.affiliate/.alias_add/.alias_close`；旧的 `.rename/.change_status` 只保留读取。分类字典（`classification_scheme/_code`）是配置，经 `/api/dictionary/*` 由有 `dictionary.maintain` 权限的人直接维护。
- 部门组织变更（第一期，迁移 0012，`docs/部门组织变更-评估与分期.md`）：`department.reorganize` 记录事件（整体拆分 / 分设 / 吸收合并 / 合并新设）与参与部门的身份结论（存续 / 退出 / 新设），正式依据必填。**先定身份、不按名称推断**；新设部门须在同一申请里先 `department.create`（开始日 = 生效日）。退出的部门新版本为“被替代”（只能由事件产生），自动结束它的上级边、管理关系、分类、别名、主体归属；单元、下级部门、指向它的外部编码解释**不自动处置**，须在同一申请里逐项处理（`_check_units`、`_check_org`、`_check_ended_codes`），旧代码不直接改指向新部门。演变关系不是行政上下级。前端“组织变更”向导生成整张申请。
- 拆分/合并（`service_unit.split` / `service_unit.merge`）：只填一个生效日 D，前身最后有效日 = D-1，后继自 D 起；后继新身份新代码、不继承前身版本历史、不自动迁移引用，可与前身不同部门/院区/运营主体。`service_unit_lineage` 一对前身—后继一行，只追加。
- “某日在运营的单元”= 当天有有效版本，含暂停；`GET /api/service-units?include_future=false`。
- 部门承接清单（`GET /api/departments/{id}/dependencies?day=`）取**与 day 及以后相交**的依赖，不只看 day 当天：预约以后改挂进来的单元也列出（显示为“预约 X 起改挂进来”）。服务单元列表的 `sub=1`（部门含下级）、`cls`（一级部门的主分类）与组织总览同一规则，总览外跳带上全部范围。
- 批量操作不另设写入接口：前端一次生成一张多项草稿（`ItemDialog` 的 build 可返回数组）。待裁决代码的候选由 `GET /api/external-codes?suggest=true` 按源名称给出，只是建议：仅“名称相同 / 别名 / 曾用名”预先选中，“包含 / 相近”须人点选。
- 组织总览（剧本 21，设计文档第 6 节）只读、不另设接口：前端从服务单元与部门列表聚合（`lib/org-overview.ts`），同一份筛选结果出桑基图、矩阵、清单与计数。带宽 = 服务单元数；单元挂在它自己所属的部门上（不上卷）；多列只用于树形（主分类 → 部门树 → 单元），院区视角只两列；矩阵空格 = 未登记，不等于确认不设；默认只计当天在用，计划、暂停由人打开。编码治理图用 `GET /api/source-systems` 每本字典的 `breakdown`（按源记录去重）。
- 只读导出：`GET /api/export/{dataset}.csv?as_of=`（数据集见 `services/export.py`）。列名与列顺序是对外契约，新增列只加在末尾。
- 外部代码（D3，迁移 0008）：**代码跟着它标识的对象走**（部门或服务单元，按语义逐条判定，不按系统名统一决定），**分类跟着语义走**（部门、单元分别关联，部门分类不下发给单元），**报送跟着业务角色和时点走**（字段输出规则暂不做）。同一字典同一代码同一条件同一时点只有一个解释；不在部门和单元上各加一套固定代码字段。
  - 配置：`source_system`（来源系统实例）、`code_namespace`（字典，不限定只装一种对象），经 `/api/dictionary/*` 直接维护。业务数据：`external_code`（源记录，登记后不可改）、`external_code_assignment`（按期间的解释：部门 / 服务单元 / 对象未建模，可带院区条件）。
  - 变更项：`external_code.register/.assign/.assignment_close`（源记录按“系统 + 字典 + 代码”引用）、`service_unit.classify`。“要么都带院区条件、要么都不带”在申请全部应用后检查（`apply.py` 的 `_check_codes`）。
  - 待裁决不存储：某日没有解释即待裁决；裁决 = 新增解释（开始日可在过去）。待裁决与对象未建模都不进导出。
  - 分类方案写明 `meaning_for_department` / `meaning_for_unit`，为空即不适用于该对象；外部分类代码按正式代码表原样书写（如 `03.05`），不臆造。
- 人员（P1.1，迁移 0016，人员设计）：`person` 只留身份（代码 `P` + 6 位，系统分配，与医院业务工号无关）；姓名在 `person_version`（`revise_reason` 区分登记 / 更名 / 更正误录）；任用 `person_engagement`、业务工号 `person_work_no`、部门归属 `person_assignment` 都带期间。人员上**不存当前部门、不存在职 / 离职状态**（按日期从任用派生）。
  - 任用、工号、归属的结束日**到达前可改**（`hdip_guard_open_end`），到达后不可改、不“接续”，再次任用 = 新任用；组织表仍是“结束日只写一次”。改结束日的变更项带 `expected_valid_to`，与库里不一致即拒绝。
  - 同一人员 + 同一主体任用期间不重叠（P1 限制，可撤掉的约束）；同一任用同一时点最多一条主归属；同一主体内一个工号永远只属于一个人（本人返聘可沿用）。
  - 归属完整期间落在任用期间内；部门已设立且无撤销 / 被替代段；筹备、暂停履职可以。部门撤销 / 被替代时，与退出日及以后相交的人员归属（含预约调入）阻止确认并列出，在同一申请里调科或结束归属；不随服务单元或名称自动迁人。
  - 变更项：`person.create`、`.engage`（新建任用 + 工号 + 主归属；暂未分配须写原因）、`.transfer`（调科：旧止于 D−1、新自 D 起）、`.assignment_set_end`、`.revise`（`RENAME` 更名 / `CORRECTION` 更正误录，都不改写已生效历史）、`.change_work_no`（`CHANGE` / `CORRECTION`，带 `expected_work_no`）、`.assign`（补主部门）、`.engagement_set_end`（结束 / 提前 / 推后 / 清空结束日 / 撤销计划，下属归属与工号随之处理）；处理结果可带 `notices`（不阻止的提示：同名、部门筹备 / 暂停、暂未分配）；处理在 `services/persons.py`，最终检查 `check_persons`。确认在咨询锁下串行执行。
  - 权限键 `person.view / .view_sensitive / .export / .change`（`core/permissions.py`，P1 与组织模块等价）；无 `person.view` 时含人员项的申请整张隐藏；敏感字段登记在 `PERSON_FIELD_PERMISSIONS`（工号不敏感；身份证号、电话将来登记），后端统一置空。人员 ≠ `app_user`。
  - 人名拼音码首字按姓氏读音（`lib/pinyin.ts` 的 `person` 模式），“区 → Q”只用于组织名称。
- 为将来守住：部门上不写院区和管理方式；名称与代码不拼院区；单元代码不由“部门代码 + 院区”拼出；管理归属与核算归属分开。

## 范围外（不要实现，除非某条剧本因此失败）

审批模板版本、双时态读取、发布快照与投递、证照核验、批文/引文/依据机制、病区/护理单元/地点、负责人（人员模块 P3）、人员模块 P1 以外的人员内容（见人员设计第 1 节）、层级视图（行政视图除外）、价表、部门—院区服务关系。部门组织变更第二期（身份纠错、结构化承接范围、分批生效、实施与核验回执）见 `docs/部门组织变更-评估与分期.md`。MVP 不引入 Redis、Kafka、消息队列。

## 文档索引

| 想了解 | 看这里 |
| --- | --- |
| 业务对象、规则、验收剧本 | `docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md` |
| **数据库设计**：约定、历史保护、写入与读取流程、迁移史、新增对象检查单、规划中的部门结构 | `docs/database/README.md` |
| **表结构参考**：每张表的列、约束、索引、触发器、权限、配置种子（自动生成，勿手改） | `docs/database/schema-reference.md` |
| 部门深化的需求、决定与阶段 | `docs/部门主数据深化-实施计划.md` |
| UI 视觉规范与操作动线原则 | `docs/design/ui-tokens.md`（应用内 `/design`） |
| 剧本走查结果与发现的问题 | `docs/剧本走查记录.md` |
| 部门拆分、合并等组织变更的评估与分期（第一期已实施） | `docs/部门组织变更-评估与分期.md` |
| **人员模块**：人员、任用、部门归属的对象、规则、动作、验收剧本 PERS-xx 与分期（P1 已实施；P2 名单导入、P3 附加归属与部门职务待启动） | `docs/HDIP 轻量人员模块设计：人员、任用、部门归属.md` |

改了迁移就执行 `make migrate && make db-doc`，并同步 `docs/database/README.md` 里相应的说明。

## 技术栈与目录

```
api/                FastAPI + Pydantic v2 + SQLAlchemy 2.0（psycopg 3），uv 管理，Python 版本见 api/.python-version
  src/hdip_api/
    core/           配置（HDIP_ 前缀环境变量）、数据库连接、错误、开发期身份
    models.py       ORM 映射（表结构以迁移为准）
    schemas/        items.py 变更项；read.py 查询与申请的响应
    services/       apply.py 应用变更；workflow.py 申请流；queries.py 只读查询；export.py CSV 导出；codes.py 代码分配与拼音码；persons.py 人员变更项与最终检查；person_queries.py 人员只读查询
    routes/         路由，前缀 /api；master.py、persons.py 只读，changes.py 是唯一写入口；codes.py 只做代码预留（不改主数据）
  scripts/export_openapi.py   导出 web/openapi.json
  scripts/export_schema_doc.py  从数据库生成 docs/database/schema-reference.md（make db-doc）
  tests/            pytest；自动建独立测试库 <库名>_test（需 CREATEDB），每个测试前清空业务表
migrations/         Alembic 迁移（api/alembic.ini 指向这里），约束与索引手写 SQL
db/local-setup.sh   本机 PostgreSQL 18 建 hdip_owner/hdip_app 与库（make db-init）
db/init/            备选 docker（make db-docker）首次初始化：建 hdip_app 角色
web/                Vite + React 19 + TypeScript + Tailwind v4 + TanStack Query + React Router
  src/api/fetcher.ts          orval 统一请求函数（带 X-HDIP-User，出错抛 ApiError）
  src/api/generated/          orval 生成，禁止手改
  src/styles/tokens.css       设计令牌（原始 → 语义）；index.css 桥接到 Tailwind 与 shadcn 变量
  src/components/ui/          shadcn 组件（Base UI，base-mira），按 shadcn 生成，尽量不手改（新加组件若写死任意字号，改成令牌类）
  src/components/kit/         自建的 Notion 风格组件：Icon（统一图标）、Tag、Callout、PropertyList、Steps（多步骤进度节点）、section（详情页区块 Section、轻量操作 InlineAction、申请链接 ChangeLink）、database（列表页的数据库视图）、toaster（轻提示）、date-input（日期录入，统一 yyyy-mm-dd，不直接用 `<input type="date">`）
  src/components/             图示：flow-kit.tsx（关系图共用的卡片、带标签直角折线、自动适配）、org-flow.tsx（部门隶属与管理关系图）、evolve-flow.tsx（拆分 / 合并 / 部门沿革，React Flow）、flow-sankey.tsx（组织总览的桑基图，nivo，颜色取 `--hd-chart-*` 令牌）、dept-campus-matrix.tsx（部门 × 院区矩阵）、operator-flow.tsx（主体—院区运营关系图：直角折线、黑色端点，运行中 = 流动虚线，其他状态 = 实线 + 标签）、version-timeline.tsx（版本与事件时间线：按原型的竖线 + 蓝点 + 日期 / 事件名 / 说明）；细节见 docs/design/ui-tokens.md 第 8.1 节
  src/components/shell/       外壳辅助：nav.ts 侧栏按业务主题域分组的配置（规划中条目进 /planned/:key）、面包屑 useCrumb；外壳本身在 components/layout.tsx
  src/components/forms/       各类变更的表单；每个表单只拼一个变更项，保存到新的或已有草稿；fields.tsx 字段与字段级校验，ref-selects.tsx 按名称选择引用对象，new-code.ts 新建对象的代码占位与预留，code-fields.tsx 代码（只读）与拼音码字段
  src/pages/persons.tsx       人员名册与人员详情；表单在 components/forms/person-forms.tsx（登记即查重），部门详情“人员”标签用 components/department-persons.tsx
  src/pages/                  各页面（均按新规范：PageHeader + PropertyList + kit/section 的 Section，列表用 kit/database）；design.tsx 为 /design 视觉规范页
  src/lib/                    组织总览聚合（org-overview.ts）、拼音码（pinyin.ts）、码值中文名（format.ts）、状态标签色（tones.ts）、主题（theme.ts）、查看日期（app-context.tsx）、开发期身份（session.ts）
docs/               设计文档；docs/database/ 数据库设计；docs/design/ 视觉规范；docs/refer/ 参考资料（不入库）
```

- 数据库规则在数据库层强制（唯一、排他、外键、检查约束）；应用层校验只负责给出可读的中文错误信息，两者不一致以数据库为准。前端校验只做即时提示。
- 迁移用 `hdip_owner` 执行（`HDIP_MIGRATION_DATABASE_URL`），应用用 `hdip_app`（`HDIP_DATABASE_URL`）。新表的权限依赖 `ALTER DEFAULT PRIVILEGES`，所以**新表必须由 `hdip_owner` 创建**。
- 契约链路：改后端接口 → `make gen` →（导出 OpenAPI + orval 生成）→ 前端用生成的 `useXxx` hooks。每个路由写明 `operation_id`，生成的 hook 名由它决定。
- “查看日期”作为 TanStack Query 查询键的一部分；确认申请后使相关查询失效重取。
- **操作动线优先**：页面与表单必须符合人的操作直觉、路线合理（见 `docs/design/ui-tokens.md` 第 0 节）。引用其他对象一律按名称从下拉选择（`forms/ref-selects.tsx`），不让人输代码；只列可选项，能推断的给默认值；保存时用 `requireFields` 返回字段级错误，所有问题字段同时标红、焦点落到第一个。
- **视觉规范（Notion 风格）**：见 `docs/design/ui-tokens.md`，应用内 `/design` 可看。样式只用 `web/src/styles/tokens.css` 的语义令牌及其生成的 Tailwind 类（`text-fg-muted`、`bg-surface-subtle`、`border-line`、`bg-brand`…）；**不写色值和任意值**（`#xxx`、`text-[13px]`），页面不引用原始令牌（`--hd-blue-600`）。状态用 `components/kit/tag.tsx`，颜色取 `lib/tones.ts`。图标统一用 `components/kit/icon.tsx` 的 `<Icon>`：先选 hugeicons（shadcn/ReUI 的 iconLibrary），没有合适的再用 lucide-react。轻提示用 `lib/notify.ts`（react-hot-toast，样式已按令牌定制），只用于成功和轻量结果；需要逐条处理的校验错误留在页面上。深色与强调色只重定义语义令牌（`.dark`、`[data-accent]`），切换用 `lib/theme.ts`。
- UI 组件用 shadcn/ui 的 **Base UI 版本**（`components.json`：style `base-mira`，图标 hugeicons），全项目统一。加组件：在 `web/` 下 `npx shadcn@latest add <name>`。Base UI 组件用 `render` 属性替换元素（不是 Radix 的 `asChild`）。主题变量在 `src/index.css`。需要 ReUI 组件时选 Base UI 版本：在 `components.json` 的 `registries` 加 `"@reui": "https://reui.io/r/{style}/{name}.json"` 后 `npx shadcn@latest add @reui/<name>`（先确认 ReUI 是否提供 base-mira 风格）。路径别名 `@/` → `web/src/`，`cn()` 在 `src/lib/utils.ts`。
- 表单弹窗只在打开时挂载（`{open && <XxxDialog open … />}`），关闭即丢弃状态。
- 界面文案用中文；代码标识符用英文，与设计文档第 3 节表名一致（`institution`、`campus`、`operator_relation`、`department`、`service_unit`、`service_unit_lineage`、`change_request`、`option_item`、`approval_rule`）。

## 常用命令

```bash
make db        # 启动本机 PostgreSQL 18（brew services）
make db-init   # 首次：按 .env 建账号与 hdip 库（只动 hdip 相关对象）
make migrate   # alembic upgrade head
make db-doc    # 迁移后重新生成表结构参考 docs/database/schema-reference.md
make api       # 后端 http://localhost:8000（/docs 查看接口）
make web       # 前端 http://localhost:5173（/api 代理到后端）
make gen       # 导出 OpenAPI 并生成前端类型与 hooks
make test      # 后端测试
make check     # ruff + 前端类型检查
```

首次：`cp .env.example .env` 并改密码，`make db && make db-init`，`cd api && uv sync`（uv 按 `.python-version` 自动装 Python 3.13），`cd web && npm install`。拉取新迁移后执行 `make migrate`。

## 待确认

- 认证与用户来源：目前是**开发期身份**——前端在请求头 `X-HDIP-User` 带用户名，后端只认 `app_user` 里启用的用户（种子：solo（显示名“张三”）维护+确认、maintainer、confirmer、viewer）。这不是安全措施。正式方案（本地账号或内网门户登录）确定后只替换 `api/src/hdip_api/core/auth.py` 与 `web/src/lib/session.ts`。
- 主体性质目前是自由文本（旧仓库为“按登记证照确认”），是否改为选项待定。
