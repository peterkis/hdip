// 表单小件：带标签的输入、日期、下拉。值统一用字符串，空串表示未填。
import { useId, type ReactNode } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export function TextField({
  label,
  value,
  onChange,
  required,
  hint,
  type = 'text',
  list,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  hint?: ReactNode
  type?: 'text' | 'date'
  list?: string
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        list={list}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  allowEmpty,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
  allowEmpty?: boolean
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <NativeSelect id={id} className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <NativeSelectOption value="">（不填）</NativeSelectOption>}
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

/** '' → null，其余去掉首尾空白 */
export const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** 比较表单值与当前版本，只返回改动过的字段（修订项的 changes）。 */
export function diffPatch<T extends Record<string, unknown>>(
  current: object,
  form: T,
): Partial<T> {
  const patch: Partial<T> = {}
  for (const key of Object.keys(form) as (keyof T)[]) {
    const before = ((current as Record<string, unknown>)[key as string] ?? null) as unknown
    if (form[key] !== before) patch[key] = form[key]
  }
  return patch
}
