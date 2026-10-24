// 人员的变更表单（人员设计第 5、7.2 节）。写入照常经变更申请：保存为草稿，提交、确认后生效。
// - 登记人员：一个弹窗里先查重（输入姓名即在全部人员里找，含已离开、未来入职的人），
//   有同名时须明确“是不同的人”才能保存；保存时生成“登记人员 + 建立任用（含主部门、工号）”两项。
// - 建立任用：给已有人员新建一项任用（再次任用、返聘），人员身份与代码不变。
// - 改姓名（先选更名 / 更正误录）、换工号、调科、结束归属、补归属（P1.2）：都自生效日起，不改写已生效的历史；
//   改结束日、调科、换号都带“发起时看到的值”，确认时与库里不一致就拒绝，提示刷新。
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useListPersons } from '@/api/generated/persons/persons'
import type {
  DepartmentDutyRow,
  PersonAssignmentOut,
  PersonDetail,
  PersonDutyOut,
  PersonEngagementOut,
  PersonRow,
} from '@/api/generated/model'
import { useEffectiveDate, type DialogProps } from '@/components/forms/change-forms'
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

// ------------------------------------------------------------------ P1.2：姓名、工号、归属
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const REASONS = [
  { value: 'RENAME', label: '本人改名（旧名记为曾用名）' },
  { value: 'CORRECTION', label: '更正录入错误（旧值标“误录”）' },
]

export function PersonNameDialog({ person, ...props }: DialogProps & { person: PersonDetail }) {
  const latest = person.versions.find((v) => !v.void) ?? person.versions[0]
  const [reason, setReason] = useState('')
  const [name, setName] = useState(latest.name)
  const [pinyin, setPinyin] = useState(latest.pinyin ?? '')
  const [day, setDay] = useEffectiveDate(latest.valid_from)
  const future = latest.valid_from > today()
  return (
    <ItemDialog
      {...props}
      title={`改姓名：${latest.name}`}
      description={
        future
          ? `当前姓名自 ${latest.valid_from} 起，尚未生效：生效日填 ${latest.valid_from} 即直接更正，不留误录期间。`
          : '自生效日起使用新姓名，旧日期仍显示旧姓名；人员代码不变。已生效的姓名不改写历史。'
      }
      build={() =>
        requireFields([
          ['reason', !!reason, '请选择为什么改：本人改名，还是更正录入错误'],
          ['name', !!name.trim(), '请填写姓名'],
          pinyinCheck(pinyin),
          ['effective_date', !!day, '请填写生效日'],
        ]) ?? {
          kind: 'person.revise',
          code: person.code,
          reason: reason as 'RENAME' | 'CORRECTION',
          effective_date: day,
          name: name.trim(),
          pinyin: orNull(pinyin),
        }
      }
    >
      <SelectField label="为什么改" name="reason" required placeholder="请选择" value={reason} onChange={setReason} options={REASONS} />
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <TextField label="新姓名" name="name" required value={name} onChange={setName} />
        <PinyinField source={name} value={pinyin} onChange={setPinyin} mode="person" initialFollow={false} />
      </div>
      <TextField
        label="生效日"
        name="effective_date"
        type="date"
        required
        value={day}
        onChange={setDay}
        hint={reason === 'RENAME' ? '改名的实际日期，可以是过去或将来' : '更正通常从今天起；须晚于当前姓名的开始日'}
      />
    </ItemDialog>
  )
}

/** 某日有效的一段（工号、归属）；没有时取最近一段 */
function onDay<T extends { valid_from: string; valid_to?: string | null; void: boolean }>(rows: T[], day: string): T | undefined {
  const live = rows.filter((r) => !r.void)
  return live.find((r) => r.valid_from <= day && (!r.valid_to || r.valid_to >= day)) ?? live.filter((r) => !r.valid_to || r.valid_to >= day).at(0)
}

export function WorkNoDialog({ engagement, ...props }: DialogProps & { engagement: PersonEngagementOut }) {
  const current = onDay(engagement.work_nos, today())
  const [reason, setReason] = useState('')
  const [workNo, setWorkNo] = useState('')
  const [day, setDay] = useState(() => {
    const t = today()
    return engagement.valid_from > t ? engagement.valid_from : t
  })
  return (
    <ItemDialog
      {...props}
      title={current ? `变更工号：${current.work_no ?? ''}` : '登记工号'}
      description="工号是人事系统发的号，可能更换（如实习转正）。旧号止于生效日前一日，新号自生效日起；人员代码不变，按旧号仍能找到此人。"
      build={() =>
        requireFields([
          ['reason', !!reason, '请选择是换号还是更正录入错误'],
          ['work_no', !!workNo.trim() || !!current, '请填写新工号'],
          ['effective_date', !!day, '请填写生效日'],
        ]) ?? {
          kind: 'person.change_work_no',
          engagement_id: engagement.id,
          expected_work_no: current?.work_no ?? null,
          reason: reason as 'CHANGE' | 'CORRECTION',
          work_no: orNull(workNo),
          effective_date: day,
        }
      }
    >
      <SelectField
        label="为什么变"
        name="reason"
        required
        placeholder="请选择"
        value={reason}
        onChange={setReason}
        options={[
          { value: 'CHANGE', label: '换号（如实习转正、人事系统改号）' },
          { value: 'CORRECTION', label: '更正录入错误（旧值标“误录”）' },
        ]}
      />
      <TextField
        label="新工号"
        name="work_no"
        required={!current}
        value={workNo}
        onChange={setWorkNo}
        hint={current ? '按原样保存（0007 不丢前导零）；留空 = 此后不再有工号' : '按原样保存（0007 不丢前导零）'}
      />
      <TextField
        label="生效日"
        name="effective_date"
        type="date"
        required
        value={day}
        onChange={setDay}
        hint={`须在任用期间（${period(engagement.valid_from, engagement.valid_to)}）内${current ? `，晚于当前工号的开始日 ${current.valid_from}` : ''}`}
      />
    </ItemDialog>
  )
}

export function TransferDialog({ person, assignment, ...props }: DialogProps & { person: string; assignment: PersonAssignmentOut }) {
  const planned = assignment.valid_from > today()
  const [dept, setDept] = useState('')
  const [day, setDay] = useState(() => (planned ? assignment.valid_from : today()))
  return (
    <ItemDialog
      {...props}
      title={`调科：${person}`}
      description="原部门的归属止于生效日前一日，新部门自生效日起，两端同一天一起成立；新归属沿用原归属的结束日。只换部门，人员与任用不变。"
      build={() =>
        requireFields([
          ['department', !!dept, '请选择调到哪个部门'],
          ['effective_date', !!day, '请填写生效日'],
        ]) ?? {
          kind: 'person.transfer',
          assignment_id: assignment.id,
          expected_valid_to: assignment.valid_to ?? null,
          department_code: dept,
          effective_date: day,
        }
      }
    >
      <DepartmentSelect label="调到" name="department" required value={dept} onChange={setDept} exclude={assignment.department.code} />
      <TextField
        label="生效日"
        name="effective_date"
        type="date"
        required
        value={day}
        onChange={setDay}
        hint={
          planned
            ? `这条归属自 ${assignment.valid_from} 起，尚未开始：填这一天即直接改为新部门`
            : `须晚于这条归属的开始日 ${assignment.valid_from}`
        }
      />
      {day && (
        <Callout tone="info">
          {day > assignment.valid_from && `${dayBefore(day)} 仍在${assignment.department.name}；`}
          {day} 起在新部门{assignment.valid_to ? `，至 ${assignment.valid_to}` : ''}。
        </Callout>
      )}
    </ItemDialog>
  )
}

export function AssignmentEndDialog({ person, assignment, ...props }: DialogProps & { person: string; assignment: PersonAssignmentOut }) {
  const planned = assignment.valid_from > today()
  const [cancelPlan, setCancelPlan] = useState(false)
  const [last, setLast] = useState(assignment.valid_to ?? today())
  return (
    <ItemDialog
      {...props}
      title={`结束归属：${person} · ${assignment.department.name}`}
      description="最后有效日当天仍归属该部门，次日起这项任用暂未分配主部门（不是离职）；结束日到达前还可以再改。"
      build={() => {
        if (cancelPlan)
          return {
            kind: 'person.assignment_set_end',
            assignment_id: assignment.id,
            expected_valid_to: assignment.valid_to ?? null,
            valid_to: dayBefore(assignment.valid_from),
          }
        return (
          requireFields([
            ['valid_to', !!last, '请填写最后有效日'],
            ['valid_to', !last || last >= assignment.valid_from, `最后有效日不能早于开始日 ${assignment.valid_from}`],
          ]) ?? {
            kind: 'person.assignment_set_end',
            assignment_id: assignment.id,
            expected_valid_to: assignment.valid_to ?? null,
            valid_to: last,
          }
        )
      }}
    >
      {planned && (
        <ToggleChip label={`撤销这条计划（原定 ${assignment.valid_from} 开始，从未生效）`} checked={cancelPlan} onChange={setCancelPlan} />
      )}
      {!cancelPlan && (
        <TextField
          label="最后有效日（含当日）"
          name="valid_to"
          type="date"
          required
          value={last}
          onChange={setLast}
          hint={assignment.valid_to ? `当前结束日 ${assignment.valid_to}` : '当前长期有效'}
        />
      )}
    </ItemDialog>
  )
}

export function AssignDialog({ engagement, ...props }: DialogProps & { engagement: PersonEngagementOut }) {
  const [kind, setKind] = useState<'PRIMARY' | 'ADDITIONAL'>(() =>
    engagement.assignments.some((a) => !a.void && a.kind === 'PRIMARY' && (!a.valid_to || a.valid_to >= today())) ? 'ADDITIONAL' : 'PRIMARY',
  )
  const [dept, setDept] = useState('')
  const [from, setFrom] = useState(() => {
    const t = today()
    return engagement.valid_from > t ? engagement.valid_from : t
  })
  const [to, setTo] = useState('')
  return (
    <ItemDialog
      {...props}
      title="添加部门归属"
      description="主部门：给暂未分配的期间补上（已有主部门要换部门请用“调科”）。附加归属：兼任等，可有多个，但不能与同一时期的主部门相同；调科不带走附加归属。"
      build={() =>
        requireFields([
          ['department', !!dept, '请选择部门'],
          ['valid_from', !!from, '请填写开始日'],
          ['valid_to', !to || to >= from, '结束日不能早于开始日'],
        ]) ?? {
          kind: 'person.assign',
          engagement_id: engagement.id,
          department_code: dept,
          assignment_kind: kind,
          valid_from: from,
          valid_to: to || null,
        }
      }
    >
      <SelectField
        label="归属方式"
        name="assignment_kind"
        required
        value={kind}
        onChange={(v) => setKind(v as 'PRIMARY' | 'ADDITIONAL')}
        options={[
          { value: 'PRIMARY', label: '主部门（暂未分配时补上）' },
          { value: 'ADDITIONAL', label: '附加归属（兼任等）' },
        ]}
      />
      <DepartmentSelect label="部门" name="department" required value={dept} onChange={setDept} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={from} onChange={setFrom} />
        <TextField
          label="结束日（选填）"
          name="valid_to"
          type="date"
          value={to}
          onChange={setTo}
          hint={`不填 = 到任用结束（${engagement.valid_to ?? '长期'}）`}
        />
      </div>
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ P1.3：结束任用、调整结束日、撤销计划
type EndMode = 'end' | 'clear' | 'cancel'

/** 结束日变化后，下属归属与工号会怎样（与后端 person_engagement_set_end 同一规则，只用于预览） */
function endPreview(e: PersonEngagementOut, mode: EndMode, last: string, extend: boolean): string[] {
  const old = e.valid_to ?? null
  const next = mode === 'clear' ? null : mode === 'cancel' ? dayBefore(e.valid_from) : last
  if (mode === 'end' && !last) return []
  const shorter = next !== null && (old === null || next < old)
  const out: string[] = []
  const rows = [
    ...e.assignments.map((a) => ({ label: a.department.name, r: a, kind: '归属' })),
    ...e.work_nos.map((n) => ({ label: `工号 ${n.work_no ?? ''}`, r: n, kind: '工号' })),
    // 职务随任用缩短一起截断；推后时不延长（A1：续任是另一次任命，须有自己的依据）
    ...(e.duties ?? []).map((d) => ({ label: `${d.department.name}${d.label}`, r: d, kind: '职务' })),
  ]
  for (const { label, r, kind } of rows) {
    if (r.void) continue
    if (shorter) {
      if (r.valid_to && r.valid_to <= next!) continue
      if (r.valid_from <= next!) out.push(`${label}止于 ${next}`)
      else if (r.valid_from > today()) out.push(`${label}（原定 ${r.valid_from} 开始）撤销，从未生效`)
      // 追溯结束时已经生效的关系不能改成从未生效：后端会拒绝整项（2026-10-23 收尾）
      else out.push(`${label}自 ${r.valid_from} 起已生效，不能改成从未生效——请把最后有效日改到它开始之后`)
    } else if (r.valid_to === old && (kind === '工号' || (kind === '归属' && extend))) {
      out.push(`${label}延至 ${next ?? '长期'}`)
    } else if (r.valid_to === old && kind === '职务') {
      out.push(`${label}仍止于 ${old}：职务不随任用延长，续任请另行登记`)
    }
  }
  return out
}

export function EngagementEndDialog({ person, engagement: e, ...props }: DialogProps & { person: string; engagement: PersonEngagementOut }) {
  const planned = e.valid_from > today()
  const [mode, setMode] = useState<EndMode | ''>(e.valid_to ? '' : 'end')
  const [last, setLast] = useState(e.valid_to ?? today())
  const [extend, setExtend] = useState(true)
  const next = mode === 'clear' ? null : mode === 'cancel' ? dayBefore(e.valid_from) : last
  const longer = mode === 'clear' || (mode === 'end' && !!e.valid_to && !!last && last > e.valid_to)
  const preview = mode ? endPreview(e, mode, last, extend) : []
  const modes = [
    { value: 'end', label: e.valid_to ? '改最后有效日（提前或推后）' : '结束任用（填最后有效日）' },
    ...(e.valid_to ? [{ value: 'clear', label: '撤回结束日（长期有效）' }] : []),
    ...(planned ? [{ value: 'cancel', label: `撤销这项计划（原定 ${e.valid_from} 开始，从未生效）` }] : []),
  ]
  return (
    <ItemDialog
      {...props}
      title={`结束 / 调整任用：${person}`}
      description={`当前 ${period(e.valid_from, e.valid_to)}。最后有效日当天仍有效；结束日到达前可以再改，到达后不能改，再次任用请新建任用。`}
      build={() =>
        requireFields([
          ['mode', !!mode, '请选择要怎么调整'],
          ['valid_to', mode !== 'end' || !!last, '请填写最后有效日'],
          ['valid_to', mode !== 'end' || !last || last >= e.valid_from, `最后有效日不能早于任用开始日 ${e.valid_from}`],
        ]) ?? {
          kind: 'person.engagement_set_end',
          engagement_id: e.id,
          expected_valid_to: e.valid_to ?? null,
          valid_to: next,
          extend_assignments: extend,
        }
      }
    >
      <SelectField label="怎么调整" name="mode" required placeholder="请选择" value={mode} onChange={(v) => setMode(v as EndMode)} options={modes} />
      {mode === 'end' && (
        <TextField label="最后有效日（含当日）" name="valid_to" type="date" required value={last} onChange={setLast} hint="可以填过去的日期（迟报的离开）" />
      )}
      {longer && <ToggleChip label="同一天到期的部门归属一起延长" checked={extend} onChange={setExtend} />}
      {mode && (
        <Callout tone="info" title="下属归属、工号与职务会这样处理">
          {preview.length ? preview.join('；') : '不受影响'}。此人在其他主体的任用不受影响；页面不表示其他系统的离院处置已完成。
        </Callout>
      )}
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ P3：部门职务（部长 / 副部长，正式 / 主持工作 / 代管）
const DUTY_OPTIONS = [
  { value: 'HEAD.FORMAL', label: '部长' },
  { value: 'DEPUTY.FORMAL', label: '副部长' },
  { value: 'HEAD.ACTING', label: '主持工作（代理部长；部长在任也可以，如部长外出学习、派驻）' },
  { value: 'DEPUTY.ACTING', label: '代理副部长' },
  { value: 'HEAD.CARETAKER', label: '代管（临时管理另一个部门，不改主部门）' },
]

/** 任职依据（A1）：任命、交接必填，结束选填；只是文字，不做附件、不校验文号 */
const BASIS_HINT = '任命文件或会议纪要，如“院发〔2026〕12 号”；登记的是已确定的任命结果'
const basisCheck = (v: string, required: boolean): [string, boolean, string] =>
  v.trim().length > 500 ? ['basis_note', false, '依据最多 500 字'] : ['basis_note', !required || !!v.trim(), '请写明任职依据']

/** 选一位人员的当前任用（值是任用 id）：按名称，后附代码与主部门，便于区分同名 */
function PersonEngagementSelect({ value, onChange, label, name, exclude }: { value: string; onChange: (v: string) => void; label: string; name: string; exclude?: number }) {
  const { asOf } = useApp()
  const { data: rows = [] } = useListPersons({ as_of: asOf, include_future: true })
  const options = rows.flatMap((p) =>
    p.engagements
      .filter((e) => e.id !== exclude)
      .map((e) => ({
        value: String(e.id),
        label: `${p.name}（${p.code}）· ${e.department?.name ?? '暂未分配'}${e.not_yet_effective ? ` · ${e.valid_from} 起` : ''}`,
      })),
  )
  return <SelectField label={label} name={name} required placeholder="请选择人员" value={value} onChange={onChange} options={options} hint="按姓名选择；列出查看日期有任用或计划任用的人" />
}

export function DutyAssignDialog({
  engagement,
  departmentCode,
  departmentName,
  ...props
}: DialogProps & { engagement?: PersonEngagementOut; departmentCode?: string; departmentName?: string }) {
  const [dept, setDept] = useState(departmentCode ?? '')
  const [who, setWho] = useState(engagement ? String(engagement.id) : '')
  const [duty, setDuty] = useState('')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState('')
  const [basis, setBasis] = useState('')
  return (
    <ItemDialog
      {...props}
      title={departmentName ? `任命职务：${departmentName}` : '任命部门职务'}
      description="职务挂在“任用 × 部门”上，不改主部门，也不授予任何系统权限。同一部门同一天正式部长、主持工作者各最多一位，两者可以并存。"
      build={() => {
        const missing = requireFields([
          ['engagement', !!who, '请选择人员'],
          ['department', !!dept, '请选择部门'],
          ['duty', !!duty, '请选择职务'],
          ['valid_from', !!from, '请填写开始日'],
          ['valid_to', !to || to >= from, '结束日不能早于开始日'],
          basisCheck(basis, true),
        ])
        if (missing) return missing
        const [d, mode] = duty.split('.') as ['HEAD' | 'DEPUTY', 'FORMAL' | 'ACTING' | 'CARETAKER']
        return { kind: 'person.duty_assign', engagement_id: Number(who), department_code: dept, duty: d, mode, valid_from: from, valid_to: to || null, basis_note: basis.trim() }
      }}
    >
      {!engagement && <PersonEngagementSelect label="人员" name="engagement" value={who} onChange={setWho} />}
      {!departmentCode && <DepartmentSelect label="部门" name="department" required value={dept} onChange={setDept} />}
      <SelectField label="职务" name="duty" required placeholder="请选择" value={duty} onChange={setDuty} options={DUTY_OPTIONS} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={from} onChange={setFrom} />
        <TextField label="结束日（选填）" name="valid_to" type="date" value={to} onChange={setTo} hint="代理、代管不强制结束日；不填 = 到任用结束（任用以后延长时职务不随之延长）" />
      </div>
      <TextField label="任职依据" name="basis_note" required value={basis} onChange={setBasis} hint={BASIS_HINT} />
    </ItemDialog>
  )
}

type DutyRef = Pick<PersonDutyOut, 'id' | 'label' | 'valid_from' | 'valid_to'> & { holder: string; department: string; engagementId?: number }

export function dutyRefFromPerson(d: PersonDutyOut, holder: string): DutyRef {
  return { id: d.id, label: d.label, valid_from: d.valid_from, valid_to: d.valid_to ?? null, holder, department: d.department.name }
}

export function dutyRefFromDept(d: DepartmentDutyRow, department: string): DutyRef {
  return { id: d.duty_id, label: d.label, valid_from: d.valid_from, valid_to: d.valid_to ?? null, holder: d.person_name, department, engagementId: d.engagement_id }
}

export function DutyHandoverDialog({ duty, ...props }: DialogProps & { duty: DutyRef }) {
  const [who, setWho] = useState('')
  const [day, setDay] = useState(() => (duty.valid_from > today() ? duty.valid_from : today()))
  const [basis, setBasis] = useState('')
  return (
    <ItemDialog
      {...props}
      title={`交接：${duty.department}${duty.label}`}
      description={`${duty.holder}止于交接日前一日，接任者自交接日起担任同一职务；部门身份不变。`}
      build={() =>
        requireFields([
          ['engagement', !!who, '请选择接任者'],
          ['effective_date', !!day, '请填写交接日'],
          basisCheck(basis, true),
        ]) ?? {
          kind: 'person.duty_handover',
          duty_id: duty.id,
          expected_valid_to: duty.valid_to ?? null,
          to_engagement_id: Number(who),
          effective_date: day,
          basis_note: basis.trim(),
        }
      }
    >
      <PersonEngagementSelect label="接任者" name="engagement" value={who} onChange={setWho} exclude={duty.engagementId} />
      <TextField label="交接日" name="effective_date" type="date" required value={day} onChange={setDay} hint={`须晚于这条职务的开始日 ${duty.valid_from}`} />
      <TextField label="任职依据" name="basis_note" required value={basis} onChange={setBasis} hint={BASIS_HINT} />
    </ItemDialog>
  )
}

export function DutyEndDialog({ duty, ...props }: DialogProps & { duty: DutyRef }) {
  const planned = duty.valid_from > today()
  const [cancelPlan, setCancelPlan] = useState(false)
  const [last, setLast] = useState(duty.valid_to ?? today())
  const [basis, setBasis] = useState('')
  const basisNote = basis.trim() || null
  // 推后已有的结束日 = 延长任期，须写依据；结束、提前、撤销计划选填
  const extending = !cancelPlan && !!duty.valid_to && !!last && last > duty.valid_to
  return (
    <ItemDialog
      {...props}
      title={`结束 / 调整职务：${duty.holder} · ${duty.department}${duty.label}`}
      description="最后有效日当天仍担任；结束日到达前还可以再改。"
      build={() =>
        requireFields([basisCheck(basis, extending)]) ??
        (cancelPlan
          ? { kind: 'person.duty_set_end', duty_id: duty.id, expected_valid_to: duty.valid_to ?? null, valid_to: dayBefore(duty.valid_from), basis_note: basisNote }
          : (requireFields([['valid_to', !!last && last >= duty.valid_from, `最后有效日不能早于开始日 ${duty.valid_from}`]]) ?? {
              kind: 'person.duty_set_end',
              duty_id: duty.id,
              expected_valid_to: duty.valid_to ?? null,
              valid_to: last,
              basis_note: basisNote,
            }))
      }
    >
      {planned && <ToggleChip label={`撤销这条计划（原定 ${duty.valid_from} 开始）`} checked={cancelPlan} onChange={setCancelPlan} />}
      {!cancelPlan && <TextField label="最后有效日（含当日）" name="valid_to" type="date" required value={last} onChange={setLast} />}
      {extending ? (
        <TextField label="任职依据" name="basis_note" required value={basis} onChange={setBasis} hint={`推后结束日（原 ${duty.valid_to}）= 延长任期，须写明依据；${BASIS_HINT}`} />
      ) : (
        <TextField label="依据（选填）" name="basis_note" value={basis} onChange={setBasis} hint="免职文件等；因任用结束、部门退出而结束的可不填" />
      )}
    </ItemDialog>
  )
}
