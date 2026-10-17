// 详情页的区块与小件（Notion 风格）：区块标题 + 右侧操作；属性值旁的灰色文字操作；申请编号链接。
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h2 className="text-fg-strong flex flex-wrap items-center gap-2 text-sm font-semibold">
        {title}
        {action && <span className="ml-auto flex flex-wrap items-center gap-2 font-normal">{action}</span>}
      </h2>
      {children}
    </section>
  )
}

/** 属性值旁、区块标题旁的轻量操作（灰色小字，悬停加下划线） */
export function InlineAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="text-fg-muted hover:text-fg ml-2 text-caption hover:underline" onClick={onClick}>
      {children}
    </button>
  )
}

export function ChangeLink({ id, className }: { id: number; className?: string }) {
  return (
    <Link to={`/changes/${id}`} className={cn('text-fg-secondary hover:underline', className)}>
      #{id}
    </Link>
  )
}
