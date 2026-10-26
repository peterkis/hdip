// 自由标签输入（Notion 多选属性的样子）：回车或逗号添加，退格删除最后一个，点 × 移除。
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { useId, useState, type KeyboardEvent } from 'react'
import { useMarkDirty } from '@/components/kit/form-edit'
import { Icon } from '@/components/kit/icon'
import { Tag } from '@/components/kit/tag'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

export function TagInput({
  label,
  value,
  onChange,
  placeholder = '输入后按回车添加',
  hint,
  suggestions = [],
}: {
  label: string
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  hint?: string
  /** 已在用的标签，作为输入提示 */
  suggestions?: string[]
}) {
  const id = useId()
  const [text, setText] = useState('')
  // 增删标签不一定产生原生输入事件（点 ×、退格删整个标签），所以显式通知表单“有改动”
  const markDirty = useMarkDirty()
  const change = (tags: string[]) => {
    markDirty()
    onChange(tags)
  }

  function add(raw: string) {
    const tag = raw.trim()
    if (tag && !value.includes(tag)) change([...value, tag])
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      change(value.slice(0, -1))
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="border-input bg-input-bg focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-(--hd-focus-ring) flex min-h-(--hd-control-height) flex-wrap items-center gap-1 rounded-md border px-1.5 py-1 ">
        {value.map((t) => (
          <Tag key={t} tone="gray" className="gap-1 pr-0.5">
            {t}
            <button
              type="button"
              aria-label={`移除 ${t}`}
              className="hover:bg-surface-hover ml-0.5 rounded-sm p-0.5"
              onClick={() => change(value.filter((x) => x !== t))}
            >
              <Icon icon={Cancel01Icon} className="size-3" />
            </button>
          </Tag>
        ))}
        <input
          id={id}
          list={suggestions.length ? `${id}-list` : undefined}
          className="placeholder:text-fg-placeholder min-w-24 flex-1 bg-transparent text-xs outline-none"
          placeholder={value.length ? '' : placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => text && add(text)}
        />
        {suggestions.length > 0 && (
          <datalist id={`${id}-list`}>
            {suggestions.filter((s) => !value.includes(s)).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}
