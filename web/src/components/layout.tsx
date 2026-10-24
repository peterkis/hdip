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
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useListChangeRequests } from '@/api/generated/changes/changes'
import { useListUsers } from '@/api/generated/meta/meta'
import { Icon, type AppIcon } from '@/components/kit/icon'
import { CrumbProvider, useCurrentCrumb } from '@/components/shell/crumbs'
import { findNav, itemPath, NAV_GROUPS, type NavGroup, type NavItem } from '@/components/shell/nav'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { setCurrentUsername, useCurrentUsername } from '@/lib/session'
import { setTheme, useTheme } from '@/lib/theme'
import { useMe } from '@/lib/use-me'
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

export function Layout() {
  const narrow = useNarrow()
  // 窄屏默认收起侧栏
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(NARROW).matches)
  const { pathname } = useLocation()
  // 窄屏点了导航就收起，回到正文
  useEffect(() => {
    if (narrow) setCollapsed(true)
  }, [pathname, narrow])
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
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar collapsed={collapsed || narrow} onExpand={() => setCollapsed(false)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-(--hd-page-wide-max-width) px-(--hd-page-padding-x-narrow) pt-8 pb-24 lg:px-(--hd-space-64)">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </CrumbProvider>
  )
}

// ================================================================== 侧栏
function Sidebar({ onCollapse, overlay }: { onCollapse: () => void; overlay?: boolean }) {
  const { data: submitted = [] } = useListChangeRequests({ status: 'submitted' })
  const counts: Record<string, number> = { '/changes': submitted.length }
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
  'flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-(--hd-duration-fast)'

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
          isActive
            ? 'bg-surface-selected text-fg-strong font-medium'
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
          qc.invalidateQueries()
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

// ================================================================== 顶栏
function Topbar({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const { pathname } = useLocation()
  const crumb = useCurrentCrumb()
  const found = findNav(pathname)
  return (
    <header className="flex h-(--hd-topbar-height) shrink-0 items-center gap-1 px-3 text-xs">
      {collapsed && (
        <Button variant="ghost" size="icon-sm" aria-label="展开侧栏" className="text-fg-muted" onClick={onExpand}>
          <Icon icon={SidebarLeftIcon} />
        </Button>
      )}
      <nav aria-label="面包屑" className="text-fg-secondary flex min-w-0 items-center gap-0.5 whitespace-nowrap">
        {/* 窄屏只留当前页面与当前对象，分组名省略 */}
        {found && <span className="text-fg-muted hidden px-1.5 py-0.5 sm:inline">{found.group.label}</span>}
        {found?.item && (
          <>
            <span className="hidden sm:inline">
              <Sep />
            </span>
            <Link
              to={itemPath(found.item)}
              className="hover:bg-surface-hover flex items-center gap-1.5 rounded-sm px-1.5 py-0.5"
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
      <div className="ml-auto shrink-0">
        <AsOfPicker />
      </div>
    </header>
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
          'hover:bg-surface-hover flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors duration-(--hd-duration-fast)',
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
          className={cn('w-20 bg-transparent', isToday && 'text-fg')}
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
  actions,
  icon,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: AppIcon
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-fg-strong flex items-center gap-3 text-xl font-bold tracking-(--hd-type-title-tracking)">
          {icon && <Icon icon={icon} className="text-fg-muted size-8" strokeWidth={1.5} />}
          {title}
        </h1>
        {description && <p className="text-fg-secondary mt-1 text-xs">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1.5">{actions}</div>}
    </div>
  )
}
