// Notion 页面顶部的属性列表：左列灰色属性名（可带图标），右列值；行悬停有底色。
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { ReactNode } from 'react'

export interface Property {
  label: string
  icon?: IconSvgElement
  value: ReactNode
}

export function PropertyList({ items }: { items: Property[] }) {
  return (
    <dl className="grid gap-px">
      {items.map((p) => (
        <div
          key={p.label}
          className="hover:bg-surface-hover grid grid-cols-[minmax(8rem,10rem)_1fr] items-center rounded-sm px-1 py-1 text-xs transition-colors duration-(--hd-duration-fast)"
        >
          <dt className="text-fg-muted flex items-center gap-1.5">
            {p.icon && <HugeiconsIcon icon={p.icon} className="size-4" strokeWidth={1.75} />}
            {p.label}
          </dt>
          <dd className="text-fg min-w-0">{p.value ?? <span className="text-fg-disabled">空</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
