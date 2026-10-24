// 详情页拿不到对象时的三种情形（统一规范 R-STATE）：加载中显示与最终布局相近的骨架；
// 地址不对或对象不存在说“找不到”；请求失败说“没能读取”并给重试——失败不说成不存在。不留空白页。
import { Link } from 'react-router'
import { ApiError } from '@/api/fetcher'
import { DbEmpty } from '@/components/kit/database'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Back = { to: string; label: string }

export function Missing({ what, back }: { what: string; back: Back }) {
  return (
    <DbEmpty
      title={`找不到这个${what}`}
      hint="地址可能不完整或对象不存在，请从列表重新进入。"
      action={<Button variant="outline" size="sm" render={<Link to={back.to} />}>{back.label}</Button>}
    />
  )
}

/** 详情页 data 为空时用：invalid = 地址里的 id 本身不成立 */
export function DetailFallback({
  what,
  back,
  query,
  invalid,
}: {
  what: string
  back: Back
  query: { isError: boolean; error: unknown; refetch: () => unknown }
  invalid?: boolean
}) {
  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 422)
  if (invalid || notFound) return <Missing what={what} back={back} />
  if (query.isError)
    return (
      <DbEmpty
        title={`没能读取这个${what}`}
        hint="网络或服务暂时不可用。地址已保留，可以重试。"
        action={
          <span className="flex gap-2">
            <Button size="sm" onClick={() => query.refetch()}>
              重试
            </Button>
            <Button variant="outline" size="sm" render={<Link to={back.to} />}>
              {back.label}
            </Button>
          </span>
        }
      />
    )
  return (
    <div role="status" aria-label={`正在加载${what}`} className="grid gap-6">
      <div className="grid gap-2">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="grid gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr] gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-48" />
          </div>
        ))}
      </div>
    </div>
  )
}
