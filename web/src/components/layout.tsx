// 应用外壳（Notion 风格）：左侧栏导航 + 顶栏面包屑与“查看日期” + 正文。
// 尺寸、颜色全部来自令牌（--hd-sidebar-width、--hd-topbar-height、bg-surface-sidebar…），见 docs/design/ui-tokens.md。
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Building03Icon,
  Calendar03Icon,
  FileEditIcon,
  GridViewIcon,
  Hospital01Icon,
  Moon02Icon,
  PaintBoardIcon,
  SidebarLeftIcon,
  Sun03Icon,
  UnfoldMoreIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useListChangeRequests } from '@/api/generated/changes/changes'
import { useListUsers } from '@/api/generated/meta/meta'
import { CrumbProvider, useCurrentCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { today } from '@/lib/format'
import { setCurrentUsername, useCurrentUsername } from '@/lib/session'
import { setTheme, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: IconSvgElement
}

const NAV: NavItem[] = [
  { to: '/service-units', label: '服务单元', icon: GridViewIcon },
  { to: '/departments', label: '部门', icon: UserGroupIcon },
  { to: '/campuses', label: '院区', icon: Building03Icon },
  { to: '/institutions', label: '主体', icon: Hospital01Icon },
]

const CHANGES: NavItem = { to: '/changes', label: '变更申请', icon: FileEditIcon }

export function Layout() {
  // 窄屏（< 768px）默认收起侧栏
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  return (
    <CrumbProvider>
      <div className="bg-surface-page text-fg flex h-svh">
        {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar collapsed={collapsed} onExpand={() => setCollapsed(false)} />
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
function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const { data: submitted = [] } = useListChangeRequests({ status: 'submitted' })
  return (
    <aside className="bg-surface-sidebar border-line-subtle group/sidebar flex w-(--hd-sidebar-width) shrink-0 flex-col border-r">
      <div className="flex h-(--hd-topbar-height) items-center gap-1 px-2">
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
          className="text-fg-muted opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100"
          onClick={onCollapse}
        >
          <HugeiconsIcon icon={SidebarLeftIcon} />
        </Button>
      </div>

      <nav className="mt-2 grid gap-px px-2">
        <SectionLabel>主数据</SectionLabel>
        {NAV.map((n) => (
          <SideLink key={n.to} item={n} />
        ))}
        <SectionLabel>治理</SectionLabel>
        <SideLink item={CHANGES} count={submitted.length} countHint="待确认" />
      </nav>

      <div className="mt-auto grid gap-px px-2 pb-2">
        <SideLink item={{ to: '/design', label: '设计规范', icon: PaintBoardIcon }} />
        <ThemeToggle />
        <UserSwitcher />
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-fg-muted px-2 pt-3 pb-1 text-caption font-medium">{children}</div>
}

const sideItem =
  'flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-(--hd-duration-fast)'

function SideLink({ item, count, countHint }: { item: NavItem; count?: number; countHint?: string }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          sideItem,
          isActive ? 'bg-surface-selected text-fg-strong font-medium' : 'text-fg-secondary hover:bg-surface-hover',
        )
      }
    >
      <HugeiconsIcon icon={item.icon} className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{item.label}</span>
      {!!count && (
        <span
          title={countHint ? `${count} 张${countHint}` : undefined}
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
    <button className={cn(sideItem, 'text-fg-secondary hover:bg-surface-hover')} onClick={() => setTheme({ mode: dark ? 'light' : 'dark' })}>
      <HugeiconsIcon icon={dark ? Sun03Icon : Moon02Icon} className="size-4 shrink-0" strokeWidth={1.75} />
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
      <HugeiconsIcon icon={UnfoldMoreIcon} className="text-fg-muted size-3.5 shrink-0" />
      <select
        aria-label="当前用户"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={username}
        onChange={(e) => {
          setCurrentUsername(e.target.value)
          qc.invalidateQueries()
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
  const section = [...NAV, CHANGES].find((n) => pathname.startsWith(n.to))
  return (
    <header className="flex h-(--hd-topbar-height) shrink-0 items-center gap-1 px-3 text-xs">
      {collapsed && (
        <Button variant="ghost" size="icon-sm" aria-label="展开侧栏" className="text-fg-muted" onClick={onExpand}>
          <HugeiconsIcon icon={SidebarLeftIcon} />
        </Button>
      )}
      <nav aria-label="面包屑" className="text-fg-secondary flex min-w-0 items-center gap-0.5">
        {section && (
          <Link to={section.to} className="hover:bg-surface-hover flex items-center gap-1.5 rounded-sm px-1.5 py-0.5">
            <HugeiconsIcon icon={section.icon} className="size-4" strokeWidth={1.75} />
            <span className={cn(!crumb && 'text-fg')}>{section.label}</span>
          </Link>
        )}
        {crumb && (
          <>
            <span className="text-fg-disabled">/</span>
            <span className="text-fg truncate rounded-sm px-1.5 py-0.5">{crumb}</span>
          </>
        )}
      </nav>
      <div className="ml-auto">
        <AsOfPicker />
      </div>
    </header>
  )
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
        <HugeiconsIcon icon={Calendar03Icon} className={cn('size-4', isToday && 'text-fg-muted')} strokeWidth={1.75} />
        <span className={cn(isToday && 'text-fg-muted')}>查看日期</span>
        <input
          type="date"
          className={cn('w-28 bg-transparent outline-none', isToday && 'text-fg')}
          value={asOf}
          onChange={(e) => e.target.value && setAsOf(e.target.value)}
        />
      </label>
    </div>
  )
}

// ================================================================== 页面标题（Notion 页头）
export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: IconSvgElement
}) {
  return (
    <div className="mb-6">
      {icon && (
        <div className="text-fg-muted mb-2">
          <HugeiconsIcon icon={icon} className="size-10" strokeWidth={1.25} />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-fg-strong text-xl font-bold tracking-(--hd-type-title-tracking)">{title}</h1>
          {description && <p className="text-fg-secondary mt-1 text-xs">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1.5">{actions}</div>}
      </div>
    </div>
  )
}

