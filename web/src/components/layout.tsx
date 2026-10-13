import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router'
import { useListUsers } from '@/api/generated/meta/meta'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useApp } from '@/lib/app-context'
import { today } from '@/lib/format'
import { setCurrentUsername, useCurrentUsername } from '@/lib/session'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/campuses', label: '院区' },
  { to: '/institutions', label: '主体' },
  { to: '/changes', label: '变更申请' },
]

export function Layout() {
  const { asOf, setAsOf } = useApp()
  const username = useCurrentUsername()
  const { data: users = [] } = useListUsers()
  const qc = useQueryClient()

  return (
    <div className="min-h-svh">
      <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <div className="text-sm font-semibold">HDIP 主数据维护</div>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-2 py-1 text-xs font-medium',
                    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">查看日期</span>
              <Input
                type="date"
                className="w-36"
                value={asOf}
                onChange={(e) => e.target.value && setAsOf(e.target.value)}
              />
              {asOf !== today() && (
                <button className="text-primary underline-offset-4 hover:underline" onClick={() => setAsOf(today())}>
                  回到今天
                </button>
              )}
            </label>
            <label className="flex items-center gap-2" title="开发期身份切换，认证方案确定后替换">
              <span className="text-muted-foreground">当前用户</span>
              <NativeSelect
                value={username}
                onChange={(e) => {
                  setCurrentUsername(e.target.value)
                  qc.invalidateQueries()
                }}
              >
                {users.map((u) => (
                  <NativeSelectOption key={u.username} value={u.username}>
                    {u.display_name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
