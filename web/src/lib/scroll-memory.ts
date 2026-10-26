// 列表的返回上下文（U3R-05）：从列表进入详情时记下这一次的来源，返回时回到原来的范围、位置与对象。
// - 记什么：来源地址（含网址里的筛选）、集合范围 scope（查看日期 + 筛选 + 检索，不含详情参数）、滚动位置、打开的对象，
//   以及少量本地状态（检索词、树的折叠、已加载条数、排序）。只存在本标签页的 sessionStorage，不写进网址。
// - 何时恢复：只在回到同一来源地址时（浏览器后退、面包屑、详情页的“返回列表”）。从侧栏重新进入、换了筛选不算返回。
// - 范围变了（如在详情里改了查看日期）：不恢复旧位置；原对象仍在当前结果里就让它可见并聚焦，否则聚焦页面标题，不补行。
// 正文的滚动容器是外壳里的 <main>（components/layout.tsx），不是 window；外壳换页时先回顶，所以下一帧再恢复。
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useLocation } from 'react-router'

type ReturnContext = {
  /** 来源列表的地址（pathname + search） */
  href: string
  /** 进入的详情页 pathname：只有这次详情才用 href 作“返回列表” */
  target: string
  scope: string
  top: number
  /** 行上的 data-return-id */
  id: string
  local: Record<string, unknown>
}

const storeKey = (list: string) => `hdip.return:${list}`

function readContext(list: string): ReturnContext | null {
  try {
    const raw = sessionStorage.getItem(storeKey(list))
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<ReturnContext> | null
    if (!c || typeof c.href !== 'string' || typeof c.target !== 'string' || typeof c.scope !== 'string' || typeof c.id !== 'string') return null
    return {
      href: c.href,
      target: c.target,
      scope: c.scope,
      top: typeof c.top === 'number' && c.top > 0 ? c.top : 0,
      id: c.id,
      local: c.local && typeof c.local === 'object' ? c.local : {},
    }
  } catch {
    return null
  }
}

function writeContext(list: string, c: ReturnContext | null) {
  try {
    if (c) sessionStorage.setItem(storeKey(list), JSON.stringify(c))
    else sessionStorage.removeItem(storeKey(list))
  } catch {
    /* 本地存储不可用：返回时用默认列表 */
  }
}

/** 本次渲染是否是“返回”这一列表的原上下文（地址相同才算） */
function useBackContext(): ReturnContext | null {
  const { pathname, search } = useLocation()
  const [back] = useState(() => {
    const c = readContext(pathname)
    return c && c.href === pathname + search ? c : null
  })
  return back
}

/** 列表页的本地状态：返回原上下文时取当时的值，否则用初始值。valid 检查存储里的值是否可用 */
export function useReturnState<T>(name: string, initial: T, valid: (v: unknown) => v is T) {
  const back = useBackContext()
  return useState<T>(() => {
    const v = back?.local[name]
    return v !== undefined && valid(v) ? v : initial
  })
}

/** 详情页“回到列表”的地址：这次详情是从该列表打开的就带上原筛选，否则是默认列表 */
export function useListHref(list: string): string {
  const { pathname } = useLocation()
  const c = list ? readContext(list) : null
  return c && c.target === pathname ? c.href : list
}

/**
 * 列表页接入返回上下文。行（或行内入口）标 data-return-id；把 onClickCapture 挂在列表外层，
 * 点行内任一链接离开时记下上下文；不经链接离开时（整行点击）调用 leave。
 * scope 只放真正决定集合的条件（查看日期、筛选、检索、视角），不放详情或弹层参数。
 */
export function useListReturn({ scope, ready, local = {} }: { scope: string; ready: boolean; local?: Record<string, unknown> }) {
  const { pathname, search } = useLocation()
  const back = useBackContext()
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const done = useRef(false)

  useEffect(() => {
    if (!back || !ready || done.current) return
    // 用过才标记：开发模式下 effect 会先跑一遍再清理，提前标记会让第二遍找不到
    const frame = requestAnimationFrame(() => {
      done.current = true
      writeContext(pathname, null)
      const main = document.querySelector('main')
      const same = back.scope === scopeRef.current
      if (same && main && back.top > 0) main.scrollTop = back.top
      const row = document.querySelector<HTMLElement>(`[data-return-id="${CSS.escape(back.id)}"]`)
      // 行里先找当时点的那个链接，再找第一个链接（对象名称），都没有再找按钮
      const target = row?.matches('a[href],button')
        ? row
        : (row?.querySelector<HTMLElement>(`a[href="${CSS.escape(back.target)}"]`) ??
          row?.querySelector<HTMLElement>('a[href]') ??
          row?.querySelector<HTMLElement>('button'))
      if (target) {
        const box = target.getBoundingClientRect()
        const view = main?.getBoundingClientRect()
        if (!view || box.top < view.top || box.bottom > view.bottom) target.scrollIntoView({ block: 'center' })
        target.focus({ preventScroll: true })
      } else {
        // 原对象已不在当前结果里：保留当前范围，不补行，焦点落在页面标题
        const h = document.querySelector<HTMLElement>('main h1')
        if (h) {
          h.tabIndex = -1
          h.focus({ preventScroll: true })
        }
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [back, ready, pathname])

  const leave = (id: string | number, target: string) =>
    writeContext(pathname, {
      href: pathname + search,
      target,
      scope,
      top: document.querySelector('main')?.scrollTop ?? 0,
      id: String(id),
      local,
    })

  const onClickCapture = (e: MouseEvent) => {
    // 新标签页打开不算离开本页
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    const row = a?.closest<HTMLElement>('[data-return-id]')
    if (!a || !row) return
    leave(row.dataset.returnId!, new URL(a.href).pathname)
  }

  return { leave, onClickCapture }
}

export const isString = (v: unknown): v is string => typeof v === 'string'
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
export const isSort = (v: unknown): v is { key: string; dir: 'asc' | 'desc' } | null =>
  v === null || (typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string' && ['asc', 'desc'].includes((v as { dir?: unknown }).dir as string))
export const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x))
