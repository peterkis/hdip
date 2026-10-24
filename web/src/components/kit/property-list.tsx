// 详情页顶部的属性列表：左列属性名（可带图标），右列值。
// 声明了页面外框的页面按统一规范 C-06：属性名 128px、可读的次要色，窄屏上下排列；不画装饰图标（R-VIS 01，8 个汉字的属性名正好放下）；
// 属性不可点，所以不加悬停底色；
// 没有值写“未登记”（R-TYP 3.3：空值、未登记、不可查看分别表达）。未声明外框的页面保持旧样式。
import { Icon, type AppIcon } from '@/components/kit/icon'
import { useFrame } from '@/components/layout'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export interface Property {
  label: string
  icon?: AppIcon
  value: ReactNode
}

export function PropertyList({ items }: { items: Property[] }) {
  const spec = useFrame() !== 'legacy'
  return (
    <dl className={cn('grid', spec ? 'gap-0.5' : 'gap-px')}>
      {items.map((p) => (
        <div
          key={p.label}
          className={cn(
            'grid items-center text-xs',
            spec
              ? 'grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[8rem_1fr] sm:gap-3'
              : 'hover:bg-surface-hover grid-cols-[minmax(8rem,10rem)_1fr] rounded-sm px-1 py-1 transition-colors duration-(--hd-duration-fast)',
          )}
        >
          <dt className={cn('flex items-center gap-1.5', spec ? 'text-fg-secondary self-start sm:min-h-5' : 'text-fg-muted')}>
            {p.icon && !spec && <Icon icon={p.icon} className="size-4 shrink-0" strokeWidth={1.75} />}
            {p.label}
          </dt>
          <dd className="text-fg min-w-0">
            {p.value ?? <span className={spec ? 'text-fg-muted' : 'text-fg-disabled'}>{spec ? '未登记' : '空'}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
