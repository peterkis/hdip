// 多步骤流程的进度节点：已完成（勾）、当前（强调色）、未到（灰），节点之间连线。
// 终止于某一步（退回、撤销）时，该节点用 danger / muted 标出，后面的节点不再显示为“待办”。
import { Icon } from '@/components/kit/icon'
import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StepState = 'done' | 'current' | 'upcoming' | 'stopped' | 'skipped'

export interface StepItem {
  label: string
  state: StepState
  /** 节点下方的说明：谁、何时，或“等待谁做什么” */
  detail?: ReactNode
}

const DOT: Record<StepState, string> = {
  done: 'bg-brand text-fg-on-brand',
  current: 'bg-brand-soft text-brand-text ring-2 ring-brand',
  upcoming: 'bg-surface-subtle text-fg-muted ring-1 ring-line',
  stopped: 'bg-danger-soft text-danger-text ring-1 ring-danger',
  skipped: 'bg-surface-subtle text-fg-disabled',
}

export function Steps({ steps, className }: { steps: StepItem[]; className?: string }) {
  return (
    <ol className={cn('flex w-full items-start', className)}>
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-3 right-1/2 h-px w-full -translate-y-1/2',
                s.state === 'upcoming' || s.state === 'skipped' ? 'bg-line' : 'bg-brand',
              )}
            />
          )}
          <span
            className={cn(
              'relative z-10 flex size-6 items-center justify-center rounded-full text-caption font-medium',
              DOT[s.state],
            )}
          >
            {/* 当前节点：一圈柔和的光晕缓慢扩散、淡出，提示“正在这一步”；系统要求减少动效时不播放 */}
            {s.state === 'current' && <span aria-hidden className="hd-breathe bg-brand absolute inset-0 rounded-full" />}
            {s.state === 'done' ? (
              <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.5} />
            ) : s.state === 'stopped' ? (
              <Icon icon={Cancel01Icon} className="size-3.5" strokeWidth={2.5} />
            ) : (
              i + 1
            )}
          </span>
          <span
            className={cn(
              'text-xs',
              s.state === 'current' ? 'text-brand-text font-medium' : s.state === 'stopped' ? 'text-danger-text font-medium' : s.state === 'done' ? 'text-fg-strong' : 'text-fg-muted',
            )}
          >
            {s.label}
          </span>
          {s.detail && <span className="text-fg-muted max-w-48 px-2 text-caption">{s.detail}</span>}
        </li>
      ))}
    </ol>
  )
}
