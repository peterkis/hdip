// 详情页的区块与小件：区块标题 + 右侧操作；属性值旁的轻量操作；申请编号链接。
// 声明了页面外框的页面按统一规范：区块标题用章节标题 16/24（R-TYP 3.1），标题与内容间距 12（R-VIS 02），
// 轻量操作是 28px 高的真实按钮（C-08），不再是只靠悬停下划线才看得出的小字；上下负边距让它不撑高所在的属性行。
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useFrame } from '@/components/layout'
import { cn } from '@/lib/utils'

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  const spec = useFrame() !== 'legacy'
  return (
    <section className={cn('grid min-w-0', spec ? 'gap-3' : 'gap-2')}>
      <h2 className={cn('text-fg-strong flex flex-wrap items-center gap-2 font-semibold', spec ? 'text-section' : 'text-sm')}>
        {title}
        {action && <span className="ml-auto flex flex-wrap items-center gap-1 text-xs font-normal">{action}</span>}
      </h2>
      {children}
    </section>
  )
}

/** 属性值旁、区块标题旁的轻量操作 */
export function InlineAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const spec = useFrame() !== 'legacy'
  return (
    <button
      type="button"
      className={cn(
        spec
          ? 'text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:ring-ring/30 -my-1 ml-1 inline-flex h-(--hd-control-height-sm) items-center rounded-md px-2 align-middle text-xs outline-none focus-visible:ring-2'
          : 'text-fg-muted hover:text-fg ml-2 text-caption hover:underline',
      )}
      onClick={onClick}
    >
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
