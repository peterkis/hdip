// 人员的变更表单（人员设计第 5、7.2 节）。写入照常经变更申请：保存为草稿，提交、确认后生效。
// - 登记人员：一个弹窗里先查重（输入姓名即在全部人员里找，含已离开、未来入职的人），
//   有同名时须明确“是不同的人”才能保存；保存时生成“登记人员 + 建立任用（含主部门、工号）”两项。
// - 建立任用：给已有人员新建一项任用（再次任用、返聘），人员身份与代码不变。
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useListPersons } from '@/api/generated/persons/persons'
import type { PersonRow } from '@/api/generated/model'
import type { DialogProps } from '@/components/forms/change-forms'
import { AutoCodeField, PinyinField, pinyinCheck } from '@/components/forms/code-fields'
import { orNull, requireFields, SelectField, TextField, type FieldErrors } from '@/components/forms/fields'
import { ItemDialog, type ChangeItemInput } from '@/components/forms/item-dialog'
import { newCode } from '@/components/forms/new-code'
import { DepartmentSelect, InstitutionSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { ToggleChip } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { period, today } from '@/lib/format'
import { PERSON_STATUS, PERSON_STATUS_TONE } from '@/lib/person'

/** 任用与主部门的字段（登记与再次任用共用） */
interface EngagementForm {
  inst: string
  type: string
  from: string
  to: string
  workNo: string
  dept: string
  unassigned: boolean
  note: string
}

const blank = (): EngagementForm => ({
  inst: '',
  type: '',
  from: today(),
  to: '',
  workNo: '',
  dept: '',
  unassigned: false,
  note: '',
})

function engagementChecks(f: EngagementForm): [string, boolean, string][] {
  return [
    ['institution', !!f.inst, '请选择任用主体'],
    ['engagement_type', !!f.type, '请选择任用类型'],
    ['valid_from', !!f.from, '请填写开始日'],
    ['valid_to', !f.to || f.to >= f.from, '结束日不能早于开始日'],
    ['department', f.unassigned || !!f.dept, '请选择主部门，或明确选“暂未分配”'],
    ['note', !f.unassigned || !!f.note.trim(), '暂未分配主部门时请写明原因'],
  ]
}

function engageItem(personCode: string, f: EngagementForm): ChangeItemInput {
  return {
    kind: 'person.engage',
    person_code: personCode,
    institution_code: f.inst,
    engagement_type: f.type,
    work_no: orNull(f.workNo),
    note: orNull(f.note),
    valid_from: f.from,
    valid_to: f.to || null,
    department_code: f.unassigned ? null : f.dept,
  }
}

function EngagementFields({ f, set }: { f: EngagementForm; set: (patch: Partial<EngagementForm>) => void }) {
  const { engagementTypeOptions } = useApp()
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <InstitutionSelect
          label="任用主体"
          name="institution"
          required
          placeholder="请选择任用主体"
          value={f.inst}
          onChange={(v) => set({ inst: v })}
        />
        <SelectField
          label="任用类型"
          name="engagement_type"
          required
          placeholder="请选择"
          value={f.type}
          onChange={(v) => set({ type: v })}
          options={engagementTypeOptions.map((o) => ({ value: o.code, label: o.name }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={f.from} onChange={(v) => set({ from: v })} />
        <TextField
          label="结束日（选填）"
          name="valid_to"
          type="date"
          value={f.to}
          onChange={(v) => set({ to: v })}
          hint="最后有效日，当天仍有效；不填 = 长期有效。到达前可以再改"
        />
      </div>
      <TextField
        label="业务工号（选填）"
        name="work_no"
        value={f.workNo}
        onChange={(v) => set({ workNo: v })}
        hint="人事系统发的工号，按原样保存（0007 不丢前导零）；同一主体内一个工号只属于一个人"
      />
      <div className="grid gap-1.5">
        <DepartmentSelect
          label="主部门"
          name="department"
          required={!f.unassigned}
          value={f.unassigned ? '' : f.dept}
          onChange={(v) => set({ dept: v, unassigned: false })}
          hint="归属期间与任用相同；部门筹备、暂停履职也可以选，撤销、被替代的不列出"
        />
        <ToggleChip label="暂未分配主部门" checked={f.unassigned} onChange={(v) => set({ unassigned: v, dept: v ? '' : f.dept })} />
      </div>
      {f.unassigned && (
        <TextField label="暂未分配的原因" name="note" required value={f.note} onChange={(v) => set({ note: v })} />
      )}
    </>
  )
}

/** 查重结果：全部人员（含已离开、未来入职、无有效任用的人）里姓名、曾用名、拼音码、工号能对上的 */
function DuplicateList({ hits }: { hits: PersonRow[] }) {
  return (
    <ul className="border-line divide-line-subtle grid divide-y rounded-md border">
      {hits.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
          <Link to={`/persons/${p.id}`} className="text-fg-strong font-medium hover:underline" target="_blank">
            {p.name}
          </Link>
          <span className="text-fg-muted font-mono text-caption">{p.code}</span>
          <Tag tone={PERSON_STATUS_TONE[p.status]}>{PERSON_STATUS[p.status]}</Tag>
          {p.matched && <span className="text-fg-muted text-caption">命中 {p.matched}</span>}
          <span className="text-fg-secondary w-full text-caption">
            {p.engagements.length === 0
              ? '没有任用记录'
              : p.engagements
                  .map(
                    (e) =>
                      `${e.department?.name ?? '暂未分配'} · ${period(e.valid_from, e.valid_to)}${e.work_no ? ` · 工号 ${e.work_no}` : ''}`,
                  )
                  .join('；')}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PersonRegisterDialog(props: DialogProps) {
  const [name, setName] = useState('')
  const [pinyin, setPinyin] = useState('')
  const [f, setF] = useState(blank)
  const [distinct, setDistinct] = useState(false)
  const set = (patch: Partial<EngagementForm>) => setF((prev) => ({ ...prev, ...patch }))

  const q = name.trim()
  const { data: hits = [], isFetching } = useListPersons({ q, scope: 'all' }, { query: { enabled: q.length > 0 } })
  const shownHits = q ? hits : []
  // 姓名变了，之前的“是不同的人”不再算数
  const key = useMemo(() => shownHits.map((h) => h.id).join(','), [shownHits])
  const [ackKey, setAckKey] = useState('')
  const acknowledged = distinct && ackKey === key

  return (
    <ItemDialog
      {...props}
      title="登记人员"
      description="先查有没有这个人（含已离开、未来入职的人），再登记任用与主部门。人员代码由系统分配，与业务工号无关。"
      build={(): ChangeItemInput[] | FieldErrors | string => {
        const missing = requireFields([['name', !!q, '请填写姓名'], pinyinCheck(pinyin), ...engagementChecks(f)])
        if (missing) return missing
        if (shownHits.length > 0 && !acknowledged)
          return '已有同名或相近的人员：请核对上面的名单，确认是不同的人后再保存'
        const code = newCode('person')
        return [{ kind: 'person.create', code, name: q, pinyin: orNull(pinyin), valid_from: f.from }, engageItem(code, f)]
      }}
    >
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <TextField label="姓名" name="name" required value={name} onChange={setName} />
        <PinyinField source={name} value={pinyin} onChange={setPinyin} mode="person" />
      </div>
      {q && (
        <div className="grid gap-2">
          {isFetching && shownHits.length === 0 ? (
            <p className="text-fg-muted text-xs">正在查找已有人员…</p>
          ) : shownHits.length === 0 ? (
            <p className="text-fg-muted text-xs">没有找到同名或相近的人员。</p>
          ) : (
            <>
              <Callout tone="warning" title={`已有 ${shownHits.length} 位人员与“${q}”相近`}>
                是同一个人就不要重复登记：打开他的详情，从那里“建立任用”（再次任用）。同名不同人可以继续登记，系统不会合并。
              </Callout>
              <DuplicateList hits={shownHits} />
              <div>
                <ToggleChip
                  label="已核对，是不同的人，继续登记"
                  checked={acknowledged}
                  onChange={(v) => {
                    setDistinct(v)
                    setAckKey(key)
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
      <AutoCodeField type="person" label="人员代码" />
      <EngagementFields f={f} set={set} />
    </ItemDialog>
  )
}

export function PersonEngageDialog({ personCode, name, ...props }: DialogProps & { personCode: string; name: string }) {
  const [f, setF] = useState(blank)
  const set = (patch: Partial<EngagementForm>) => setF((prev) => ({ ...prev, ...patch }))
  return (
    <ItemDialog
      {...props}
      title={`建立任用：${name}`}
      description="再次任用（返聘）、转换用工形式都在原人员上新建一项任用，人员身份与代码不变；原任用及其归属保留在历史里。"
      build={() => requireFields(engagementChecks(f)) ?? engageItem(personCode, f)}
    >
      <EngagementFields f={f} set={set} />
    </ItemDialog>
  )
}
