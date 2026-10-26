// /design：统一 UI 视觉规范（Notion 风格）。展示全部设计令牌与组件在令牌下的样子。
// 本页自身也只用令牌，并示范应用外壳：左侧栏 + 顶栏面包屑 + 900 宽正文。
import { DateInput } from '@/components/kit/date-input'
import { Icon, type AppIcon } from '@/components/kit/icon'
import {
  Activity01Icon,
  Add01Icon,
  BookOpen01Icon,
  Building03Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  ColorsIcon,
  Cursor01Icon,
  DashboardSquare01Icon,
  DropletIcon,
  File01Icon,
  GridViewIcon,
  Hospital01Icon,
  InformationCircleIcon,
  Layers01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  Search01Icon,
  Sun03Icon,
  Table01Icon,
  Tag01Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Callout } from '@/components/kit/callout'
import { PropertyList } from '@/components/kit/property-list'
import { Tag, TONES, type Tone } from '@/components/kit/tag'
import { DbCell, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip } from '@/components/kit/database'
import { Segmented } from '@/components/kit/segmented'
import { FrameSample } from '@/components/layout'
import { TagInput } from '@/components/kit/tag-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { CHANGE_STATUS, DEPARTMENT_LIFECYCLE, OPERATING_STATUS, UNIT_STATUS } from '@/lib/format'
import { setTheme, useTheme, type Accent } from '@/lib/theme'
import {
  CHANGE_STATUS_TONE,
  DEPARTMENT_LIFECYCLE_TONE,
  LINEAGE_TONE,
  OPERATING_STATUS_TONE,
  UNIT_STATUS_TONE,
} from '@/lib/tones'
import { cn, scrollBehavior } from '@/lib/utils'

const SECTIONS: { id: string; label: string; icon: AppIcon }[] = [
  { id: 'overview', label: '概览', icon: BookOpen01Icon },
  { id: 'v1', label: '统一规范 v1.0 落地', icon: CheckmarkCircle02Icon },
  { id: 'color', label: '语义颜色', icon: ColorsIcon },
  { id: 'palette', label: '原始色板', icon: DropletIcon },
  { id: 'type', label: '文字', icon: TextFontIcon },
  { id: 'space', label: '间距与圆角', icon: GridViewIcon },
  { id: 'elevation', label: '阴影与层级', icon: Layers01Icon },
  { id: 'motion', label: '动效', icon: Activity01Icon },
  { id: 'controls', label: '按钮与输入', icon: Cursor01Icon },
  { id: 'tags', label: '标签与状态', icon: Tag01Icon },
  { id: 'blocks', label: '提示与属性', icon: InformationCircleIcon },
  { id: 'table', label: '表格', icon: Table01Icon },
  { id: 'overlay', label: '弹窗与空状态', icon: DashboardSquare01Icon },
  { id: 'rules', label: '使用规则', icon: CheckmarkCircle02Icon },
]

const SECTION_IDS = SECTIONS.map((s) => s.id)

export function DesignPage() {
  const active = useScrollSpy(SECTION_IDS)
  return (
    <div className="bg-surface-page text-fg flex h-svh">
      <Sidebar active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="design-scroll" className="flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-(--hd-page-max-width) px-(--hd-page-padding-x-narrow) pt-12 pb-32">
            <Overview />
            <SpecV1Section />
            <ColorSection />
            <PaletteSection />
            <TypeSection />
            <SpaceSection />
            <ElevationSection />
            <MotionSection />
            <ControlsSection />
            <TagsSection />
            <BlocksSection />
            <TableSection />
            <OverlaySection />
            <RulesSection />
          </article>
        </main>
      </div>
    </div>
  )
}

// ================================================================== 外壳
function Sidebar({ active }: { active: string }) {
  return (
    <aside className="bg-surface-sidebar border-line-subtle hidden w-(--hd-sidebar-width) shrink-0 flex-col border-r md:flex">
      <Link
        to="/"
        title="返回应用"
        className="hover:bg-surface-hover mx-2 mt-2 flex h-8 items-center gap-2 rounded-md px-2 transition-colors duration-(--hd-duration-fast)"
      >
        <span className="bg-fg-strong text-surface-page grid size-5 place-items-center rounded-sm text-caption font-semibold">
          H
        </span>
        <span className="text-fg-strong truncate text-xs font-medium">HDIP 主数据维护</span>
      </Link>
      <div className="text-fg-muted hover:bg-surface-hover mx-2 mt-1 flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-(--hd-duration-fast)">
        <Icon icon={Search01Icon} className="size-4" strokeWidth={1.75} />
        搜索
      </div>
      <div className="text-fg-muted mt-4 px-4 pb-1 text-caption font-medium">设计规范</div>
      <nav className="grid gap-px px-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: scrollBehavior() })}
            className={cn(
              'flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors duration-(--hd-duration-fast)',
              active === s.id
                ? 'bg-surface-selected text-fg-strong font-medium'
                : 'text-fg-secondary hover:bg-surface-hover',
            )}
          >
            <Icon icon={s.icon} className="size-4 shrink-0" strokeWidth={1.75} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="text-fg-muted mt-auto px-4 py-3 text-caption">令牌文件 styles/tokens.css</div>
    </aside>
  )
}

const ACCENTS: { value: Accent; label: string }[] = [
  { value: 'blue', label: '蓝（默认）' },
  { value: 'purple', label: '紫' },
  { value: 'teal', label: '青' },
]

function Topbar() {
  const theme = useTheme()
  return (
    <header className="flex h-(--hd-topbar-height) shrink-0 items-center gap-2 px-3 text-xs">
      <nav className="text-fg-secondary flex min-w-0 items-center gap-1">
        <span className="hover:bg-surface-hover rounded-sm px-1.5 py-0.5">HDIP</span>
        <span className="text-fg-disabled">/</span>
        <span className="text-fg hover:bg-surface-hover rounded-sm px-1.5 py-0.5">设计规范</span>
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <span className="text-fg-muted hidden sm:inline">强调色</span>
        <NativeSelect
          size="sm"
          value={theme.accent}
          onChange={(e) => setTheme({ accent: e.target.value as Accent })}
          aria-label="强调色"
        >
          {ACCENTS.map((a) => (
            <NativeSelectOption key={a.value} value={a.value}>
              {a.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme({ mode: theme.mode === 'dark' ? 'light' : 'dark' })}
        >
          <Icon icon={theme.mode === 'dark' ? Sun03Icon : Moon02Icon} inline="start" />
          {theme.mode === 'dark' ? '浅色' : '深色'}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="更多">
          <Icon icon={MoreHorizontalIcon} />
        </Button>
      </div>
    </header>
  )
}

/** 当前阅读的区块：最后一个顶部已滚过正文区上沿（留 96px）的区块 */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const root = document.getElementById('design-scroll')
    if (!root) return
    const update = () => {
      const top = root.getBoundingClientRect().top + 96
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= top) current = id
      }
      // 滚到底时最后几个短区块可能到不了上沿，直接算最后一个
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = ids[ids.length - 1]
      setActive(current)
    }
    update()
    root.addEventListener('scroll', update, { passive: true })
    return () => root.removeEventListener('scroll', update)
  }, [ids])
  return active
}

// ================================================================== 小件
function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 pt-12">
      <h2 className="text-fg-strong text-lg font-semibold tracking-(--hd-type-heading-tracking)">{title}</h2>
      {description && <p className="text-fg-secondary mt-1 text-xs">{description}</p>}
      <div className="mt-4 grid gap-6">{children}</div>
    </section>
  )
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-fg-strong text-xs font-semibold">{children}</h3>
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-subtle text-danger-text rounded-sm px-1 py-px font-mono text-caption">{children}</code>
  )
}

/** 读取令牌在当前主题下的计算值；切换主题后自动刷新 */
function useTokenValue(name: string): string {
  const theme = useTheme()
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim())
  }, [name, theme.mode, theme.accent])
  return value
}

function TokenValue({ name }: { name: string }) {
  const value = useTokenValue(name)
  return <span className="text-fg-muted font-mono text-caption">{value}</span>
}

/** 表格样式的行容器（Notion 数据库表格的极简形态） */
function Rows({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-line-subtle text-fg-muted border-y text-left">
            {head.map((h) => (
              <th key={h} className="h-8 px-2 font-normal whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-line-subtle hover:bg-surface-hover border-b transition-colors duration-(--hd-duration-fast)">
      {children}
    </tr>
  )
}

function Cell({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('h-9 px-2 align-middle', className)}>{children}</td>
}

// ================================================================== 概览
function Overview() {
  return (
    <section id="overview">
      <div className="text-fg-muted mb-3">
        <Icon icon={PaintBoardIcon} className="size-14" strokeWidth={1.25} />
      </div>
      <h1 className="text-fg-strong text-xl font-bold tracking-(--hd-type-title-tracking)">统一 UI 视觉规范</h1>
      <div className="mt-4">
        <PropertyList
          items={[
            {
              label: '风格',
              icon: PaintBoardIcon,
              value: '统一规范 v1.0：暖灰侧栏 + 白色工作面、共享左边线、连续行、名称先于代码；色彩只表达业务语义',
            },
            { label: '令牌文件', icon: File01Icon, value: <Code>web/src/styles/tokens.css</Code> },
            {
              label: '规范说明',
              icon: BookOpen01Icon,
              value: (
                <span className="grid gap-0.5">
                  <Code>docs/design/ui-tokens.md</Code>
                  <span className="text-fg-muted text-caption">
                    唯一规范入口；场景 ui-scenarios.md，实施 ui-implementation-plan.md，迁移 ui-migration-matrix.md
                  </span>
                </span>
              ),
            },
            {
              label: '参考材料',
              icon: InformationCircleIcon,
              value: 'notion-design-md.md（历史抽取，不约束应用）；Gr8r Studio 904205c（布局方法）',
            },
            { label: '组件底层', icon: Layers01Icon, value: 'shadcn/ui Base UI（base-mira）+ hugeicons' },
            { label: '更新', icon: Calendar03Icon, value: '2026-10-25（U0 规范接入、U1 变更申请列表、U2 全部列表页、U3 详情、表单与复杂核对）' },
          ]}
        />
      </div>
      <div className="mt-6 grid gap-3">
        <Callout tone="info" title="令牌分三层，改一处全局生效">
          原始令牌（色板、字号阶、圆角阶）→ 语义令牌（文字、表面、边框、强调、标签）→ 桥接到 shadcn 变量与 Tailwind 类。
          页面和组件只用语义令牌；右上角切换深色或强调色，就是在重定义语义令牌。
        </Callout>
      </div>
    </section>
  )
}

// ================================================================== 统一规范 v1.0 落地状态（U0）
type Stage = 'done' | 'ready' | 'todo'
const STAGE: Record<Stage, { label: string; tone: Tone }> = {
  done: { label: '已实施', tone: 'green' },
  ready: { label: '令牌已就绪', tone: 'blue' },
  todo: { label: '待实施', tone: 'gray' },
}

/** 规范里的每条目标在源码中走到了哪一步：只写真实状态，未迁移的页面不算完成 */
const SPEC_ROWS: { rule: string; target: string; stage: Stage; note: string; sample?: ReactNode }[] = [
  {
    rule: 'R-LAY 页面外框',
    target: 'work 净宽 ≤1440 / document ≤900 / canvas 不设上限；共享 gutter 24（<768 为 16）',
    stage: 'done',
    note: 'U1、U2：全部列表页 work；U3：主体、院区、服务单元、部门、人员详情与规划页 document，变更申请详情 work，组织总览 canvas。本页（/design）有自己的外壳，不套外框',
  },
  {
    rule: 'R-TYP 工作页标题',
    target: '24/32 · 600 · 字距 0',
    stage: 'done',
    note: 'U3 起 PageHeader 按外框取标题角色：work / canvas 24/32，document 用文档标题 32/40（字距 0）',
    sample: <span className="text-fg-strong text-work-title font-semibold">变更申请</span>,
  },
  {
    rule: 'R-TYP 章节标题',
    target: '16/24 · 600',
    stage: 'done',
    note: 'U3：有外框的页面里 Section 标题、申请核对的组标题都用 text-section',
    sample: <span className="text-fg-strong text-section font-semibold">所属关系</span>,
  },
  {
    rule: 'R-TYP 正文与辅助',
    target: '正文 14/20，辅助 12/16；text-xs 映射为 14px 不变',
    stage: 'done',
    note: '沿用现有桥接',
  },
  {
    rule: 'R-ROW 行高',
    target: '标准行 ≥44 / 显式紧凑 ≥36 / 双行工作列表 ≥64；表头 36；单元格内边距 12',
    stage: 'done',
    note: 'U2 起声明了外框的页面里 DbTable 自动用规范行高（表头 36、行 ≥44、单元格左右 12）；U3 后全部业务页都已声明外框',
    sample: (
      <span className="grid w-56 gap-1">
        <span className="border-line-subtle bg-surface-subtle flex min-h-(--hd-row-height-compact) items-center border px-(--hd-cell-padding-x) text-caption">紧凑 36</span>
        <span className="border-line-subtle bg-surface-subtle flex min-h-(--hd-row-height) items-center border px-(--hd-cell-padding-x) text-caption">标准 44</span>
        <span className="border-line-subtle bg-surface-subtle flex min-h-(--hd-work-row-min-height) items-center border px-(--hd-cell-padding-x) text-caption">双行工作列表 64</span>
      </span>
    ),
  },
  {
    rule: 'R-ROW 双行工作列表',
    target: '三列：变更概要（≥一半宽）/ 状态 / 最近处理；行 ≥64；只用横线',
    stage: 'done',
    note: 'U1：变更申请列表。第一行是服务端“对象 · 变化”摘要（项目决定）；第二行编号、申请人、项数、说明；处理时间写相对说法，精确时间在详情',
  },
  {
    rule: 'C-03 单选状态导航',
    target: '互斥状态用单选；保留真实状态名；可从网址恢复',
    stage: 'done',
    note: 'kit/segmented（radiogroup）；变更申请列表：全部 / 待我确认 / 我的草稿 | 各状态',
  },
  {
    rule: 'R-ROW 表格边线',
    target: '默认只用横线；矩阵、逐列对照显式启用竖线',
    stage: 'done',
    note: '列表与详情只用横线；申请里的字段前后对照用 variant="compare" 画竖线。本页“表格”一节仍是旧样式',
  },
  {
    rule: 'R-COL 主按钮状态色',
    target: 'default / hover / pressed 用明确色阶；深色主题浅底深字；18 组 ≥4.5:1',
    stage: 'done',
    note: 'U3：hover / pressed 改用语义状态色；浅色 600 / 700 / 800 + 白字，深色 300 / 200 / 400 + gray-900，深色与强调色组合单独声明；实测六组 4.57～10.39',
  },
  {
    rule: 'C-08 控件尺寸',
    target: '常规 32 / 行内 28 / 触控主要 44',
    stage: 'done',
    note: 'U3：按钮 32 / 行内 28、输入框与下拉 32、搜索与筛选胶囊 32、单选分段 32、侧栏导航行 32，都引用 --hd-control-height*；触控 44 待移动端',
  },
  {
    rule: 'R-COL 业务状态色',
    target: '计划浅黄、停用红、结束灰；状态 / 分类 / 图表三套分开',
    stage: 'done',
    note: '沿用 lib/tones.ts，本次不改',
  },
  {
    rule: 'C-06 属性与引用',
    target: '属性名 128px、窄屏上下排；对象引用写名称；空值写“未登记”',
    stage: 'done',
    note: 'U3：PropertyList 在有外框的页面里自动切换（不画装饰图标、不加悬停底色）；轻量操作 InlineAction 为 28px 真实按钮',
  },
  {
    rule: 'R-ACT 表单校验与离开',
    target: '错误一次全部标出、聚焦第一个，改到通过才清除；有输入时关闭先确认一次',
    stage: 'done',
    note: 'U3：ItemDialog 改动后按 build() 重新检查；“继续填写 / 放弃并关闭”；关闭后焦点回到触发按钮。U3R-01：build() 为纯函数、提交未通过才 reveal 定位；标签 ×、选项胶囊、增删后继也算改动；保存中不关闭、不重复保存，失败保留输入与请求键',
  },
  {
    rule: 'R-STATE 读取状态',
    target: '首次读取不写 0；失败不说成空；403 / 401 / 404 / 临时故障分开；同键刷新失败保留并标出；部分失败只影响所在区块',
    stage: 'done',
    note: 'U3：DetailFallback 六个详情页共用。U3R-03：kit/read-state 接入八个列表、编码明细与批量、组织总览、详情附属区；走查用受控响应。向导读取留 U3R-04',
  },
  {
    rule: 'R-ACT 7.4 核对定位与组尾核对',
    target: '问题按显示行归属（covered_by）计数与跳转；跳转只展开目标所在组；“我已核对”在组尾',
    stage: 'done',
    note: 'U3R-02：51 行与并入项用受控样本、门槛用真实草稿走查；减少动效偏好只按代码核对',
  },
  {
    rule: 'C-04 批量选择范围',
    target: '同一查看日期跨搜索、筛选、表 / 树保留所选部门；名单可查看与逐条取消；改日期或身份即清空',
    stage: 'done',
    note: 'U3R-02：部门列表；选择条、名单、两个批量表单用同一集合。其他页面的选择未改',
  },
]

function SpecV1Section() {
  return (
    <Section
      id="v1"
      title="统一规范 v1.0 落地状态"
      description="docs/design/ui-tokens.md 的目标在源码中走到了哪一步。“令牌已就绪”= 令牌与类已定义，页面迁移时才使用；业务页面已按 U1 → U2 → U3 全部迁移，U4 按需逐项推进。"
    >
      <Rows head={['规则', '目标', '状态', '说明与样例']}>
        {SPEC_ROWS.map((r) => (
          <Row key={r.rule}>
            <Cell className="text-fg-strong font-medium whitespace-nowrap">{r.rule}</Cell>
            <Cell className="text-fg-secondary">{r.target}</Cell>
            <Cell>
              <Tag tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Tag>
            </Cell>
            <Cell>
              <span className="grid gap-1.5">
                <span className="text-fg-muted text-caption">{r.note}</span>
                {r.sample}
              </span>
            </Cell>
          </Row>
        ))}
      </Rows>
    </Section>
  )
}

// ================================================================== 颜色
const SEMANTIC_GROUPS: { title: string; items: { token: string; cls: string; use: string; text?: boolean }[] }[] = [
  {
    title: '文字',
    items: [
      { token: '--hd-text-strong', cls: 'text-fg-strong', use: '标题、强调', text: true },
      { token: '--hd-text-primary', cls: 'text-fg', use: '正文（默认）', text: true },
      { token: '--hd-text-secondary', cls: 'text-fg-secondary', use: '说明、侧栏', text: true },
      { token: '--hd-text-muted', cls: 'text-fg-muted', use: '属性名、表头、提示', text: true },
      { token: '--hd-text-placeholder', cls: 'placeholder:text-fg-placeholder', use: '输入与搜索的占位提示（同 muted 的值，独立角色）', text: true },
      { token: '--hd-text-disabled', cls: 'text-fg-disabled', use: '只给真正禁用的控件；占位、空态、事实文字不用它', text: true },
    ],
  },
  {
    title: '表面',
    items: [
      { token: '--hd-surface-page', cls: 'bg-surface-page', use: '页面主体' },
      { token: '--hd-surface-sidebar', cls: 'bg-surface-sidebar', use: '左侧栏' },
      { token: '--hd-surface-raised', cls: 'bg-surface-raised', use: '卡片、弹窗、下拉' },
      { token: '--hd-surface-subtle', cls: 'bg-surface-subtle', use: '次级块、代码、只读区' },
      { token: '--hd-surface-hover', cls: 'bg-surface-hover', use: '悬停（叠加）' },
      { token: '--hd-surface-selected', cls: 'bg-surface-selected', use: '选中的导航项' },
      { token: '--hd-surface-input', cls: 'bg-input-bg', use: '输入、选择、标签输入的底色' },
    ],
  },
  {
    title: '边框',
    items: [
      { token: '--hd-border-subtle', cls: 'border-line-subtle', use: '分隔线、表格线' },
      { token: '--hd-border-default', cls: 'border-line', use: '卡片、容器、次级按钮' },
      { token: '--hd-border-input', cls: 'border-input', use: '可填写区域的边界（对输入底 ≥3:1）' },
      { token: '--hd-border-strong', cls: 'border-line-strong', use: '强调的分隔' },
    ],
  },
  {
    title: '强调',
    items: [
      { token: '--hd-accent', cls: 'bg-brand', use: '主按钮、选中' },
      { token: '--hd-accent-hover', cls: 'bg-brand-hover', use: '主按钮悬停' },
      { token: '--hd-accent-soft', cls: 'bg-brand-soft', use: '选中底色' },
      { token: '--hd-accent-muted', cls: 'bg-brand-muted', use: '极浅强调底色' },
      { token: '--hd-accent-text', cls: 'text-brand-text', use: '链接', text: true },
      { token: '--hd-focus-ring', cls: 'outline-(--hd-focus-ring)', use: '键盘焦点：2px 实色轮廓、外移 2px' },
    ],
  },
  {
    title: '反馈',
    items: [
      { token: '--hd-danger', cls: 'bg-danger', use: '危险操作' },
      { token: '--hd-danger-text', cls: 'text-danger-text', use: '错误说明、危险按钮文字', text: true },
      { token: '--hd-danger-soft', cls: 'bg-danger-soft', use: '错误提示底、危险按钮底' },
      { token: '--hd-warning-text', cls: 'text-warning-text', use: '提醒文字', text: true },
      { token: '--hd-warning-soft', cls: 'bg-warning-soft', use: '警告提示底' },
      { token: '--hd-success-soft', cls: 'bg-success-soft', use: '成功提示底' },
      { token: '--hd-info-soft', cls: 'bg-info-soft', use: '说明提示底' },
    ],
  },
]

function ColorSection() {
  return (
    <Section
      id="color"
      title="语义颜色"
      description="页面与组件只用这一层。右侧是当前主题下的实际值，切换深色、强调色后自动更新。"
    >
      {SEMANTIC_GROUPS.map((g) => (
        <div key={g.title} className="grid gap-2">
          <SubTitle>{g.title}</SubTitle>
          <Rows head={['', '令牌', 'Tailwind 类', '用途', '当前值']}>
            {g.items.map((i) => (
              <Row key={i.token}>
                <Cell className="w-12">
                  {i.text ? (
                    <span className="text-sm font-semibold" style={{ color: `var(${i.token})` }}>
                      文
                    </span>
                  ) : (
                    <span
                      className="border-line-subtle block size-6 rounded-sm border"
                      style={{ background: `var(${i.token})` }}
                    />
                  )}
                </Cell>
                <Cell>
                  <Code>{i.token}</Code>
                </Cell>
                <Cell className="text-fg-secondary font-mono text-caption">{i.cls}</Cell>
                <Cell className="text-fg-secondary">{i.use}</Cell>
                <Cell>
                  <TokenValue name={i.token} />
                </Cell>
              </Row>
            ))}
          </Rows>
        </div>
      ))}
    </Section>
  )
}

function DesignToolbar() {
  const [pill, setPill] = useState('ACTIVE')
  const [chip, setChip] = useState(true)
  const [q, setQ] = useState('')
  const [tags, setTags] = useState<string[]>(['门诊'])
  const [view, setView] = useState<'table' | 'tree' | 'flow'>('table')
  return (
    <div className="grid gap-3">
      <DbToolbar right={<SearchBox value={q} onChange={setQ} placeholder="名称、拼音码或代码" />}>
        <Segmented
          label="视图"
          value={view}
          onChange={setView}
          options={[
            { value: 'table', label: '表格' },
            { value: 'tree', label: '层级树' },
            { value: 'flow', label: '关系图' },
          ]}
        />
        <FilterPill
          label="生命周期"
          value={pill}
          onChange={setPill}
          options={Object.entries(DEPARTMENT_LIFECYCLE).map(([value, label]) => ({ value, label }))}
        />
        <ToggleChip label="含计划中" checked={chip} onChange={setChip} />
      </DbToolbar>
      <div className="max-w-sm">
        <TagInput label="承担职责" value={tags} onChange={setTags} />
      </div>
    </div>
  )
}

const FAMILIES = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red']
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

function PaletteSection() {
  return (
    <Section
      id="palette"
      title="原始色板"
      description={
        <>
          只供语义令牌引用，页面里不直接使用。名称 <Code>--hd-色系-级</Code>，取自来源文档同名变量。
        </>
      }
    >
      <div className="grid gap-1.5">
        {FAMILIES.map((f) => (
          <div key={f} className="grid grid-cols-[4rem_repeat(9,1fr)] items-center gap-1.5">
            <span className="text-fg-muted text-caption">{f}</span>
            {STEPS.map((s) => (
              <span
                key={s}
                title={`--hd-${f}-${s}`}
                className="border-line-subtle h-7 rounded-sm border"
                style={{ background: `var(--hd-${f}-${s})` }}
              />
            ))}
          </div>
        ))}
        <div className="text-fg-muted grid grid-cols-[4rem_repeat(9,1fr)] gap-1.5 text-center text-caption">
          <span />
          {STEPS.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </Section>
  )
}

// ================================================================== 文字
const TYPE_ROLES = [
  { role: '页面标题', token: '--hd-type-title-size', cls: 'text-xl font-bold', sample: '服务单元', style: 'tracking-(--hd-type-title-tracking)' },
  { role: '区块标题', token: '--hd-type-heading-size', cls: 'text-lg font-semibold', sample: '版本时间线', style: 'tracking-(--hd-type-heading-tracking)' },
  { role: '卡片 / 弹窗标题', token: '--hd-type-subtitle-size', cls: 'text-sm font-semibold', sample: '新建服务单元', style: '' },
  { role: '长段落', token: '--hd-type-body-size', cls: 'text-base', sample: '服务单元是部门在明确院区和运营主体期间内开展服务的运营组织。', style: '' },
  { role: '界面正文（默认）', token: '--hd-type-ui-size', cls: 'text-xs', sample: '按钮、输入框、表格、属性、导航都用这一档。', style: '' },
  { role: '辅助说明', token: '--hd-type-caption-size', cls: 'text-caption', sample: '代码一经使用永久绑定，退出后也不复用。', style: '' },
]

function TypeSection() {
  return (
    <Section
      id="type"
      title="文字"
      description="系统字体（中文优先苹方 / 微软雅黑），不加载网络字体。应用内正文 14px；字重只用 400 / 500 / 600 / 700。"
    >
      <Rows head={['角色', '示例', '类', '字号']}>
        {TYPE_ROLES.map((t) => (
          <Row key={t.role}>
            <Cell className="text-fg-muted w-32 whitespace-nowrap">{t.role}</Cell>
            <Cell className="py-2">
              <span className={cn('text-fg-strong', t.cls, t.style)}>{t.sample}</span>
            </Cell>
            <Cell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{t.cls}</Cell>
            <Cell className="whitespace-nowrap">
              <TokenValue name={t.token} />
            </Cell>
          </Row>
        ))}
      </Rows>
      <div className="grid gap-2">
        <SubTitle>文字色阶</SubTitle>
        <p className="text-xs">
          <span className="text-fg-strong font-semibold">成都市第三人民医院</span>
          <span className="text-fg"> · 高新院区 · </span>
          <span className="text-fg-secondary">自 2026-10-01 起 · </span>
          <span className="text-fg-muted">第 2 版 · </span>
          <span className="text-fg-disabled">未填写</span>
          <span className="text-fg"> · </span>
          <a className="text-brand-text underline decoration-current/40 underline-offset-2 hover:decoration-current" href="#type">
            查看变更申请 #12
          </a>
        </p>
      </div>
    </Section>
  )
}

// ================================================================== 间距与圆角
const SPACES = [4, 8, 12, 16, 24, 32, 48, 64, 96]
const RADII = [
  { token: '--hd-radius-tag', label: '标签', cls: 'rounded-sm' },
  { token: '--hd-radius-control', label: '按钮 / 输入', cls: 'rounded-md' },
  { token: '--hd-radius-card', label: '卡片', cls: 'rounded-lg' },
  { token: '--hd-radius-popover', label: '弹窗 / 下拉', cls: 'rounded-xl' },
  { token: '--hd-radius-pill', label: '胶囊', cls: 'rounded-full' },
]

function SpaceSection() {
  return (
    <Section
      id="space"
      title="间距与圆角"
      description="间距基数 4px，用 Tailwind 的间距类（p-2 = 8px）；布局尺寸是语义令牌：侧栏 240、顶栏 44、正文 900。"
    >
      <div className="grid gap-1.5">
        {SPACES.map((s) => (
          <div key={s} className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <Code>--hd-space-{s}</Code>
            <span className="bg-brand-soft h-3 rounded-sm" style={{ width: `var(--hd-space-${s})` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {RADII.map((r) => (
          <div key={r.token} className="grid justify-items-center gap-2 text-center">
            <span className={cn('bg-surface-subtle border-line size-16 border', r.cls)} />
            <span className="text-xs">{r.label}</span>
            <span className="text-fg-muted font-mono text-caption">{r.cls}</span>
            <TokenValue name={r.token} />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ================================================================== 阴影与层级
function ElevationSection() {
  const levels = [
    { token: '--hd-elevation-card', cls: 'shadow-sm', label: '卡片 / 悬浮行' },
    { token: '--hd-elevation-popover', cls: 'shadow-md', label: '下拉 / 菜单' },
    { token: '--hd-elevation-dialog', cls: 'shadow-lg', label: '对话框' },
  ]
  return (
    <Section
      id="elevation"
      title="阴影与层级"
      description="多层极淡阴影，几乎看不出边缘；深色主题改用 1px 亮边。层级：sticky 90、下拉 100、弹窗 1000。"
    >
      <div className="bg-surface-subtle grid gap-6 rounded-lg p-8 sm:grid-cols-3">
        {levels.map((l) => (
          <div key={l.token} className={cn('bg-surface-raised grid h-28 content-center gap-1 rounded-lg p-4', l.cls)}>
            <span className="text-fg-strong text-xs font-medium">{l.label}</span>
            <span className="text-fg-muted font-mono text-caption">{l.cls}</span>
            <Code>{l.token}</Code>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ================================================================== 动效
function MotionSection() {
  const items = [
    { token: '--hd-duration-instant', label: '瞬时 75ms', use: '按下反馈' },
    { token: '--hd-duration-fast', label: '快 100ms', use: '悬停底色' },
    { token: '--hd-duration-base', label: '标准 200ms', use: '弹窗、阴影、展开' },
  ]
  return (
    <Section id="motion" title="动效" description="动效只用于反馈，不做装饰。悬停换底色用快档；弹层出现用标准档，缓动 ease。把鼠标移到下面的块上。">
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((m) => (
          <div
            key={m.token}
            className="border-line hover:bg-brand-soft grid gap-1 rounded-lg border p-4 transition-colors ease-(--hd-ease-standard)"
            style={{ transitionDuration: `var(${m.token})` }}
          >
            <span className="text-fg-strong text-xs font-medium">{m.label}</span>
            <span className="text-fg-secondary text-xs">{m.use}</span>
            <Code>{m.token}</Code>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ================================================================== 按钮与输入
function ControlsSection() {
  return (
    <Section
      id="controls"
      title="按钮与输入"
      description="一屏只放一个主按钮（强调色）；其余用描边或幽灵按钮。危险操作用浅红底，不用实心红。"
    >
      <div className="grid gap-3">
        <SubTitle>按钮</SubTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button>提交</Button>
          <Button variant="outline">保存草稿</Button>
          <Button variant="secondary">复制为新草稿</Button>
          <Button variant="ghost">取消</Button>
          <Button variant="destructive">永久退出</Button>
          <Button variant="link">查看申请</Button>
          <Button disabled>确认生效</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">
            <Icon icon={Add01Icon} inline="start" />
            新建
          </Button>
          <Button>默认</Button>
          <Button size="lg">大号</Button>
          <Button variant="outline" size="icon" aria-label="更多">
            <Icon icon={MoreHorizontalIcon} />
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="d-code">
            单元代码<span className="text-danger-text">*</span>
          </FieldLabel>
          <Input id="d-code" placeholder="例如 XNK-GX-OPD" />
          <FieldDescription>一经使用永久绑定，退出后也不复用</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="d-type">单元类型</FieldLabel>
          <NativeSelect id="d-type" className="w-full" defaultValue="OPD">
            <NativeSelectOption value="OPD">门诊单元（OPD）</NativeSelectOption>
            <NativeSelectOption value="IPD">住院单元（IPD）</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="d-date">生效日期</FieldLabel>
          <DesignDate id="d-date" initial="2026-10-14" />
        </Field>
        <Field>
          <FieldLabel htmlFor="d-bad">院区代码</FieldLabel>
          <Input id="d-bad" aria-invalid defaultValue="高新" />
          <FieldDescription className="text-danger-text">只能用字母、数字、点、下划线、短横线</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="d-dis">运营主体（只读）</FieldLabel>
          <Input id="d-dis" disabled defaultValue="CD3 成都市第三人民医院" />
        </Field>
        <Field>
          <FieldLabel htmlFor="d-note">变更说明</FieldLabel>
          <Textarea id="d-note" placeholder="为什么做这次变更（可选）" />
        </Field>
      </div>
      <div className="grid gap-2">
        <SubTitle>工具栏控件（键盘 Tab 进入看焦点轮廓；分段单选用方向键切换）</SubTitle>
        <FrameSample frame="work">
          <DesignToolbar />
        </FrameSample>
        <p className="text-fg-muted text-caption">
          占位提示用 placeholder 角色，不借 disabled；透明的筛选胶囊、搜索框、标签输入在可见外层显示焦点。
        </p>
      </div>
      <div className="grid gap-2">
        <SubTitle>危险操作与错误</SubTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive">放弃并关闭</Button>
          <Badge variant="destructive">2 处问题</Badge>
          {/* 菜单里的危险项：文字与图标 danger-text，键盘高亮 danger-soft（R-COL 4.5） */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>更多</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>复制为新草稿</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">撤销申请</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Alert variant="destructive">
          <AlertTitle>退回申请需要写明原因</AlertTitle>
          <AlertDescription>说明不再额外淡化，与标题同为危险文字色。</AlertDescription>
        </Alert>
      </div>
      <div className="grid gap-2">
        <SubTitle>辅助文字在不同表面上</SubTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['bg-surface-page', '页面'],
            ['bg-surface-subtle', '表头、只读区'],
            ['bg-surface-raised', '弹窗、关系图节点'],
          ].map(([bg, name]) => (
            <div key={bg} className={cn('border-line-subtle grid gap-0.5 rounded-md border px-3 py-2', bg)}>
              <span className="text-fg text-xs">{name}</span>
              <span className="text-fg-secondary text-caption">次要说明 secondary</span>
              <span className="text-fg-muted font-mono text-caption">D000012 · muted</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <SubTitle>选项卡</SubTitle>
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="draft">草稿</TabsTrigger>
            <TabsTrigger value="submitted">已提交</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs defaultValue="detail">
          <TabsList variant="line">
            <TabsTrigger value="detail">资料</TabsTrigger>
            <TabsTrigger value="timeline">版本时间线</TabsTrigger>
            <TabsTrigger value="lineage">演变关系</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </Section>
  )
}

// ================================================================== 标签与状态
const STATUS_GROUPS: { title: string; labels: Record<string, string>; tones: Record<string, Tone> }[] = [
  { title: '院区运营状态', labels: OPERATING_STATUS, tones: OPERATING_STATUS_TONE },
  { title: '服务单元状态', labels: { ...UNIT_STATUS, RETIRED: '已退出' }, tones: UNIT_STATUS_TONE },
  { title: '部门生命周期', labels: DEPARTMENT_LIFECYCLE, tones: DEPARTMENT_LIFECYCLE_TONE },
  { title: '变更申请状态', labels: CHANGE_STATUS, tones: CHANGE_STATUS_TONE },
  { title: '演变关系', labels: { SPLIT: '拆分', MERGE: '合并' }, tones: LINEAGE_TONE },
]

function TagsSection() {
  return (
    <Section
      id="tags"
      title="标签与状态"
      description={
        <>
          状态一律用彩色标签，颜色从 <Code>lib/tones.ts</Code> 取，同一状态在任何页面颜色一致。绿 = 在用 / 生效，浅黄 = 计划（计划中、筹建、筹备），橙 = 暂停，红 = 停用，灰 = 已结束，蓝 = 进行中。
        </>
      }
    >
      <div className="grid gap-2">
        <SubTitle>九种标签色</SubTitle>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <Tag key={t} tone={t}>
              {t}
            </Tag>
          ))}
        </div>
      </div>
      <Rows head={['业务', '状态与颜色']}>
        {STATUS_GROUPS.map((g) => (
          <Row key={g.title}>
            <Cell className="text-fg-muted w-32 whitespace-nowrap">{g.title}</Cell>
            <Cell className="py-2">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(g.labels).map(([code, label]) => (
                  <Tag key={code} tone={g.tones[code] ?? 'gray'}>
                    {label}
                  </Tag>
                ))}
              </div>
            </Cell>
          </Row>
        ))}
      </Rows>
      <div className="grid gap-2">
        <SubTitle>计数徽标（Badge）</SubTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>3</Badge>
          <Badge variant="secondary">有后续版本</Badge>
          <Badge variant="outline">未生效</Badge>
        </div>
        <p className="text-fg-muted text-caption">Badge 只用于计数和附注；业务状态用 Tag。</p>
      </div>
    </Section>
  )
}

// ================================================================== 提示与属性
function BlocksSection() {
  return (
    <Section id="blocks" title="提示与属性" description="提示块无边框、浅底色、左侧图标；对象详情页顶部用属性列表，而不是表单式网格。">
      <div className="grid gap-2">
        <Callout title="部门暂无版本">按历史日期查询时，部门名称显示为当前名称。</Callout>
        <Callout tone="info" title="保存后为草稿">需在申请页“提交”，再由确认人“确认”后才生效。</Callout>
        <Callout tone="warning" title="按当前数据校验未通过，暂不能提交">
          仍有服务单元依赖，须先对这些单元重新绑定或退出：XNK-GX-OPD 心内科高新门诊（院区 GX 自 2027-01-01 起停用）
        </Callout>
        <Callout tone="danger" title="操作未成功">变更申请 #6 已撤销，不能再提交。</Callout>
        <Callout tone="success" title="已确认生效">变更申请 #5 由 确认人 于 2026-10-14 00:12 确认。</Callout>
      </div>
      <div className="grid gap-2">
        <SubTitle>属性列表</SubTitle>
        <PropertyList
          items={[
            { label: '代码', icon: Tag01Icon, value: <span className="font-mono">XNK-GX-OPD</span> },
            { label: '所属部门', icon: Layers01Icon, value: '心血管内科' },
            { label: '院区', icon: Building03Icon, value: '高新院区' },
            { label: '运营主体', icon: Hospital01Icon, value: '成都市第三人民医院' },
            { label: '状态', icon: CheckmarkCircle02Icon, value: <Tag tone="green">在用</Tag> },
            { label: '期间', icon: Calendar03Icon, value: '2026-10-14 ~ 长期' },
            { label: '电话', icon: InformationCircleIcon, value: null },
          ]}
        />
      </div>
    </Section>
  )
}

// ================================================================== 表格
const SAMPLE_UNITS = [
  { code: 'XNK-GX-OPD', name: '心内科高新门诊', type: '门诊单元', dept: '心血管内科', campus: '高新院区', status: 'ACTIVE', period: '2026-10-14 ~ 长期' },
  { code: 'XNK-GX-IPD', name: '心内科高新病房', type: '住院单元', dept: '心血管内科', campus: '高新院区', status: 'SUSPENDED', period: '2026-12-01 ~ 长期' },
  { code: 'XNK-BY-OPD', name: '心血管内科门诊', type: '门诊单元', dept: '心血管内科', campus: '本部院区', status: 'RETIRED', period: '2020-01-01 ~ 2026-12-31' },
]

const LONG_ROWS = [
  { id: 1, name: '心内科', code: 'D000001', note: '正式履职' },
  { id: 2, name: '呼吸与危重症医学科', code: 'D000002', note: '自 2020-01-01 起；上级：内科（行政视图）' },
  {
    id: 3,
    name: '成都市第三人民医院高新院区心血管内科与呼吸与危重症医学科联合门诊（2027 年起筹备，名称以院发〔2026〕31 号文件为准）',
    code: 'D000003',
    note: '依据：院发〔2026〕31 号；长名称自然换行，不截断、不省略，代码单独一行',
  },
]

const ENGAGEMENT_ROWS: { inst: string; type: string; dept: string; no: string | null; from: string; to: string | null; planned?: boolean }[] = [
  { inst: '成都市第三人民医院医疗集团', type: '外聘专家', dept: '临床研究与医学伦理委员会办公室', no: 'G0912', from: '2025-03-01', to: null },
  { inst: '成都市第三人民医院', type: '合同（人事代理）', dept: '心血管疾病与胸痛急救多学科诊疗中心', no: null, from: '2026-10-01', to: '2026-12-31' },
  { inst: '成都市第三人民医院', type: '在编', dept: '呼吸内科', no: '0731', from: '2027-01-01', to: null, planned: true },
]

function TableSection() {
  return (
    <Section
      id="table"
      title="表格"
      description="Notion 数据库式：无外框、横线分隔、表头灰色常规字重、行悬停底色；代码用等宽字体，状态用标签。"
    >
      <SubTitle>标准行（真实 DbTable：单元格上下 8、左右 12，最小 44；多行内容自然增高）</SubTitle>
      <FrameSample frame="work">
        <DbTable columns={[{ label: '名称', className: 'w-1/2', sortKey: 'name' }, { label: '说明' }]} sort={null} onSort={() => {}}>
          {LONG_ROWS.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-fg-strong font-medium">{r.name}</span>
                  <span className="text-fg-muted font-mono text-caption">{r.code}</span>
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary">{r.note}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      </FrameSample>
      <SubTitle>一人多项任用：一项任用一条共享子行（姓名跨行，缺值占位）</SubTitle>
      <FrameSample frame="work">
        <DbTable columns={[{ label: '姓名' }, { label: '任用' }, { label: '主部门' }, { label: '业务工号' }, { label: '任用期间' }]}>
          {ENGAGEMENT_ROWS.map((e, i) => (
            <DbRow key={e.inst + e.from} className={cn(i < ENGAGEMENT_ROWS.length - 1 && 'border-b-0')}>
              {i === 0 && (
                <td rowSpan={ENGAGEMENT_ROWS.length} className="border-line-subtle border-b px-(--hd-cell-padding-x) py-(--hd-cell-padding-y) align-top">
                  <span className="grid gap-0.5">
                    <span className="text-fg-strong font-medium">欧阳文珺</span>
                    <span className="text-fg-muted text-caption">
                      <span className="font-mono">P000019</span> · 3 项任用
                    </span>
                  </span>
                </td>
              )}
              <DbCell>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-fg-secondary">{e.inst}</span>
                  <Tag tone="gray">{e.type}</Tag>
                  {e.planned && <Tag tone="yellow">计划</Tag>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary">{e.dept}</DbCell>
              <DbCell className="font-mono text-caption whitespace-nowrap">{e.no ?? <span className="text-fg-muted font-sans">未登记</span>}</DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">{e.from} 至 {e.to ?? '长期'}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      </FrameSample>
      <Rows head={['代码', '名称', '类型', '所属部门', '院区', '状态', '期间']}>
        {SAMPLE_UNITS.map((u) => (
          <Row key={u.code}>
            <Cell className="text-fg-secondary font-mono whitespace-nowrap">{u.code}</Cell>
            <Cell className="text-fg-strong font-medium whitespace-nowrap">{u.name}</Cell>
            <Cell className="whitespace-nowrap">{u.type}</Cell>
            <Cell className="whitespace-nowrap">{u.dept}</Cell>
            <Cell className="whitespace-nowrap">{u.campus}</Cell>
            <Cell>
              <Tag tone={UNIT_STATUS_TONE[u.status]}>{u.status === 'RETIRED' ? '已退出' : UNIT_STATUS[u.status as keyof typeof UNIT_STATUS]}</Tag>
            </Cell>
            <Cell className="text-fg-secondary whitespace-nowrap">{u.period}</Cell>
          </Row>
        ))}
      </Rows>
    </Section>
  )
}

// ================================================================== 弹窗与空状态
function OverlaySection() {
  return (
    <Section id="overlay" title="弹窗与空状态" description="弹窗圆角 12、对话框阴影；表单在弹窗里纵向排列，主按钮在右下。">
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>打开示例对话框</DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>永久退出 XNK-BY-OPD 心血管内科门诊</DialogTitle>
              <DialogDescription>终态，不可恢复；代码永久绑定，不会释放给新单元。</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="d-last">最后有效日</FieldLabel>
              <DesignDate id="d-last" initial="2026-12-31" />
            </Field>
            <DialogFooter>
              <Button variant="ghost">取消</Button>
              <Button>保存到申请</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Empty className="border-line border border-dashed">
        <EmptyHeader>
          <EmptyTitle>2026-09-30 没有服务单元</EmptyTitle>
          <EmptyDescription>新建服务单元后经提交、确认才会出现在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Section>
  )
}

// ================================================================== 使用规则
const DOS = [
  '颜色、字号、圆角、阴影只用令牌生成的类（text-fg-muted、bg-surface-subtle、rounded-md…）',
  '悬停、选中用透明度叠加（bg-surface-hover），不在每处另配一个灰',
  '状态用 Tag，颜色从 lib/tones.ts 取',
  '一屏一个主按钮；危险操作用 destructive（浅红底）',
  '对象详情顶部用属性列表，说明与规则用 Callout',
]
const DONTS = [
  '写色值或任意值：#0075de、text-[13px]、shadow-[…]',
  '在页面里引用原始令牌（--hd-blue-600）；只能在 tokens.css 的语义层引用',
  '用颜色作为唯一信息：状态标签必须带文字',
  '为装饰加动效、渐变、大面积彩色底',
]

function RulesSection() {
  return (
    <Section id="rules" title="使用规则" description="新页面、新组件提交前对照检查。">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-success-soft grid content-start gap-2 rounded-lg p-4">
          <span className="text-success-text text-xs font-semibold">要</span>
          <ul className="text-fg grid list-disc gap-1 pl-4 text-xs">
            {DOS.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div className="bg-danger-soft grid content-start gap-2 rounded-lg p-4">
          <span className="text-danger-text text-xs font-semibold">不要</span>
          <ul className="text-fg grid list-disc gap-1 pl-4 text-xs">
            {DONTS.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

/** 示例用的日期输入（全项目统一 yyyy-mm-dd，见 components/kit/date-input.tsx） */
function DesignDate({ id, initial }: { id: string; initial: string }) {
  const [v, setV] = useState(initial)
  return <DateInput id={id} value={v} onChange={setV} />
}
