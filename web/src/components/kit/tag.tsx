// Notion 风格的彩色标签（选项、状态）。颜色只能取 Tone，对应 tokens.css 的 --hd-tag-*。
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'red'

export const TONES: Tone[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red']

// Tailwind 需要字面类名，所以逐一列出
const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-tag-gray-bg text-tag-gray-text',
  brown: 'bg-tag-brown-bg text-tag-brown-text',
  orange: 'bg-tag-orange-bg text-tag-orange-text',
  yellow: 'bg-tag-yellow-bg text-tag-yellow-text',
  green: 'bg-tag-green-bg text-tag-green-text',
  teal: 'bg-tag-teal-bg text-tag-teal-text',
  blue: 'bg-tag-blue-bg text-tag-blue-text',
  purple: 'bg-tag-purple-bg text-tag-purple-text',
  pink: 'bg-tag-pink-bg text-tag-pink-text',
  red: 'bg-tag-red-bg text-tag-red-text',
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
        'inline-flex h-(--hd-tag-height) max-w-full items-center rounded-sm px-1.5 text-xs whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
      {after}
    </span>
  )
}
