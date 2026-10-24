// 分段切换（单选）：列表的范围切换，如变更申请的“全部 / 待我确认 / 已确认…”。
// 每段可带计数；accent 的计数大于 0 时用强调色（需要处理的事项）；divider 在这一段前画一条竖线分组。
import { Fragment } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  count?: number
  accent?: boolean
  divider?: boolean
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  /** 给读屏的分组名 */
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-surface-subtle inline-flex flex-wrap items-center gap-0.5 rounded-lg p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <Fragment key={o.value}>
            {o.divider && <span aria-hidden className="bg-line mx-1 h-4 w-px" />}
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs whitespace-nowrap transition-colors duration-(--hd-duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--hd-focus-ring)',
                on ? 'border-line bg-surface-page text-fg-strong font-medium' : 'text-fg-secondary hover:bg-surface-hover border-transparent',
              )}
            >
              {o.label}
              {o.count !== undefined && (
                <span className={cn('text-caption tabular-nums', o.accent && o.count > 0 ? 'text-brand-text font-semibold' : 'text-fg-muted')}>
                  {o.count}
                </span>
              )}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
