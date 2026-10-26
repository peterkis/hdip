// 详情页拿不到对象时（统一规范 R-STATE、U3R-03）：加载中显示与最终布局相近的骨架；
// 地址不对或对象不存在说“找不到”；401 说身份不可用、403 说无权（不是网络问题，也不显示缓存里的名称）；
// 其他失败说“没能读取”并给重试——失败不说成不存在。不留空白页。
// 调用方：if (!data || isDenial(query.error)) return <DetailFallback … />（刷新时被拒绝也不再显示旧内容）。
import { Link } from 'react-router'
import { useListHref } from '@/lib/scroll-memory'
import { DbEmpty } from '@/components/kit/database'
import { failureText, readFailure } from '@/components/kit/read-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Back = { to: string; label: string }

/** “返回列表”：这次详情是从该列表打开的就回到原筛选与位置（U3R-05） */
function BackButton({ back }: { back: Back }) {
  const to = useListHref(back.to)
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link to={to} />}>
      {back.label}
    </Button>
  )
}

export function Missing({ what, back }: { what: string; back: Back }) {
  return (
    <DbEmpty
      title={`找不到这个${what}`}
      hint="地址可能不完整或对象不存在，请从列表重新进入。"
      action={<BackButton back={back} />}
    />
  )
}

/** 详情页 data 为空（或被拒绝）时用：invalid = 地址里的 id 本身不成立（查询不发出） */
export function DetailFallback({
  what,
  back,
  query,
  invalid,
}: {
  what: string
  back: Back
  query: { isError: boolean; error: unknown; refetch: () => unknown; isFetching?: boolean }
  invalid?: boolean
}) {
  const kind = query.isError ? readFailure(query.error) : null
  // 422 只出现在地址里的 id 不被接受时（详情接口只有路径参数），按找不到处理
  if (invalid || kind === 'missing' || kind === 'invalid') return <Missing what={what} back={back} />
  if (kind === 'identity' || kind === 'denied') {
    const { title, hint } = failureText(`这个${what}`, query.error)
    return (
      <DbEmpty
        title={title}
        hint={hint}
        action={<BackButton back={back} />}
      />
    )
  }
  if (kind === 'failed')
    return (
      <DbEmpty
        title={`没能读取这个${what}`}
        hint="网络或服务暂时不可用。地址已保留，可以重试。"
        action={
          <span className="flex gap-2">
            <Button size="sm" disabled={query.isFetching} onClick={() => query.refetch()}>
              {query.isFetching ? '正在重试…' : '重试'}
            </Button>
            <BackButton back={back} />
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
