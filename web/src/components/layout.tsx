// 应用外壳（Notion 风格）：左侧栏导航 + 顶栏面包屑与“查看日期” + 正文。
// 导航分组在 components/shell/nav.ts 配置；尺寸、颜色全部来自令牌，见 docs/design/ui-tokens.md。
import { DateInput } from '@/components/kit/date-input'
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Moon02Icon,
  PaintBoardIcon,
  SidebarLeftIcon,
  Sun03Icon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useListChangeRequests } from '@/api/generated/changes/changes'
import { useListUsers } from '@/api/generated/meta/meta'
import { Icon, type AppIcon } from '@/components/kit/icon'
import { CrumbProvider, useCurrentCrumb } from '@/components/shell/crumbs'
import { findNav, itemPath, NAV_GROUPS, type NavGroup, type NavItem } from '@/components/shell/nav'
import { Callout } from '@/components/kit/callout'
import { Button } from '@/components/ui/button'
import { isDenial, ReadError, StaleNotice } from '@/components/kit/read-state'
import { useApp } from '@/lib/app-context'
import { today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { setCurrentUsername, useCurrentUsername } from '@/lib/session'
import { setTheme, useTheme } from '@/lib/theme'
import { useMe } from '@/lib/use-me'
import { useListLink } from '@/lib/scroll-memory'
import { cn } from '@/lib/utils'

const NARROW = '(max-width: 767px)'

/** 窄屏（< 768px）：侧栏浮在正文上，不挤压正文 */
function useNarrow() {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(NARROW)
      m.addEventListener('change', l)
      return () => m.removeEventListener('change', l)
    },
    () => window.matchMedia(NARROW).matches,
  )
}

/**
 * 页面外框（统一规范 v1.0 R-LAY，U0）：work 工作列表 / 台账（净宽 ≤1440）、document 对象文档（净宽 ≤900）、
 * canvas 总览与图（不设上限）。页面用 usePageFrame 显式声明；没声明的页面保持旧外框（legacy），迁移后再接入。
 * 声明了外框的页面，顶栏的面包屑内容槽与正文共用同一条左边线（共享 gutter，窄屏 16）。
 */
export type PageFrame = 'legacy' | 'work' | 'document' | 'canvas'

const FrameContext = createContext<(frame: PageFrame) => void>(() => {})
const FrameValueContext = createContext<PageFrame>('legacy')

/** 当前页面的外框：公共件（表格、工具栏、计数）据此在规范样式与旧样式之间切换，未迁移的页面不受影响（U2） */
export function useFrame(): PageFrame {
  return useContext(FrameValueContext)
}

/** 规范页（/design 不在外壳里）展示公共件的规范样式用：让里面的公共件按指定外框渲染 */
export function FrameSample({ frame, children }: { frame: Exclude<PageFrame, 'legacy'>; children: ReactNode }) {
  return <FrameValueContext.Provider value={frame}>{children}</FrameValueContext.Provider>
}

export function usePageFrame(frame: PageFrame) {
  const set = useContext(FrameContext)
  // 布局 effect：在首次绘制前切换，避免旧外框闪一下
  useLayoutEffect(() => {
    set(frame)
    return () => set('legacy')
  }, [frame, set])
}

const FRAME_MAX: Record<Exclude<PageFrame, 'legacy'>, string> = {
  work: 'max-w-(--hd-page-work-max)',
  document: 'max-w-(--hd-page-document-max)',
  canvas: '',
}

export function Layout() {
  const narrow = useNarrow()
  const [frame, setFrame] = useState<PageFrame>('legacy')
  // 窄屏默认收起侧栏
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(NARROW).matches)
  const { pathname } = useLocation()
  // 窄屏点了导航就收起，回到正文
  useEffect(() => {
    if (narrow) setCollapsed(true)
  }, [pathname, narrow])
  // 换页面回到顶部（正文的滚动容器是共用的 <main>，不重置就会停在上一页的位置）；
  // 列表返回时的原位由 lib/scroll-memory.ts 在下一帧恢复
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [pathname])
  return (
    <CrumbProvider>
      <div className="bg-surface-page text-fg flex h-svh">
        {!collapsed &&
          (narrow ? (
            <div className="fixed inset-0 z-40 flex">
              <Sidebar onCollapse={() => setCollapsed(true)} overlay />
              <button
                aria-label="收起侧栏"
                className="bg-surface-overlay flex-1"
                onClick={() => setCollapsed(true)}
              />
            </div>
          ) : (
            <Sidebar onCollapse={() => setCollapsed(true)} />
          ))}
        {/* 桌面收起侧栏后留一条控制轨道放“展开侧栏”：它占真实宽度，顶栏与正文一起右移，内容槽仍共用左边线（R-LAY，U3R-07） */}
        {collapsed && !narrow && (
          <div className="bg-surface-sidebar border-line-subtle flex w-(--hd-shell-rail-width) shrink-0 justify-center border-r pt-2">
            <ExpandButton onExpand={() => setCollapsed(false)} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar collapsed={narrow} onExpand={() => setCollapsed(false)} frame={frame} />
          <main className="flex-1 overflow-y-auto">
            <MeFailure />
            <FrameContext.Provider value={setFrame}>
              <FrameValueContext.Provider value={frame}>
              {frame === 'legacy' ? (
                <div className="mx-auto w-full max-w-(--hd-page-wide-max-width) px-(--hd-page-padding-x-narrow) pt-8 pb-24 lg:px-(--hd-space-64)">
                  <Outlet />
                </div>
              ) : (
                <div className="px-(--hd-layout-gutter-narrow) md:px-(--hd-layout-gutter)">
                  <div
                    className={cn(
                      'mx-auto w-full pt-(--hd-page-top-gap-narrow) pb-(--hd-page-bottom-gap) md:pt-(--hd-page-top-gap)',
                      FRAME_MAX[frame],
                    )}
                  >
                    <Outlet />
                  </div>
                </div>
              )}
              </FrameValueContext.Provider>
            </FrameContext.Provider>
          </main>
        </div>
      </div>
    </CrumbProvider>
  )
}

// ================================================================== 侧栏
function Sidebar({ onCollapse, overlay }: { onCollapse: () => void; overlay?: boolean }) {
  // 角标 = 等你确认的申请（按 approval_rule 判断，有权限依据，符合 R-LAY 2.3）；不是全部已提交的数量
  const { data: submitted = [] } = useListChangeRequests({ status: 'submitted' })
  const counts: Record<string, number> = { '/changes': submitted.filter((r) => r.waiting_for_me).length }
  return (
    <aside
      className={cn(
        'bg-surface-sidebar border-line-subtle group/sidebar flex w-(--hd-sidebar-width) shrink-0 flex-col border-r',
        overlay && 'shadow-lg',
      )}
    >
      <div className="flex h-(--hd-topbar-height) shrink-0 items-center gap-1 px-2">
        <Link
          to="/"
          className="hover:bg-surface-hover flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 transition-colors duration-(--hd-duration-fast)"
        >
          <span className="bg-fg-strong text-surface-page grid size-5 shrink-0 place-items-center rounded-sm text-caption font-semibold">
            H
          </span>
          <span className="text-fg-strong truncate text-xs font-medium">HDIP 主数据维护</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="收起侧栏"
          className={cn(
            'text-fg-muted',
            // 触屏没有悬停，浮层侧栏的收起按钮常显
            !overlay && 'opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100',
          )}
          onClick={onCollapse}
        >
          <Icon icon={SidebarLeftIcon} />
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((g) => (
          <SideGroup key={g.key} group={g} counts={counts} />
        ))}
      </nav>

      <div className="border-line-subtle grid shrink-0 gap-px border-t px-2 py-2">
        <SideLink item={{ label: '设计规范', icon: PaintBoardIcon, to: '/design' }} />
        <ThemeToggle />
        <UserSwitcher />
      </div>
    </aside>
  )
}

const sideItem =
  'flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-(--hd-duration-fast)'

/** 一个主题域分组：标题可折叠（Notion 侧栏分区）；没有条目的分组显示“规划中” */
function SideGroup({ group, counts }: { group: NavGroup; counts: Record<string, number> }) {
  const [open, setOpen] = useState(true)
  const { can } = useMe()
  const items = group.items.filter((i) => !i.permission || can(i.permission))
  return (
    <div className="mt-3 grid gap-px">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-fg-muted hover:bg-surface-hover group/label flex h-6 items-center gap-1 rounded-md px-2 text-left text-caption font-medium transition-colors duration-(--hd-duration-fast)"
      >
        <span className="truncate">{group.label}</span>
        <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} className="size-3 opacity-0 group-hover/label:opacity-100" />
      </button>
      {open &&
        (items.length === 0 ? (
          <SideLink item={{ label: '规划中', icon: group.icon }} to={`/planned/${group.key}`} planned />
        ) : (
          items.map((item) => (
            <SideLink
              key={item.label}
              item={item}
              count={item.to ? counts[item.to] : undefined}
              planned={!!item.planned}
            />
          ))
        ))}
    </div>
  )
}

function SideLink({ item, to, count, planned }: { item: NavItem; to?: string; count?: number; planned?: boolean }) {
  return (
    <NavLink
      to={to ?? itemPath(item)}
      title={planned ? '规划中，不在当前范围' : undefined}
      className={({ isActive }) =>
        cn(
          sideItem,
          // 选中项（V02，参照 Gr8r）：浅色白底轻浮起 + 细边，深色用选中底、不加阴影；细边与字重让选中不只靠阴影表达
          isActive
            ? 'bg-surface-raised text-fg-strong ring-line font-medium shadow-(--hd-elevation-card) ring-1 dark:bg-surface-selected dark:shadow-none dark:ring-0'
            : planned
              ? 'text-fg-muted hover:bg-surface-hover'
              : 'text-fg-secondary hover:bg-surface-hover',
        )
      }
    >
      <Icon icon={item.icon} className={cn(planned && 'opacity-70')} />
      <span className="truncate">{item.label}</span>
      {!!count && (
        <span
          title={`${count} 张待确认`}
          className="bg-brand text-fg-on-brand ml-auto grid h-4 min-w-4 place-items-center rounded-full px-1 text-caption leading-none"
        >
          {count}
        </span>
      )}
    </NavLink>
  )
}

function ThemeToggle() {
  const theme = useTheme()
  const dark = theme.mode === 'dark'
  return (
    <button
      className={cn(sideItem, 'text-fg-secondary hover:bg-surface-hover')}
      onClick={() => setTheme({ mode: dark ? 'light' : 'dark' })}
    >
      <Icon icon={dark ? Sun03Icon : Moon02Icon} />
      {dark ? '浅色模式' : '深色模式'}
    </button>
  )
}

/** 开发期身份切换（认证方案确定后替换）。原生 select 覆盖在按钮上，保留键盘与读屏可用性 */
function UserSwitcher() {
  const username = useCurrentUsername()
  const { data: users = [] } = useListUsers()
  const qc = useQueryClient()
  const current = users.find((u) => u.username === username)
  return (
    <label
      title="开发期身份切换，认证方案确定后替换"
      className={cn(sideItem, 'text-fg-secondary hover:bg-surface-hover relative mt-1 h-9 cursor-pointer')}
    >
      <span className="bg-tag-gray-bg text-tag-gray-text grid size-5 shrink-0 place-items-center rounded-full text-caption font-medium">
        {current?.display_name.slice(0, 1) ?? '?'}
      </span>
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="text-fg truncate">{current?.display_name ?? username}</span>
        <span className="text-fg-muted text-caption">开发期身份</span>
      </span>
      <Icon icon={UnfoldMoreIcon} className="text-fg-muted size-3.5" />
      <select
        aria-label="当前用户"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={username}
        onChange={(e) => {
          setCurrentUsername(e.target.value)
          // 换身份 = 新的读取范围（U3R-03）：等界面按新身份渲染后再重置缓存——旧身份读到的数据不再显示，
          // 只重取此时仍启用的查询；新身份的权限没读到前，按权限启用的查询（如人员）不会带新身份提前发出
          setTimeout(() => qc.resetQueries(), 0)
          const name = users.find((u) => u.username === e.target.value)?.display_name
          notify.info(`已切换为“${name ?? e.target.value}”`)
        }}
      >
        {users.map((u) => (
          <option key={u.username} value={u.username}>
            {u.display_name}
          </option>
        ))}
      </select>
    </label>
  )
}

function ExpandButton({ onExpand }: { onExpand: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="展开侧栏" className="text-fg-muted" onClick={onExpand}>
      <Icon icon={SidebarLeftIcon} />
    </Button>
  )
}

// ================================================================== 顶栏
// 与查看日期无关的页面（标准资料只读参考）不显示查看日期。按路由逐个列出，不按 /standards 前缀判断：
// 编码映射台账 /standards/code-mapping 仍按查看日期取解释。
const NO_VIEW_DATE = [
  /^\/standards\/library(\/.*)?$/,
  /^\/standards\/data-elements$/,
  /^\/standards\/value-domains$/,
]

function Topbar({ collapsed, onExpand, frame }: { collapsed: boolean; onExpand: () => void; frame: PageFrame }) {
  const { pathname } = useLocation()
  const crumb = useCurrentCrumb()
  const found = findNav(pathname)
  // 窄屏（侧栏浮在正文上）时展开按钮在顶栏行内；桌面收起时它在控制轨道里（见 Layout）
  const expand = collapsed && <ExpandButton onExpand={onExpand} />
  const asOf = NO_VIEW_DATE.some((r) => r.test(pathname)) ? null : <AsOfPicker />
  if (frame !== 'legacy') {
    return (
      <header className="relative flex h-(--hd-topbar-height) shrink-0 items-center px-(--hd-layout-gutter-narrow) text-xs md:px-(--hd-layout-gutter)">
        <div className={cn('mx-auto flex w-full min-w-0 items-center gap-1', FRAME_MAX[frame])}>
          {expand}
          <Crumbs found={found} crumb={crumb} />
          <div className="ml-auto shrink-0">{asOf}</div>
        </div>
      </header>
    )
  }
  return (
    <header className="flex h-(--hd-topbar-height) shrink-0 items-center gap-1 px-3 text-xs">
      {expand}
      <Crumbs found={found} crumb={crumb} />
      <div className="ml-auto shrink-0">{asOf}</div>
    </header>
  )
}

/** 当前身份的权限没有读取成功：按权限显示的内容都停在“正在确认权限”，在正文顶部说明一次并给重试 */
function MeFailure() {
  const { permsKnown, meQuery } = useMe()
  if (!meQuery.isError) return null
  return (
    <div className="px-(--hd-layout-gutter-narrow) pt-3 md:px-(--hd-layout-gutter)">
      {permsKnown ? (
        // 刷新失败但有上次读到的权限：照常使用并标出
        <StaleNotice what="当前身份的权限" query={meQuery} />
      ) : isDenial(meQuery.error) ? (
        // 同一身份刷新时被拒绝：不再沿用旧权限，按权限显示的操作已隐藏
        <div role="alert">
          <Callout tone="neutral" title="当前身份的权限无法确认">
            <span className="flex flex-wrap items-center gap-3">
              身份可能已停用或无权使用本系统，按权限显示的操作已隐藏。可在左下角切换身份，或稍后重试。
              <Button size="sm" variant="outline" disabled={meQuery.isFetching} onClick={() => meQuery.refetch()}>
                {meQuery.isFetching ? '正在重试…' : '重试'}
              </Button>
            </span>
          </Callout>
        </div>
      ) : (
        <ReadError what="当前身份的权限（按权限显示的内容暂不可用）" query={meQuery} compact />
      )}
    </div>
  )
}

function Crumbs({ found, crumb }: { found: ReturnType<typeof findNav>; crumb: ReactNode }) {
  // 详情页的上一级：这次详情是从该列表打开的就回到原筛选与位置（U3R-05），否则是默认列表
  const path = found?.item ? itemPath(found.item) : ''
  const listLink = useListLink(path)
  return (
    <>
      <nav aria-label="面包屑" className="text-fg-secondary flex min-w-0 items-center gap-0.5 whitespace-nowrap">
        {/* 窄屏只留当前页面与当前对象，分组名省略 */}
        {/* 首个可见的面包屑不留左内缩，文字与标题从同一条起线开始（V01，参照 Gr8r） */}
        {found && <span className="text-fg-muted hidden py-0.5 pr-1.5 sm:inline">{found.group.label}</span>}
        {found?.item && (
          <>
            <span className="hidden sm:inline">
              <Sep />
            </span>
            <Link
              to={crumb ? listLink.to : path}
              state={crumb ? listLink.state : undefined}
              className="hover:bg-surface-hover flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 max-sm:pl-0"
            >
              <Icon icon={found.item.icon} />
              <span className={cn(!crumb && 'text-fg', crumb && 'hidden sm:inline')}>{found.item.label}</span>
            </Link>
          </>
        )}
        {crumb && (
          <>
            <Sep />
            <span className="text-fg min-w-0 truncate rounded-sm px-1.5 py-0.5">{crumb}</span>
          </>
        )}
      </nav>
    </>
  )
}

function Sep() {
  return <span className="text-fg-disabled">/</span>
}

/** 全局“查看日期”：所有列表与详情按这一天取有效版本 */
function AsOfPicker() {
  const { asOf, setAsOf } = useApp()
  const isToday = asOf === today()
  return (
    <div className="flex items-center gap-1">
      {!isToday && (
        <Button variant="ghost" size="sm" className="text-brand-text" onClick={() => setAsOf(today())}>
          回到今天
        </Button>
      )}
      <label
        className={cn(
          'hover:bg-surface-hover has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-2 has-focus-visible:outline-(--hd-focus-ring) flex h-(--hd-control-height) items-center gap-1.5 rounded-md px-2 transition-colors duration-(--hd-duration-fast)',
          // 不是今天时用黄色高亮（Notion 的标注色），提醒正在看另一天的数据
          !isToday && 'bg-tag-yellow-bg text-tag-yellow-text hover:bg-tag-yellow-bg',
        )}
        title="按这一天查看各对象当时有效的版本"
      >
        <Icon icon={Calendar03Icon} className={cn(isToday && 'text-fg-muted')} />
        <span className={cn('hidden whitespace-nowrap sm:inline', isToday && 'text-fg-muted')}>查看日期</span>
        <DateInput
          bare
          aria-label="查看日期"
          className={cn('w-22 bg-transparent', isToday && 'text-fg')}
          value={asOf}
          onChange={(v) => v && setAsOf(v)}
        />
      </label>
    </div>
  )
}

// ================================================================== 页面标题（Notion 页头）
/** 图标与标题同一行；说明在下；操作在右上 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  icon,
}: {
  title: ReactNode
  /** 业务范围、对象说明：正文 14/20 */
  description?: ReactNode
  /** 代码、版本、时间、来源等元信息：辅助 12/16（R-TYP，U3R-07） */
  meta?: ReactNode
  actions?: ReactNode
  icon?: AppIcon
}) {
  // 标题角色跟页面外框走（统一规范 v1.0 C-02 / R-TYP 3.1）：work / canvas 用工作页标题 24/32，
  // document 用文档标题 32/40；两者字距 0、不放大图标。未声明外框的页面保持旧样式
  const frame = useFrame()
  const role = frame === 'legacy' ? 'legacy' : frame === 'document' ? 'document' : 'work'
  return (
    // 动作组规则（U3R-07，R-ACT）：宽处标题占弹性列、动作组靠右成一列；容器窄于 48rem 时动作组整组换到标题下方一行，
    // 按钮顺序不变、按钮内文字不折行。容器查询按页头自身宽度判断（侧栏展开 / 收起都适用）
    <div className={cn('@container', role === 'work' ? 'mb-4' : 'mb-6')}>
    <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start @3xl:justify-between">
      <div className="min-w-0 @3xl:flex-1">
        <h1
          className={cn(
            'text-fg-strong flex items-center gap-3',
            role === 'work' && 'text-work-title font-semibold tracking-(--hd-type-cjk-tracking)',
            role === 'document' && 'text-xl font-semibold tracking-(--hd-type-cjk-tracking)',
            role === 'legacy' && 'text-xl font-bold tracking-(--hd-type-title-tracking)',
          )}
        >
          {icon && role === 'legacy' && <Icon icon={icon} className="text-fg-muted size-8" strokeWidth={1.5} />}
          {title}
        </h1>
        {description && <p className={cn('text-fg-secondary text-xs', role === 'document' ? 'mt-2' : 'mt-1')}>{description}</p>}
        {meta && <p className="text-fg-muted mt-1 text-caption">{meta}</p>}
      </div>
      {actions && (
        <div className={cn('flex flex-wrap items-center gap-2 *:shrink-0 *:whitespace-nowrap @3xl:max-w-3/5 @3xl:justify-end', role === 'document' ? '@3xl:pt-1' : '@3xl:pt-1.5')}>
          {actions}
        </div>
      )}
    </div>
    </div>
  )
}
