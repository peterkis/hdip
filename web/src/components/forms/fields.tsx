// 表单小件：带标签的输入、日期、下拉。值统一用字符串，空串表示未填。
// 校验：表单 build() 返回 FieldErrors 时，对应字段（按 name 对应）同时标红、说明写在字段下方，
// 焦点落到第一个出错字段；改动后由 item-dialog.tsx 重新检查，通过了才消除该字段的标记。
// build() 必须是纯函数（不切换面板、不改状态），提交失败后的定位写在 ItemDialog 的 reveal 里（U3R-01）。
// 字段改动通过 kit/form-edit 的 markDirty() 告诉表单外壳“有改动”，关闭前据此确认。
// 生效日期（name="effective_date"）未给提示时说明它的含义：从这天起，原来的到前一天为止（修订在 D 生效）。
import { DateInput } from '@/components/kit/date-input'
import { useMarkDirty } from '@/components/kit/form-edit'
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ 字段级错误
export interface FieldErrors {
  fieldErrors: Record<string, string>
}

export function isFieldErrors(v: unknown): v is FieldErrors {
  return typeof v === 'object' && v !== null && 'fieldErrors' in v
}

/**
 * 按顺序检查必填与格式：[字段名, 是否通过, 提示]。全部通过返回 null。
 * 例：requireFields([['code', CODE_RE.test(code), '请填写有效的代码'], ['name', !!name.trim(), '请填写名称']])
 */
export function requireFields(checks: [name: string, ok: boolean, message: string][]): FieldErrors | null {
  const fieldErrors: Record<string, string> = {}
  for (const [name, ok, message] of checks) if (!ok && !(name in fieldErrors)) fieldErrors[name] = message
  return Object.keys(fieldErrors).length ? { fieldErrors } : null
}

interface ErrorsCtx {
  errors: Record<string, string>
  clear: (name: string) => void
}

export const FormErrorsContext = createContext<ErrorsCtx>({ errors: {}, clear: () => {} })

/** 字段 id 用 name 生成，便于定位与聚焦 */
function useField(name: string | undefined) {
  const auto = useId()
  const { errors, clear } = useContext(FormErrorsContext)
  const markDirty = useMarkDirty()
  return {
    id: name ? `field-${name}` : auto,
    error: name ? errors[name] : undefined,
    touch: () => {
      markDirty()
      if (name && errors[name]) clear(name)
    },
  }
}

// Notion 风格的出错染色：红边框 + 浅红底（令牌 danger / danger-soft）
const invalidFill = 'aria-invalid:bg-danger-soft'

function Label({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <FieldLabel htmlFor={htmlFor}>
      {label}
      {required && <span className="text-danger-text">*</span>}
    </FieldLabel>
  )
}

function Help({ error, hint }: { error?: string; hint?: ReactNode }) {
  if (error) return <FieldDescription className="text-danger-text">{error}</FieldDescription>
  return hint ? <FieldDescription>{hint}</FieldDescription> : null
}

// ------------------------------------------------------------------ 字段
export function TextField({
  label,
  value,
  onChange,
  name,
  required,
  hint,
  type = 'text',
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** 与 build() 返回的 fieldErrors 键对应 */
  name?: string
  required?: boolean
  hint?: ReactNode
  type?: 'text' | 'date'
  placeholder?: string
  disabled?: boolean
}) {
  const f = useField(name)
  return (
    <Field>
      <Label htmlFor={f.id} label={label} required={required} />
      {type === 'date' ? (
        <DateInput
          id={f.id}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!f.error || undefined}
          className={invalidFill}
          onChange={(v) => {
            f.touch()
            onChange(v)
          }}
        />
      ) : (
        <Input
          id={f.id}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!f.error || undefined}
          className={invalidFill}
          onChange={(e) => {
            f.touch()
            onChange(e.target.value)
          }}
        />
      )}
      <Help error={f.error} hint={hint ?? (type === 'date' && name === 'effective_date' ? EFFECTIVE_DATE_HINT : undefined)} />
    </Field>
  )
}

const EFFECTIVE_DATE_HINT = '自这一天起生效（含当天）；原来的状态到前一天为止。'

export interface Option {
  value: string
  label: string
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  name,
  required,
  placeholder,
  hint,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  name?: string
  required?: boolean
  /** 有值时显示一个空选项（如“请选择”“（不填）”） */
  placeholder?: string
  hint?: ReactNode
  disabled?: boolean
}) {
  const f = useField(name)
  return (
    <Field>
      <Label htmlFor={f.id} label={label} required={required} />
      <NativeSelect
        id={f.id}
        className={cn('w-full', invalidFill)}
        value={value}
        disabled={disabled}
        aria-invalid={!!f.error || undefined}
        onChange={(e) => {
          f.touch()
          onChange(e.target.value)
        }}
      >
        {placeholder !== undefined && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Help error={f.error} hint={hint} />
    </Field>
  )
}

/** 表单里的行内编辑动作（如“移除”）：不提交表单，点了算作改动（关闭前会确认）。纯浏览的切换不要用它。 */
export function EditButton({ onClick, className, children }: { onClick: () => void; className?: string; children: ReactNode }) {
  const markDirty = useMarkDirty()
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        markDirty()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** '' → null，其余去掉首尾空白 */
export const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** 比较表单值与当前版本，只返回改动过的字段（修订项的 changes）。 */
export function diffPatch<T extends Record<string, unknown>>(current: object, form: T): Partial<T> {
  const patch: Partial<T> = {}
  for (const key of Object.keys(form) as (keyof T)[]) {
    const before = ((current as Record<string, unknown>)[key as string] ?? null) as unknown
    if (form[key] !== before) patch[key] = form[key]
  }
  return patch
}

/** 保存未通过时把焦点放到第一个标红的字段：在表单上挂 ref，校验失败后调用 focusFirst()。 */
export function useFocusFirstInvalid() {
  const ref = useRef<HTMLFormElement>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (tick) ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [tick])
  return { ref, focusFirst: () => setTick((t) => t + 1) }
}
