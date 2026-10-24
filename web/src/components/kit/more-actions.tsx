// 页头或分区的“更多”菜单：低频业务动作收在这里，名称写完整（统一规范 SC-05 / SC-07、R-ACT）。
// 菜单只负责打开原来的表单，不直接改数据；键盘可用（Base UI Menu：Enter / 方向键 / Esc 回到触发按钮）。
import { MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/kit/icon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export interface MoreAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function MoreActions({ items, label = '更多' }: { items: MoreAction[]; label?: string }) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <Icon icon={MoreHorizontalIcon} />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {items.map((a) => (
          <DropdownMenuItem key={a.label} disabled={a.disabled} onClick={a.onClick}>
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
