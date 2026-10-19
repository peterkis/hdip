// 多步骤流程的进度节点（细长样式，按申请页原型）：一行排开，圆点在左；右侧第一行是节点名称，
// 第二行是操作人与时间（如“张三 10-19 14:34”）或提示。已完成 = 实心勾；当前 = 浅底描边 + 缓慢扩散的光晕“呼吸”；未到 = 灰。
// 终止于某一步（退回、撤销）时，该节点标红，后面的节点灰掉。
import { Icon } from '@/components/kit/icon'
import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StepState = 'done' | 'current' | 'upcoming' | 'stopped' | 'skipped'

export interface StepItem {
  label: string
  state: StepState
  /** 操作人：显示在第二行时间之前 */
  who?: string
  /** 第二行：时间，或“等待谁做什么” */
  detail?: ReactNode
}

const DOT: Record<StepState, string> = {
  done: 'bg-brand text-fg-on-brand',
  current: 'bg-brand-soft text-brand-text ring-2 ring-brand',
  upcoming: 'bg-surface-subtle text-fg-muted ring-1 ring-line',
  stopped: 'bg-danger-soft text-danger-text ring-1 ring-danger',
  skipped: 'bg-surface-subtle text-fg-disabled',
}

const LABEL: Record<StepState, string> = {
  done: 'text-fg-strong font-medium',
  current: 'text-brand-text font-semibold',
  upcoming: 'text-fg-muted font-medium',
  stopped: 'text-danger-text font-semibold',
  skipped: 'text-fg-disabled font-medium',
}

export function Steps({ steps, className }: { steps: StepItem[]; className?: string }) {
  return (
    <ol className={cn('grid w-full gap-3 sm:grid-cols-3 sm:gap-2', className)}>
      {steps.map((s, i) => (
        <li key={s.label} className="flex min-w-0 items-center gap-2.5">
          <span className="relative isolate flex size-6 shrink-0">
            {/* 当前节点：一圈柔和的光晕缓慢扩散、淡出；系统要求减少动效时不播放 */}
            {s.state === 'current' && <span aria-hidden className="hd-breathe bg-brand absolute inset-0 rounded-full" />}
            <span className={cn('relative z-10 flex size-6 items-center justify-center rounded-full text-caption font-medium', DOT[s.state])}>
              {s.state === 'done' ? (
                <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.5} />
              ) : s.state === 'stopped' ? (
                <Icon icon={Cancel01Icon} className="size-3.5" strokeWidth={2.5} />
              ) : (
                i + 1
              )}
            </span>
          </span>
          <span className="grid min-w-0 leading-snug">
            <span className={cn('truncate text-xs', LABEL[s.state])}>{s.label}</span>
            {(s.who || s.detail) && (
              <span className="text-fg-muted truncate text-caption">
                {s.who && <span className="text-fg-secondary">{s.who}</span>}
                {s.who && s.detail && ' '}
                {s.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
