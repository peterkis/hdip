// 读取状态（统一规范 R-STATE、U3R-03）：只做分类与展示，不接管请求、过滤、权限或缓存。
// - 首次读取（当前查询键还没有成功数据）：保留页头与筛选，主体显示“正在读取”，计数与统计不写 0。
// - 读取失败且没有可用结果：按状态码说清楚——401 身份不可用、403 无权、404 找不到、422 条件有误、其他是临时故障可重试。
// - 同一查询键刷新失败而有上次成功的结果：照常显示并标“刷新没有成功，可能不是最新”；401 / 403 不沿用旧结果。
// - 换查看日期、筛选或身份后是新的查询键，生成的 hooks 默认不跨键保留旧数据，所以新范围先显示自己的读取状态。
// “未登记”“0”“未分类”“没有记录”都是业务结论，只能由当前范围读取成功的数据得出。
import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/fetcher'
import { Callout } from '@/components/kit/callout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type ReadFailure = 'identity' | 'denied' | 'missing' | 'invalid' | 'failed'

export function readFailure(error: unknown): ReadFailure {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 401) return 'identity'
  if (status === 403) return 'denied'
  if (status === 404) return 'missing'
  if (status === 422) return 'invalid'
  return 'failed'
}

/** 401 / 403：明确拒绝，不能再用旧结果冒充可见的事实 */
export function isDenial(error: unknown): boolean {
  const kind = readFailure(error)
  return kind === 'identity' || kind === 'denied'
}

/** 生成的 query hook 结果里本模块用到的部分 */
export interface ReadQuery {
  data?: unknown
  isError: boolean
  error: unknown
  isFetching: boolean
  refetch: () => unknown
}

/** loading = 当前范围还没有可用结果；error = 读取失败且没有可用结果（或被拒绝）；ready = 有当前范围的成功结果 */
export function readStatus(q: ReadQuery): 'loading' | 'error' | 'ready' {
  if (q.isError && isDenial(q.error)) return 'error'
  if (q.data !== undefined) return 'ready'
  return q.isError ? 'error' : 'loading'
}

/** 几个查询共同决定一块内容时：任一失败即失败，全部成功才可用 */
export function combineStatus(...list: ('loading' | 'error' | 'ready')[]): 'loading' | 'error' | 'ready' {
  if (list.includes('error')) return 'error'
  return list.every((s) => s === 'ready') ? 'ready' : 'loading'
}

const TEXT: Record<ReadFailure, (what: string) => { title: string; hint: string }> = {
  identity: () => ({ title: '当前身份不可用', hint: '开发期身份已失效或未启用。在左下角切换身份后再试。' }),
  denied: (what) => ({ title: `你没有读取${what}的权限`, hint: '这不是网络问题；需要查看时请联系维护人开通权限。' }),
  missing: (what) => ({ title: `找不到${what}`, hint: '对象可能不存在或地址不完整。' }),
  invalid: () => ({ title: '查询条件有误', hint: '当前地址或筛选参数不被接受，请清除筛选后再试。' }),
  failed: (what) => ({ title: `没能读取${what}`, hint: '网络或服务暂时不可用；当前范围已保留，可以重试。' }),
}

export function failureText(what: string, error: unknown) {
  return TEXT[readFailure(error)](what)
}

/** 首次读取：占位行，保持表格起线；读屏读到“正在读取…” */
export function ReadLoading({ label, rows = 4, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('border-line-subtle grid gap-3 border-b py-4', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-(--hd-cell-padding-x)">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** 读取失败（没有可用结果）：在内容位置说明原因；临时故障给重试，拒绝访问不以重试为主 */
export function ReadError({
  what,
  query,
  back,
  compact,
}: {
  what: string
  query: ReadQuery
  /** 找不到 / 无权时的返回路径 */
  back?: { to: string; label: string }
  /** 详情页里的附属分区：用提示块而不是整块空白区 */
  compact?: boolean
}) {
  const kind = readFailure(query.error)
  const { title, hint } = TEXT[kind](what)
  const retry = kind === 'failed' || kind === 'invalid'
  const actions: ReactNode = (retry || back) && (
    <span className="flex flex-wrap gap-2">
      {retry && (
        <Button size="sm" variant={compact ? 'outline' : 'default'} disabled={query.isFetching} onClick={() => query.refetch()}>
          {query.isFetching ? '正在重试…' : '重试'}
        </Button>
      )}
      {back && (
        <Button variant="outline" size="sm" render={<Link to={back.to} />}>
          {back.label}
        </Button>
      )}
    </span>
  )
  if (compact)
    return (
      <div role="alert">
        <Callout tone={kind === 'failed' ? 'danger' : 'neutral'} title={title}>
          <span className="flex flex-wrap items-center gap-3">
            {hint}
            {actions}
          </span>
        </Callout>
      </div>
    )
  return (
    <div role="alert" className="border-line-subtle grid justify-items-center gap-1 border-b py-12 text-center">
      <span className="text-fg-secondary text-xs">{title}</span>
      <span className="text-fg-muted text-caption">{hint}</span>
      {actions && <div className="mt-2">{actions}</div>}
    </div>
  )
}

/** 有结果时的刷新状态：刷新失败标“可能不是最新”并可重试；刷新中稍后才出现一行轻提示，避免一闪而过 */
export function StaleNotice({ what, query }: { what: string; query: ReadQuery }) {
  if (query.data === undefined) return null
  if (query.isError && !isDenial(query.error))
    return (
      <Callout tone="warning" title={`刷新没有成功：下面是上次读到的${what}，可能不是最新`}>
        <span className="flex flex-wrap items-center gap-3">
          {failureText(what, query.error).hint}
          <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>
            {query.isFetching ? '正在重试…' : '重试'}
          </Button>
        </span>
      </Callout>
    )
  if (query.isFetching)
    return (
      <p role="status" className="hd-delayed text-fg-muted text-caption">
        正在更新{what}…
      </p>
    )
  return null
}

/** 计数、统计格未知时：横线占位，读屏读出原因 */
export function Unknown({ reason }: { reason: string }) {
  return (
    <span className="text-fg-muted" title={reason}>
      —<span className="sr-only">{reason}</span>
    </span>
  )
}
