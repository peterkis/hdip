// 统一标签（选项、状态）：实色浅底 + 同色 1px 细边 + 深色文字 + 500 字重，结构参照 ReUI light badge（ui-tokens.md R-COL 4.8）。
// 颜色只能取 Tone，对应 tokens.css 的 --hd-tag-<色>-bg / -border / -text；总高 20、字号 14（text-xs）、行高 18、圆角 4、左右 6。
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'red'

export const TONES: Tone[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red']

// Tailwind 需要字面类名，所以逐一列出
const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-tag-gray-bg text-tag-gray-text border-tag-gray-border',
  brown: 'bg-tag-brown-bg text-tag-brown-text border-tag-brown-border',
  orange: 'bg-tag-orange-bg text-tag-orange-text border-tag-orange-border',
  yellow: 'bg-tag-yellow-bg text-tag-yellow-text border-tag-yellow-border',
  green: 'bg-tag-green-bg text-tag-green-text border-tag-green-border',
  teal: 'bg-tag-teal-bg text-tag-teal-text border-tag-teal-border',
  blue: 'bg-tag-blue-bg text-tag-blue-text border-tag-blue-border',
  purple: 'bg-tag-purple-bg text-tag-purple-text border-tag-purple-border',
  pink: 'bg-tag-pink-bg text-tag-pink-text border-tag-pink-border',
  red: 'bg-tag-red-bg text-tag-red-text border-tag-red-border',
}

export function Tag({
  tone = 'gray',
  className,
  children,
  after,
}: {
  tone?: Tone
  className?: string
  children: ReactNode
  /** 放在截断文字之外的行内控件（如标签输入的“移除”），不随长文字被裁掉或挤到下一行 */
  after?: ReactNode
}) {
  return (
    <span
      className={cn(
        'box-border inline-flex h-(--hd-tag-height) max-w-full items-center rounded-sm border px-1.5 text-xs leading-(--hd-tag-leading) font-medium whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
      {after}
    </span>
  )
}
