// 统一图标：优先 hugeicons（shadcn / ReUI 的 iconLibrary 配置），没有合适的再用 lucide-react。
// 两套图标在这里统一尺寸与线宽，页面只写 <Icon icon={…} />，不直接用两个库的组件。
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppIcon = IconSvgElement | LucideIcon

export function Icon({
  icon,
  className,
  strokeWidth = 1.75,
  inline,
}: {
  icon: AppIcon
  className?: string
  strokeWidth?: number
  /** 放在按钮文字前 / 后时设置，按钮会相应收窄内边距（shadcn 的 data-icon 约定） */
  inline?: 'start' | 'end'
}) {
  const props = {
    className: cn('size-4 shrink-0', className),
    strokeWidth,
    'aria-hidden': true,
    'data-icon': inline && `inline-${inline}`,
  }
  // hugeicons 的图标是 SVG 描述数组；lucide 的图标是组件
  if (Array.isArray(icon)) return <HugeiconsIcon icon={icon} {...props} />
  const Lucide = icon as LucideIcon
  return <Lucide {...props} />
}
