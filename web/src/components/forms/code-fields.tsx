// 新建院区 / 部门 / 服务单元时的两个字段（迁移 0015）：
// - 代码：系统分配、只读。保存前显示规则（如“D 加 6 位数字”），已分配的显示代码本身。
// - 拼音码：随名称自动生成（汉字取拼音首字母），可修改；改过后不再跟随，可“按名称重新生成”。
//   名称里有首字母有歧义的多音字时，在字段下逐个列出供核对（不阻止保存）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditButton, TextField } from '@/components/forms/fields'
import { codeRuleText, isNewCode, type CodeObject } from '@/components/forms/new-code'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { PINYIN_RE, pinyinCode, polyphones, type PinyinMode } from '@/lib/pinyin'

/** 代码（只读）：未分配时说明规则，保存到申请时由系统分配 */
export function AutoCodeField({ type, code, label = '代码' }: { type: CodeObject; code?: string; label?: string }) {
  const assigned = code && !isNewCode(code) ? code : null
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="border-line bg-surface-subtle flex h-(--hd-control-height) items-center rounded-md border px-2 text-xs">
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
  mode = 'org',
  follow,
  onFollowChange,
}: {
  source: string
  value: string
  onChange: (v: string) => void
  name?: string
  initialFollow?: boolean
  /** person：人名，首字按姓氏读音 */
  mode?: PinyinMode
  /** 跟随状态由调用方保存在编辑对象上时传入（列表里可增删的对象）；未传时控件自己记，挂载时按现值推断 */
  follow?: boolean
  onFollowChange?: (follow: boolean) => void
}) {
  // 用户手改过拼音码就不再自动覆盖；“按名称重新生成”恢复跟随。
  // 是否手改过不只记在控件里：向导切步骤、拆分切后继会重新挂载本控件，所以挂载时按现值推断——
  // 新建时现值非空且不等于按名称生成的结果 = 手改过（含草稿恢复），不重新生成（审查 F02）
  const [ownEdited, setOwnEdited] = useState(() => initialFollow && !!value && value !== pinyinCode(source, mode))
  // 调用方保存了跟随状态时以它为准：人工值恰好等于自动码、人工清空后重新挂载，都不会被当成“跟随”
  const edited = follow === undefined ? ownEdited : !follow
  const setEdited = (v: boolean) => {
    setOwnEdited(v)
    onFollowChange?.(!v)
  }
  const auto = useMemo(() => pinyinCode(source, mode), [source, mode])
  const first = useRef(true)
  useEffect(() => {
    const mount = first.current
    first.current = false
    // 新建：空值时跟随名称；修订：沿用现有拼音码，改了名称才跟随；挂载时已有值的都不动
    if (edited || (mount && (!initialFollow || value))) return
    if (value !== auto) onChange(auto)
  }, [auto]) // 只在名称变化时跟随
  const multi = useMemo(() => polyphones(source, mode), [source, mode])
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
          <EditButton
            className="text-fg-secondary hover:text-fg ml-1 underline"
            onClick={() => {
              setEdited(false)
              onChange(auto)
            }}
          >
            按名称重新生成（{auto}）
          </EditButton>
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
