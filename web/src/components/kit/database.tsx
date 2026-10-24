// Notion 数据库视图的基本件：工具栏、筛选胶囊、搜索、表格、底部计数。各列表页共用。
import { Icon, type AppIcon } from '@/components/kit/icon'
import { ArrowDown01Icon, ArrowUp01Icon, ArrowUpDownIcon, Cancel01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { createContext, useContext, type ReactNode } from 'react'
import { useFrame } from '@/components/layout'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ 工具栏
// 统一规范 v1.0（U2）：声明了外框的页面（usePageFrame）用规范样式——工具栏不画底线、表头浅底 36、
// 只用横线、行 ≥44、单元格左右 12；比较表（variant="compare"）才画竖线。未迁移的页面保持旧样式。
function useSpec() {
  return useFrame() !== 'legacy'
}

export function DbToolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  const spec = useSpec()
  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5', spec ? 'pb-3' : 'border-line-subtle border-b pb-2')}>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {/* 窄屏时搜索框独占一行，不被挤出屏幕 */}
      {right && <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">{right}</div>}
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
  // 值不在选项里（网址里的旧 id、选项还没加载）也要显示出来并可清除：不让看不见的条件悄悄生效（SC-06）
  const selected = options.find((o) => o.value === value) ?? (value ? { value, label: options.length ? `${value}（不在当前选项中）` : '…' } : undefined)
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
    <label className="hover:bg-surface-hover focus-within:bg-surface-hover flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 transition-colors duration-(--hd-duration-fast) sm:flex-none">
      <Icon icon={Search01Icon} className="text-fg-muted size-4" strokeWidth={1.75} />
      <input
        type="search"
        className="placeholder:text-fg-disabled w-full min-w-0 bg-transparent text-xs outline-none sm:w-40"
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
  /** 给出时表头可点击排序（与 DbTable 的 sort / onSort 配合） */
  sortKey?: string
}

export interface DbSort {
  key: string
  dir: 'asc' | 'desc'
}

/** 点表头：未排序 → 升序 → 降序 → 取消 */
export function nextSort(current: DbSort | null, key: string): DbSort | null {
  if (current?.key !== key) return { key, dir: 'asc' }
  return current.dir === 'asc' ? { key, dir: 'desc' } : null
}

const TableCtx = createContext<{ spec: boolean; lines: boolean }>({ spec: false, lines: true })

export function DbTable({
  columns,
  children,
  sort,
  onSort,
  variant,
}: {
  columns: DbColumn[]
  children: ReactNode
  sort?: DbSort | null
  onSort?: (key: string) => void
  /** compare：逐列对照的比较表，规范样式下也画竖线（R-ROW 4.4） */
  variant?: 'compare'
}) {
  const spec = useSpec()
  const lines = !spec || variant === 'compare'
  return (
    <TableCtx.Provider value={{ spec, lines }}>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className={cn('text-fg-muted text-left', spec ? 'bg-surface-subtle' : 'border-line-subtle border-b')}>
            {columns.map((c, i) => (
              <th
                key={c.label || `c${i}`}
                className={cn(
                  'font-normal whitespace-nowrap',
                  spec ? 'h-(--hd-row-header-height) px-(--hd-cell-padding-x)' : 'h-9 px-2',
                  i > 0 && lines && 'border-line-subtle border-l',
                  c.className,
                )}
              >
                {c.sortKey && onSort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sortKey!)}
                    aria-sort={sort?.key === c.sortKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    title="点击排序"
                    className="hover:text-fg group/sort inline-flex items-center gap-1.5"
                  >
                    {c.icon && <Icon icon={c.icon} className="size-4" strokeWidth={1.75} />}
                    {c.label}
                    <Icon
                      icon={sort?.key === c.sortKey ? (sort.dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon) : ArrowUpDownIcon}
                      className={cn('size-3.5', sort?.key === c.sortKey ? 'text-fg' : 'opacity-0 group-hover/sort:opacity-100')}
                      strokeWidth={2}
                    />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {c.icon && <Icon icon={c.icon} className="size-4" strokeWidth={1.75} />}
                    {c.label}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    </TableCtx.Provider>
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
  const { spec, lines } = useContext(TableCtx)
  return (
    <td
      className={cn(
        'border-line-subtle align-middle',
        spec ? 'h-(--hd-row-height) px-(--hd-cell-padding-x)' : 'h-9 px-2',
        lines && '[&:not(:first-child)]:border-l',
        className,
      )}
    >
      {children}
    </td>
  )
}

export function DbFooter({ children }: { children: ReactNode }) {
  const spec = useSpec()
  return (
    <div className={cn('text-fg-muted flex flex-wrap items-center gap-3 text-caption', spec ? 'px-(--hd-cell-padding-x) pt-3' : 'px-2 pt-2')}>
      {children}
    </div>
  )
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
