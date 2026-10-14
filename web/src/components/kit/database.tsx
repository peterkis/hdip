// Notion 数据库视图的基本件：工具栏、筛选胶囊、搜索、表格、底部计数。各列表页共用。
import { Icon, type AppIcon } from '@/components/kit/icon'
import { ArrowDown01Icon, Cancel01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ 工具栏
export function DbToolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-line-subtle flex min-h-10 flex-wrap items-center gap-1.5 border-b pb-2">
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
    </div>
  )
}

const pill =
  'relative inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors duration-(--hd-duration-fast)'
const pillIdle = 'border-line text-fg-secondary hover:bg-surface-hover'
const pillActive = 'border-transparent bg-brand-muted text-brand-text hover:bg-brand-soft'

/**
 * 筛选胶囊：未选时“院区 ▾”，选中后“院区：高新院区 ×”。
 * 原生 select 透明覆盖在胶囊上，键盘与读屏可用；清除按钮在覆盖层之外。
 */
export function FilterPill({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  icon?: AppIcon
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <span className="inline-flex items-center">
      <span className={cn(pill, selected ? pillActive : pillIdle, selected && 'rounded-r-none pr-1.5')}>
        {icon && <Icon icon={icon} className="size-3.5" strokeWidth={1.75} />}
        {label}
        {selected ? (
          <span className="text-fg-strong max-w-40 truncate font-medium">：{selected.label}</span>
        ) : (
          <Icon icon={ArrowDown01Icon} className="size-3.5 opacity-60" />
        )}
        <select
          aria-label={`按${label}筛选`}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">全部{label}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {selected && (
        <button
          aria-label={`清除${label}筛选`}
          className={cn(pill, pillActive, 'rounded-l-none border-l-0 pl-1 pr-2')}
          onClick={() => onChange('')}
        >
          <Icon icon={Cancel01Icon} className="size-3" />
        </button>
      )}
    </span>
  )
}

/** 开关胶囊：如“含计划中”。 */
export function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button aria-pressed={checked} className={cn(pill, checked ? pillActive : pillIdle)} onClick={() => onChange(!checked)}>
      {checked && <Icon icon={Tick02Icon} className="size-3.5" />}
      {label}
    </button>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="hover:bg-surface-hover focus-within:bg-surface-hover flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors duration-(--hd-duration-fast)">
      <Icon icon={Search01Icon} className="text-fg-muted size-4" strokeWidth={1.75} />
      <input
        type="search"
        className="placeholder:text-fg-disabled w-40 bg-transparent text-xs outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

// ------------------------------------------------------------------ 表格
export interface DbColumn {
  label: string
  icon?: AppIcon
  className?: string
}

export function DbTable({ columns, children }: { columns: DbColumn[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-line-subtle text-fg-muted border-b text-left">
            {columns.map((c, i) => (
              <th
                key={c.label}
                className={cn(
                  'h-9 px-2 font-normal whitespace-nowrap',
                  i > 0 && 'border-line-subtle border-l',
                  c.className,
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {c.icon && <Icon icon={c.icon} className="size-4" strokeWidth={1.75} />}
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function DbRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        'border-line-subtle hover:bg-surface-hover group/row border-b transition-colors duration-(--hd-duration-fast)',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function DbCell({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-line-subtle h-9 px-2 align-middle [&:not(:first-child)]:border-l', className)}>
      {children}
    </td>
  )
}

export function DbFooter({ children }: { children: ReactNode }) {
  return <div className="text-fg-muted flex flex-wrap items-center gap-3 px-2 pt-2 text-caption">{children}</div>
}

/** 列表为空时：一句话说明 + 可选操作，不画大插图 */
export function DbEmpty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-line-subtle grid justify-items-center gap-1 border-b py-12 text-center">
      <span className="text-fg-secondary text-xs">{title}</span>
      {hint && <span className="text-fg-muted text-caption">{hint}</span>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
