// 新建院区 / 部门 / 服务单元时的两个字段（迁移 0015）：
// - 代码：系统分配、只读。保存前显示规则（如“D 加 6 位数字”），已分配的显示代码本身。
// - 拼音码：随名称自动生成（汉字取拼音首字母），可修改；改过后不再跟随，可“按名称重新生成”。
//   名称里有首字母有歧义的多音字时，在字段下逐个列出供核对（不阻止保存）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { TextField } from '@/components/forms/fields'
import { codeRuleText, isNewCode, type CodeObject } from '@/components/forms/new-code'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { PINYIN_RE, pinyinCode, polyphones } from '@/lib/pinyin'

/** 代码（只读）：未分配时说明规则，保存到申请时由系统分配 */
export function AutoCodeField({ type, code, label = '代码' }: { type: CodeObject; code?: string; label?: string }) {
  const assigned = code && !isNewCode(code) ? code : null
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="border-line bg-surface-subtle flex h-7 items-center rounded-md border px-2 text-xs">
        {assigned ? (
          <span className="text-fg-strong font-mono tracking-wide">{assigned}</span>
        ) : (
          <span className="text-fg-muted">保存时由系统分配</span>
        )}
      </div>
      <FieldDescription>{codeRuleText(type)}；一经分配永久绑定，退出后也不复用</FieldDescription>
    </Field>
  )
}

/** 表单 build() 里用：拼音码可空（空则由后端按名称生成），填了就须是字母数字 */
export function pinyinCheck(value: string, name = 'pinyin'): [string, boolean, string] {
  return [name, !value || PINYIN_RE.test(value), '拼音码只能是字母和数字（1–64 位）']
}

/**
 * 拼音码：跟随 source（名称）自动生成，用户手改过即停止跟随。
 * initialFollow：修订时传 false（沿用现有拼音码，直到改名）。
 */
export function PinyinField({
  source,
  value,
  onChange,
  name = 'pinyin',
  initialFollow = true,
}: {
  source: string
  value: string
  onChange: (v: string) => void
  name?: string
  initialFollow?: boolean
}) {
  // 用户手改过拼音码就不再自动覆盖；“按名称重新生成”恢复跟随
  const [edited, setEdited] = useState(false)
  const auto = useMemo(() => pinyinCode(source), [source])
  const first = useRef(true)
  useEffect(() => {
    const mount = first.current
    first.current = false
    // 新建：一开始就跟随名称；修订：沿用现有拼音码，改了名称才跟随
    if (edited || (mount && !initialFollow)) return
    if (value !== auto) onChange(auto)
  }, [auto]) // 只在名称变化时跟随
  const multi = useMemo(() => polyphones(source), [source])
  const hint = (
    <span className="grid gap-0.5">
      {multi.length > 0 && (
        <span className="text-warning-text">
          多音字请核对：
          {multi.map((p, i) => (
            <span key={i}>
              {i > 0 && '；'}“{p.char}”可取 {p.letters.join(' / ')}，自动取 {p.chosen}
            </span>
          ))}
        </span>
      )}
      <span>
        名称的拼音首字母，用于检索，可修改。
        {auto && auto !== value && (
          <button
            type="button"
            className="text-fg-secondary hover:text-fg ml-1 underline"
            onClick={() => {
              setEdited(false)
              onChange(auto)
            }}
          >
            按名称重新生成（{auto}）
          </button>
        )}
      </span>
    </span>
  )
  return (
    <TextField
      label="拼音码"
      name={name}
      value={value}
      onChange={(v) => {
        setEdited(true)
        onChange(v.toUpperCase().replace(/\s/g, ''))
      }}
      placeholder="随名称自动生成"
      hint={hint}
    />
  )
}
