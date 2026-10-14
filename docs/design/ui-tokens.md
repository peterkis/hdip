# HDIP 统一 UI 视觉规范（Notion 风格）

2026-10-14 · 在线查看：应用内 `/design` · 令牌文件：`web/src/styles/tokens.css` · 依据：[notion-design-md.md](notion-design-md.md)

## 1. 风格要点

- **安静的暖灰中性色，内容优先**。大面积只有白底、浅暖灰侧栏和黑色透明度文字；颜色只用来传达状态和主操作。
- **用透明度叠加表达层次**。文字、边框、悬停、选中都是黑（深色主题为白）的不同透明度，放在任何底色上都协调。
- **密度适中**。应用内正文 14px，控件高 28–32px，页面正文最宽 900px。
- **阴影极淡、圆角小**。标签 4、控件 6、卡片 8、弹窗 12；阴影多层叠加、几乎看不出边缘。
- **动效只做反馈**。悬停 100ms、弹层 200ms，缓动 ease。

依据文档提取自 notion.so 营销站。本规范保留它的色板、字号阶、圆角阶、阴影阶和动效时长（名称与值对应来源的 `--color-*`、`--font-size-*`、`--border-radius-*`、`--shadow-*`），并按 Notion 应用内的界面密度确定语义用法。

## 2. 令牌三层

| 层 | 命名 | 在哪 | 谁能用 |
| --- | --- | --- | --- |
| 原始令牌 | `--hd-<色系>-<级>`、`--hd-size-*`、`--hd-space-*`、`--hd-radius-*`、`--hd-shadow-*`、`--hd-duration-*` | tokens.css 第 1 段 | 只有语义令牌 |
| 语义令牌 | `--hd-text-*`、`--hd-surface-*`、`--hd-border-*`、`--hd-accent-*`、`--hd-danger/warning/success/info-*`、`--hd-tag-*`、`--hd-type-*`、`--hd-radius-<角色>`、`--hd-elevation-*`、布局尺寸 | tokens.css 第 2 段 | 页面、组件 |
| 桥接 | Tailwind 主题（`text-fg-muted`、`bg-surface-subtle`、`border-line`、`bg-brand`、`bg-tag-green-bg`、`text-xs`、`rounded-md`、`shadow-md`…）与 shadcn 变量（`--primary`、`--border`…） | `web/src/index.css` | 页面、组件 |

- 前缀统一 `--hd-`，避免与 Tailwind 自带的 `--color-gray-*` 冲突。
- 桥接层里没有任何色值或尺寸常量。

### 一键修改与替换

| 想做什么 | 改哪里 |
| --- | --- |
| 微调某个颜色在全站的值（如蓝色更深） | 原始令牌 `--hd-blue-600` |
| 改某种用途的颜色（如链接改用绿色） | 语义令牌 `--hd-accent-text: var(--hd-green-600)` |
| 换品牌强调色 | 语义令牌的 `--hd-accent*` 一组；或增加一个 `[data-accent="…"]` 块（已有 purple、teal 示例） |
| 深色主题 | `.dark` 块，只重定义语义令牌 |
| 整体字号放大一档 | `--hd-type-ui-size` 等文字角色令牌 |
| 换字体 | `--hd-font-sans` |

运行时切换：`lib/theme.ts` 的 `setTheme({ mode, accent })` 只在 `<html>` 上切换 `.dark` 与 `data-accent`，并记在浏览器本地。

## 3. 文字

| 角色 | 类 | 令牌 | 值 |
| --- | --- | --- | --- |
| 页面标题 | `text-xl font-bold` | `--hd-type-title-*` | 32 / 40，字距 −0.75px |
| 区块标题 | `text-lg font-semibold` | `--hd-type-heading-*` | 22 / 28 |
| 卡片、弹窗标题 | `text-sm font-semibold` | `--hd-type-subtitle-*` | 16 / 24 |
| 长段落 | `text-base` | `--hd-type-body-*` | 16 / 24 |
| 界面正文（默认） | `text-xs` | `--hd-type-ui-*` | 14 / 20 |
| 辅助说明 | `text-caption` | `--hd-type-caption-*` | 12 / 16 |

- Tailwind 的 `text-xs`～`text-xl` 已重定为上表角色。shadcn（base-mira）组件大量使用 `text-xs`，因此会随之变成 14px，不必逐个修改组件。
- 字体用系统字体，中文优先苹方、微软雅黑。不加载网络字体，以保证内网可用。字重只用 400、500、600、700。

## 4. 颜色用法

| 用途 | 类 |
| --- | --- |
| 标题、强调文字 | `text-fg-strong` |
| 正文 | `text-fg`（默认） |
| 说明、侧栏 | `text-fg-secondary` |
| 属性名、表头、提示 | `text-fg-muted` |
| 禁用、占位 | `text-fg-disabled` |
| 页面、侧栏、卡片、次级块底色 | `bg-surface-page`、`bg-surface-sidebar`、`bg-surface-raised`、`bg-surface-subtle` |
| 悬停、选中 | `hover:bg-surface-hover`、`bg-surface-selected` |
| 分隔线、输入框边框 | `border-line-subtle`、`border-line` |
| 主按钮、链接 | `bg-brand`（经 shadcn `Button` 默认样式）、`text-brand-text` |
| 提示块底色 | `bg-info-soft`、`bg-warning-soft`、`bg-danger-soft`、`bg-success-soft` |

## 5. 业务状态的标签色

状态一律用 `Tag`（`components/kit/tag.tsx`），颜色从 `lib/tones.ts` 取，保证同一状态在任何页面颜色一致。

| 业务 | 状态 → 颜色 |
| --- | --- |
| 院区运营状态 | 筹建 灰、试运行 蓝、运行 绿、停用 红 |
| 服务单元 | 在用 绿、暂停 黄、已退出 灰 |
| 部门 | 在用 绿、停用 红、弃用 灰、被替代 棕 |
| 变更申请 | 草稿 灰、已提交 蓝、已确认 绿、已退回 橙、已撤销 灰 |
| 演变关系 | 拆分 紫、合并 粉 |

颜色的含义：绿表示在用或生效，黄表示暂停，红表示停用，灰表示未开始或已结束，蓝表示进行中。`Badge` 只用于计数和附注。

## 6. 组件

- **shadcn/ui（Base UI，base-mira）**：经桥接层自动套用令牌。只有 Badge、Button（xs）、NativeSelect（sm）三处原写死 10px 字号，已改为 `text-caption`。
- **合并类名**：`cn()`（`lib/utils.ts`）已登记自定义字号 `text-caption`。新增令牌字号时要同步登记，否则 tailwind-merge 会把它当成颜色类误删。
- **自建组件 `components/kit/`**：
  - `Tag`：Notion 彩色标签。
  - `Callout`：提示块，无边框、浅底色、左侧图标。
  - `PropertyList`：对象详情页顶部的属性列表。
  - `database`：列表页的数据库视图基本件，见第 8 节。
- **按钮**：一屏只放一个主按钮，其余用 `outline`、`ghost`。危险操作用 `destructive`（浅红底）。
- **表格**：采用 Notion 数据库式。无外框、只有横线分隔，表头为灰色常规字重，行悬停有底色。代码用等宽字体，状态用 Tag。

## 7. 应用外壳（`components/layout.tsx`）

- **左侧栏**：宽 240（`--hd-sidebar-width`），底色 `bg-surface-sidebar`。
  - 顶部是工作区名，悬停时出现收起按钮；窄屏（小于 768px）默认收起。
  - 导航分两组：“主数据”（服务单元、部门、院区、主体）和“治理”（变更申请，右侧数字是待确认的申请数）。
  - 底部依次是设计规范、深色/浅色切换、当前用户（开发期身份）。
  - 导航项高 28，悬停用叠加色，选中用 `bg-surface-selected`。
- **顶栏**：高 44（`--hd-topbar-height`）。
  - 左边是面包屑：一级取自导航项，详情页用 `useCrumb()` 补上对象名。
  - 右边是全局“查看日期”。不是今天时整块用黄色标签色高亮，并出现“回到今天”。
- **正文**：列表页最宽 1200（`--hd-page-wide-max-width`）。页头用 `PageHeader`：图标、32px 粗体标题、一句说明、右上角的操作。

## 8. 列表页 = Notion 数据库视图（`components/kit/database.tsx`）

- **工具栏**（`DbToolbar`）：
  - 左边放筛选胶囊 `FilterPill`。未选时显示“院区 ▾”；选中后变为强调色浅底，显示“院区：高新院区 ×”。
  - 开关胶囊 `ToggleChip`（如“含计划中”）也放左边。
  - 右边是搜索框 `SearchBox`，无边框，悬停或聚焦时显示底色。
- **筛选条件写在地址栏**（如 `?campus=8&type=IPD`），可以收藏和分享。
- **表格**（`DbTable` / `DbRow` / `DbCell`）：
  - 表头带图标、灰色、常规字重；列之间用细竖线，行之间用横线；行悬停有底色。
  - 第一列是名称，可点击进入详情。代码用等宽字体；状态用 Tag。
- **底部**（`DbFooter`）：显示计数和口径说明。
- **空状态**（`DbEmpty`）：一句说明和一个操作，不画插图。
- **页头操作**：“导出 CSV”用幽灵按钮，“新建”是主按钮。导出调用 `lib/download.ts`，按二进制保存以保留 BOM。

## 9. 检查清单

| 要 | 不要 |
| --- | --- |
| 只用令牌生成的类 | 写色值或任意值（`#0075de`、`text-[13px]`、`shadow-[…]`） |
| 悬停、选中用 `bg-surface-hover`、`bg-surface-selected` | 每处另配一个灰色 |
| 状态用 Tag，颜色从 `lib/tones.ts` 取 | 页面里引用原始令牌（`--hd-blue-600`） |
| 详情页顶部用属性列表，说明用 Callout | 用颜色作为唯一信息；装饰性动效、渐变、大面积彩色底 |
