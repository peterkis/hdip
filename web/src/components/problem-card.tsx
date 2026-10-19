// 校验问题卡片（柔和样式：浅红底、淡边框、无粗色条）：按“发生了什么 → 日期对照 → 怎么改”三段呈现（文字按 ASD-STE100 的原则写：
// 短句、主动语态、先说事实再说操作、一句只说一件事）。日期冲突画成一条小时间轴，冲突的日期标红。
import { Alert02Icon, ArrowDown01Icon, BulbIcon } from '@hugeicons/core-free-icons'
import type { ProblemItem } from '@/api/generated/model'
import { Icon } from '@/components/kit/icon'
import { cn } from '@/lib/utils'

export function ProblemCard({
  problem,
  title,
  onJump,
  compact = false,
}: {
  problem: ProblemItem
  /** 卡片标题：第几项 + 这一项在做什么 */
  title?: string
  /** 页面顶部的问题清单里：跳到对应的变更项 */
  onJump?: () => void
  compact?: boolean
}) {
  return (
    // 柔和提示：浅红底 + 很淡的细边框，不用粗色条；图标放在浅色圆形底里
    <div className={cn('bg-danger-soft border-danger/15 grid gap-2 rounded-lg border px-3 py-2.5', compact && 'py-2')}>
      {(title || onJump) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="bg-surface-raised text-danger-text flex size-5 items-center justify-center rounded-full">
            <Icon icon={Alert02Icon} className="size-3" strokeWidth={2} />
          </span>
          {title && <span className="text-fg-strong font-medium">{title}</span>}
          {onJump && (
            <button type="button" onClick={onJump} className="text-danger-text ml-auto inline-flex items-center gap-0.5 text-caption hover:underline">
              跳到这一项
              <Icon icon={ArrowDown01Icon} className="size-3" strokeWidth={2} />
            </button>
          )}
        </div>
      )}
      <p className="text-fg text-xs leading-relaxed">{problem.message}</p>
      {problem.facts && problem.facts.length > 0 && <DateFacts facts={problem.facts} />}
      {problem.hint && (
        <p className="bg-surface-raised text-fg-secondary flex gap-2 rounded-md px-2.5 py-2 text-xs leading-relaxed">
          <Icon icon={BulbIcon} className="text-tag-yellow-text mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>
            <span className="text-fg-strong font-medium">怎么改：</span>
            {problem.hint}
          </span>
        </p>
      )}
    </div>
  )
}

/** 小时间轴：按日期先后排开；你填的、与事实冲突的日期标红 */
function DateFacts({ facts }: { facts: NonNullable<ProblemItem['facts']> }) {
  const sorted = [...facts].sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div className="bg-surface-raised rounded-md px-3 pt-3 pb-2">
      <div className="relative mx-2 h-px">
        <span className="bg-line-strong absolute inset-x-0 top-0 h-px" />
        {sorted.map((f, i) => {
          const left = sorted.length === 1 ? 50 : (i / (sorted.length - 1)) * 100
          const bad = f.tone === 'bad'
          return (
            <span
              key={f.label}
              className={cn('absolute top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-raised', bad ? 'bg-danger' : 'bg-fg-muted')}
              style={{ left: `${left}%` }}
            />
          )
        })}
      </div>
      <div className="mt-2.5 flex justify-between gap-3">
        {sorted.map((f) => (
          <span key={f.label} className={cn('grid text-caption last:text-right first:text-left', f.tone === 'bad' ? 'text-danger-text' : 'text-fg-secondary')}>
            <span className="font-medium tabular-nums">{f.date}</span>
            <span>{f.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
