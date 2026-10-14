// Notion 风格的提示块：浅底色、左侧图标、无边框。用于说明、规则提示、校验结果。
import { Icon, type AppIcon } from '@/components/kit/icon'
import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const STYLE: Record<CalloutTone, { box: string; icon: string; glyph: AppIcon }> = {
  neutral: { box: 'bg-surface-subtle', icon: 'text-fg-muted', glyph: InformationCircleIcon },
  info: { box: 'bg-info-soft', icon: 'text-info-text', glyph: InformationCircleIcon },
  success: { box: 'bg-success-soft', icon: 'text-success-text', glyph: CheckmarkCircle02Icon },
  warning: { box: 'bg-warning-soft', icon: 'text-warning-text', glyph: Alert02Icon },
  danger: { box: 'bg-danger-soft', icon: 'text-danger-text', glyph: Alert02Icon },
}

export function Callout({
  tone = 'neutral',
  title,
  icon,
  className,
  children,
}: {
  tone?: CalloutTone
  title?: ReactNode
  icon?: AppIcon
  className?: string
  children?: ReactNode
}) {
  const s = STYLE[tone]
  return (
    <div className={cn('flex gap-3 rounded-md px-4 py-3 text-xs', s.box, className)}>
      <Icon icon={icon ?? s.glyph} className={cn('mt-0.5 size-4 shrink-0', s.icon)} strokeWidth={2} />
      <div className="grid min-w-0 gap-1">
        {title && <div className="text-fg-strong font-medium">{title}</div>}
        {children && <div className="text-fg-secondary">{children}</div>}
      </div>
    </div>
  )
}
