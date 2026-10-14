// 顶栏面包屑。一级由路由决定（侧栏导航项）；详情页用 useCrumb 补上对象名。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const Ctx = createContext<{ crumb: string | null; setCrumb: (c: string | null) => void } | null>(null)

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [crumb, setCrumb] = useState<string | null>(null)
  return <Ctx.Provider value={{ crumb, setCrumb }}>{children}</Ctx.Provider>
}

/** 详情页调用：顶栏显示“服务单元 / XNK-GX-OPD 心内科高新门诊” */
export function useCrumb(label: string | null | undefined) {
  const ctx = useContext(Ctx)
  const setCrumb = ctx?.setCrumb
  useEffect(() => {
    setCrumb?.(label ?? null)
    return () => setCrumb?.(null)
  }, [label, setCrumb])
}

export function useCurrentCrumb(): string | null {
  return useContext(Ctx)?.crumb ?? null
}
