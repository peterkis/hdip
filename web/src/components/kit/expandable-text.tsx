// 长文本（地址、依据）默认一行截断，点一下展开全文：键盘、触屏都能用，不只靠鼠标悬停（统一规范 R-TYP 3.4）
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn('block w-full text-left', open ? 'whitespace-normal' : 'truncate', className)}
      title={open ? '收起' : '展开全文'}
    >
      {text}
    </button>
  )
}
