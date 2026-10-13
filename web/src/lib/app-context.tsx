// 全局“查看日期”与选项字典。查看日期作为查询参数进入 TanStack Query 的查询键。
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useListOptions } from '@/api/generated/meta/meta'
import { today } from '@/lib/format'

interface AppContextValue {
  asOf: string
  setAsOf: (day: string) => void
  nodeRoles: Record<string, string>
  nodeRoleOptions: { code: string; name: string }[]
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOf] = useState(today)
  const { data: options = [] } = useListOptions({ category: 'campus_node_role' })
  const value = useMemo(() => {
    const nodeRoleOptions = options.map((o) => ({ code: o.code, name: o.name }))
    return {
      asOf,
      setAsOf,
      nodeRoleOptions,
      nodeRoles: Object.fromEntries(nodeRoleOptions.map((o) => [o.code, o.name])),
    }
  }, [asOf, options])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}
