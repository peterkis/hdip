// 全局“查看日期”与选项字典。查看日期作为查询参数进入 TanStack Query 的查询键。
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useListOptions } from '@/api/generated/meta/meta'
import { today, type OptionLabels } from '@/lib/format'

interface Option {
  code: string
  name: string
}

interface AppContextValue {
  asOf: string
  setAsOf: (day: string) => void
  nodeRoleOptions: Option[]
  unitTypeOptions: Option[]
  /** 任用类型（在编、合同、劳务派遣…） */
  engagementTypeOptions: Option[]
  /** 按字段名索引的码值名称，供 formatValue 使用 */
  optionLabels: OptionLabels
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOf] = useState(today)
  const { data: options = [] } = useListOptions()
  const value = useMemo(() => {
    const of = (category: string) =>
      options.filter((o) => o.category === category).map((o) => ({ code: o.code, name: o.name }))
    const nodeRoleOptions = of('campus_node_role')
    const unitTypeOptions = of('service_unit_type')
    const engagementTypeOptions = of('engagement_type')
    const labels = (list: Option[]) => Object.fromEntries(list.map((o) => [o.code, o.name]))
    return {
      asOf,
      setAsOf,
      nodeRoleOptions,
      unitTypeOptions,
      engagementTypeOptions,
      optionLabels: {
        node_role: labels(nodeRoleOptions),
        unit_type: labels(unitTypeOptions),
        engagement_type: labels(engagementTypeOptions),
      },
    }
  }, [asOf, options])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}
