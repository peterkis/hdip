// 日期录入（全项目统一 yyyy-mm-dd，2026-10-19 Peter 要求）：浏览器自带的 <input type="date"> 按系统区域显示
// （如 19/10/2026），样式改不了，所以这里用文本框：占位 yyyy-mm-dd，输入数字自动补“-”，粘贴 2026/10/19 也会整理；
// 右侧日历按钮打开浏览器自带的选择器（隐藏的 date 输入框，只借它的日历）。
// 值的约定不变：完整且合法的日期才向外报出 'YYYY-MM-DD'，清空或未输完报出 ''；离开时若外部值仍有效，未输完的内容恢复为原值。
import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type FocusEvent, type KeyboardEvent } from 'react'
import { Icon } from '@/components/kit/icon'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const DATE_PLACEHOLDER = 'yyyy-mm-dd'

export function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

/** 只保留数字，按 4-2-2 补上分隔符 */
function shape(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-')
}

export function DateInput({
  value,
  onChange,
  bare,
  className,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  /** 不带输入框外观（如顶栏的“查看日期”），只留文字与日历按钮 */
  bare?: boolean
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(value)
  const picker = useRef<HTMLInputElement>(null)
  // 外部值变了（选了日历、表单重置、自动推后）才同步；正在输入的半截内容不被覆盖
  useEffect(() => {
    setText((t) => ((isDate(t) ? t : '') === value ? t : value))
  }, [value])

  const take = (next: string) => {
    setText(next)
    onChange(isDate(next) ? next : '')
  }
  const props = {
    ...rest,
    type: 'text',
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    placeholder: rest.placeholder ?? DATE_PLACEHOLDER,
    maxLength: 10,
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      // 删除时不强行补分隔符，免得“-”删不掉；输入、粘贴、整段替换都按 4-2-2 整理
      const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith('delete')
      take(deleting ? raw.replace(/[^\d-]/g, '') : shape(raw))
    },
    // 键盘打开日历：Alt + ↓（日历按钮不单独占 Tab 停靠点，输入框就是它的等效入口）
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        try {
          picker.current?.showPicker()
        } catch {
          /* 浏览器不支持时照常手输 */
        }
      }
      rest.onKeyDown?.(e)
    },
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      if (text && !isDate(text) && value) setText(value)
      rest.onBlur?.(e)
    },
  }
  return (
    <span className={cn('relative flex min-w-0 items-center', !bare && 'w-full')}>
      {bare ? (
        <input {...props} className={cn('tabular-nums outline-none', className)} />
      ) : (
        <Input {...props} className={cn('pr-7 tabular-nums', className)} />
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label="从日历选择"
        title="从日历选择（键盘：在日期框里按 Alt + ↓）"
        disabled={rest.disabled}
        onClick={() => {
          try {
            picker.current?.showPicker()
          } catch {
            picker.current?.focus()
          }
        }}
        className={cn(
          // 图标 14，命中区 24×24（U3R-07，R-A11Y 独立目标）
          'text-fg-muted hover:text-fg hover:bg-surface-hover flex size-6 shrink-0 items-center justify-center rounded-sm disabled:pointer-events-none',
          bare ? 'ml-0.5' : 'absolute right-0.5',
        )}
      >
        <Icon icon={Calendar03Icon} className="size-3.5" />
      </button>
      {/* 只借用浏览器的日历；放在左下角，弹出的日历贴着输入框 */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={isDate(text) ? text : ''}
        onChange={(e) => e.target.value && take(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
      />
    </span>
  )
}
