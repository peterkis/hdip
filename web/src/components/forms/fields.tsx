// 表单小件：带标签的输入、日期、下拉。值统一用字符串，空串表示未填。
// 校验：表单 build() 返回 FieldErrors 时，对应字段（按 name 对应）同时标红、说明写在字段下方，
// 焦点落到第一个出错字段；用户一改动，该字段的标记即消除（见 item-dialog.tsx）。
import { createContext, useContext, useId, type ReactNode } from 'react'
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
  return {
    id: name ? `field-${name}` : auto,
    error: name ? errors[name] : undefined,
    touch: () => name && errors[name] && clear(name),
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
      <Help error={f.error} hint={hint} />
    </Field>
  )
}

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
