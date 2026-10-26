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
    <section className={cn('grid min-w-0 grid-cols-1', spec ? 'gap-3' : 'gap-2')}>
      <h2 className={cn('text-fg-strong flex flex-wrap items-center gap-2 font-semibold', spec ? 'text-section' : 'text-sm')}>
        {title}
        {action && <span className="ml-auto flex flex-wrap items-center gap-1 text-xs font-normal">{action}</span>}
      </h2>
      {children}
    </section>
  )
}

const INLINE =
  'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--hd-focus-ring) -my-1 ml-1 inline-flex h-(--hd-control-height-sm) items-center rounded-md px-2 align-middle text-xs outline-none'

/** 属性值旁、区块标题旁的轻量操作；danger 用于低频且后果重的动作（如永久退出），仍只打开原表单 */
export function InlineAction({
  onClick,
  children,
  danger,
  className,
  label,
}: {
  onClick: () => void
  children: ReactNode
  danger?: boolean
  /** 单独成行时用 -ml-2 让文字与所在列对齐 */
  className?: string
  /** 同名按钮重复出现时（如名单里每行的“取消选择”）给读屏一个完整名称 */
  label?: string
}) {
  const spec = useFrame() !== 'legacy'
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        spec
          ? cn(INLINE, danger ? 'text-danger-text' : 'text-fg-secondary hover:text-fg')
          : cn('ml-2 text-caption hover:underline', danger ? 'text-danger-text' : 'text-fg-muted hover:text-fg'),
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 区块标题旁的轻量跳转（到另一个页面维护），外观与 InlineAction 一致 */
export function InlineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn(INLINE, 'text-fg-secondary hover:text-fg')}>
      {children}
    </Link>
  )
}

export function ChangeLink({ id, className }: { id: number; className?: string }) {
  return (
    <Link to={`/changes/${id}`} className={cn('text-fg-secondary hover:underline', className)}>
      #{id}
    </Link>
  )
}
