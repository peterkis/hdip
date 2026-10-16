// 服务单元的变更表单（部门的在 department-forms.tsx）。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应）。
// 引用其他对象一律“按名称选择”（ref-selects.tsx），代码由选择带出，操作人员不需要记代码。
import { useState } from 'react'
import type { ServiceUnitCreateUnitType, ServiceUnitVersionOut } from '@/api/generated/model'
import { CODE_HINT, CODE_RE, useEffectiveDate, type DialogProps } from '@/components/forms/change-forms'
import { diffPatch, orNull, requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { CampusSelect, DepartmentSelect, InstitutionSelect, UnitSelect } from '@/components/forms/ref-selects'
import { useApp } from '@/lib/app-context'
import { UNIT_STATUS, type UnitStatus } from '@/lib/format'

// ------------------------------------------------------------------ 服务单元
export function UnitCreateDialog({
  departmentCode = '',
  campusCode = '',
  ...props
}: DialogProps & { departmentCode?: string; campusCode?: string }) {
  const { unitTypeOptions } = useApp()
  const [name, setName] = useState('')
  const [unitType, setUnitType] = useState('')
  const [dept, setDept] = useState(departmentCode)
  const [campus, setCampus] = useState(campusCode)
  const [inst, setInst] = useState('')
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [scope, setScope] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()

  return (
    <ItemDialog
      {...props}
      title="新建服务单元"
      description="服务单元 = 部门 × 院区 × 运营主体 × 期间。服务方向、接诊形式、换房间都不产生新单元。"
      build={() =>
        requireFields([
          ['name', !!name.trim(), '请填写名称'],
          ['unit_type', !!unitType, '请选择单元类型'],
          ['department', !!dept, '请选择所属部门'],
          ['campus', !!campus, '请选择所属院区'],
          ['institution', !!inst, '请选择所属运营主体'],
          ['code', !!code.trim(), '请填写单元代码'],
          ['code', CODE_RE.test(code.trim()), '代码只能用字母、数字、点、下划线、短横线'],
          ['valid_from', !!validFrom, '请选择生效日期'],
        ]) ?? {
          kind: 'service_unit.create',
          code: code.trim(),
          unit_type: unitType as ServiceUnitCreateUnitType,
          valid_from: validFrom,
          fields: {
            name: name.trim(),
            department_code: dept,
            campus_code: campus,
            institution_code: inst,
            phone: orNull(phone),
            scope_note: orNull(scope),
          },
        }
      }
    >
      <TextField label="名称" name="name" required value={name} onChange={setName} />
      <SelectField
        label="单元类型"
        name="unit_type"
        required
        placeholder="请选择单元类型"
        value={unitType}
        onChange={setUnitType}
        options={unitTypeOptions.map((o) => ({ value: o.code, label: o.name }))}
        hint="类型不允许修订；职责变化走拆分或新建"
      />
      <DepartmentSelect label="所属部门" name="department" required value={dept} onChange={setDept} />
      <div className="grid grid-cols-2 gap-3">
        <CampusSelect label="所属院区" name="campus" required value={campus} onChange={setCampus} />
        <InstitutionSelect
          label="所属运营主体"
          name="institution"
          required
          value={inst}
          onChange={setInst}
          campusCode={campus}
        />
      </div>
      <TextField
        label="单元代码"
        name="code"
        required
        value={code}
        onChange={setCode}
        hint={`${CODE_HINT}；不要由部门代码 + 院区拼出`}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="电话" value={phone} onChange={setPhone} />
        <TextField label="生效日期" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} />
      </div>
      <TextField label="范围说明" value={scope} onChange={setScope} />
    </ItemDialog>
  )
}

type UnitDialogProps = DialogProps & { code: string; current: ServiceUnitVersionOut }

function currentDesc(current: ServiceUnitVersionOut) {
  return `当前第 ${current.version_no} 版自 ${current.valid_from} 起。调整在生效日起成为新版本，身份与代码不变。`
}

export function UnitReviseDialog({ code, current, ...props }: UnitDialogProps) {
  const [f, setF] = useState({ name: current.name, phone: current.phone ?? '', scope_note: current.scope_note ?? '' })
  const [day, setDay] = useEffectiveDate()
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (v: string) => setF({ ...f, [k]: v }) })
  return (
    <ItemDialog
      {...props}
      title={`修订服务单元：${current.name}`}
      description={currentDesc(current)}
      build={() => {
        const missing = requireFields([
          ['name', !!f.name.trim(), '名称不能为空'],
          ['effective_date', !!day, '请选择生效日期'],
        ])
        if (missing) return missing
        const changes = diffPatch(current, {
          name: f.name.trim(),
          phone: orNull(f.phone),
          scope_note: orNull(f.scope_note),
        })
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'service_unit.revise', code, effective_date: day, changes }
      }}
    >
      <TextField label="名称" name="name" required {...bind('name')} />
      <TextField label="电话" {...bind('phone')} />
      <TextField label="范围说明" {...bind('scope_note')} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitRebindDialog({ code, current, ...props }: UnitDialogProps) {
  const [campus, setCampus] = useState(current.campus_code)
  const [inst, setInst] = useState(current.institution_code)
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`重新绑定：${current.name}`}
      description={`换院区或运营主体。新院区须非停用，运营主体与之须有覆盖整个期间的“运营”关系。${currentDesc(current)}`}
      build={() => {
        const unchanged = campus === current.campus_code && inst === current.institution_code
        return (
          requireFields([
            ['campus', !!campus, '请选择所属院区'],
            ['institution', !!inst, '请选择所属运营主体'],
            ['campus', !unchanged, '院区和运营主体都没有变化'],
            ['effective_date', !!day, '请选择生效日期'],
          ]) ?? {
            kind: 'service_unit.rebind',
            code,
            effective_date: day,
            ...(campus !== current.campus_code && { campus_code: campus }),
            ...(inst !== current.institution_code && { institution_code: inst }),
          }
        )
      }}
    >
      <CampusSelect
        label="所属院区"
        name="campus"
        required
        value={campus}
        onChange={setCampus}
        hint={`当前：${current.campus_name}`}
      />
      <InstitutionSelect
        label="所属运营主体"
        name="institution"
        required
        value={inst}
        onChange={setInst}
        campusCode={campus}
        hint={`当前：${current.institution_name}`}
      />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitChangeDepartmentDialog({ code, current, ...props }: UnitDialogProps) {
  const [dept, setDept] = useState('')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`更换所属部门：${current.name}`}
      description={`按生效日之前的日期回溯，仍显示原部门。${currentDesc(current)}`}
      build={() =>
        requireFields([
          ['department', !!dept, '请选择新的所属部门'],
          ['effective_date', !!day, '请选择生效日期'],
        ]) ?? { kind: 'service_unit.change_department', code, effective_date: day, department_code: dept }
      }
    >
      <DepartmentSelect
        label="新的所属部门"
        name="department"
        required
        value={dept}
        onChange={setDept}
        exclude={current.department_code}
        hint={`当前：${current.department_name}。同一张申请里新建的部门也会出现在列表中`}
      />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitStatusDialog({ code, current, ...props }: UnitDialogProps) {
  const next: UnitStatus = current.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`${next === 'SUSPENDED' ? '暂停' : '恢复'}服务单元：${current.name}`}
      description={currentDesc(current)}
      build={() =>
        requireFields([['effective_date', !!day, '请选择生效日期']]) ?? {
          kind: 'service_unit.change_status',
          code,
          effective_date: day,
          status: next,
        }
      }
    >
      <p className="text-xs">
        状态：{UNIT_STATUS[current.status as UnitStatus]} → {UNIT_STATUS[next]}
      </p>
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitRetireDialog({ code, current, ...props }: UnitDialogProps) {
  const [validTo, setValidTo] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`永久退出：${current.name}`}
      description="终态，不可恢复；代码永久绑定，不会释放给新单元。最后有效日当天仍有效，次日起查不到该单元。"
      build={() =>
        requireFields([
          ['valid_to', !!validTo, '请选择最后有效日'],
          ['valid_to', validTo >= current.valid_from, `最后有效日不能早于当前版本的开始日 ${current.valid_from}`],
        ]) ?? { kind: 'service_unit.retire', code, valid_to: validTo }
      }
    >
      <TextField label="最后有效日" name="valid_to" type="date" required value={validTo} onChange={setValidTo} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 拆分与合并
// 只填一个生效日 D：前身最后有效日 = D 前一日，后继自 D 起。后继是新身份、新代码，
// 不继承前身的版本历史，也不自动迁移引用；部门、院区、运营主体可与前身不同。
interface Successor {
  name: string
  unit_type: string
  dept: string
  campus: string
  inst: string
  code: string
}

function successorFrom(current: ServiceUnitVersionOut, unitType: string, name = ''): Successor {
  return {
    name,
    unit_type: unitType,
    dept: current.department_code,
    campus: current.campus_code,
    inst: current.institution_code,
    code: '',
  }
}

function successorChecks(s: Successor, key: string, label: string): [string, boolean, string][] {
  return [
    [`${key}.name`, !!s.name.trim(), `请填写${label}名称`],
    [`${key}.unit_type`, !!s.unit_type, `请选择${label}类型`],
    [`${key}.dept`, !!s.dept, `请选择${label}所属部门`],
    [`${key}.campus`, !!s.campus, `请选择${label}所属院区`],
    [`${key}.inst`, !!s.inst, `请选择${label}运营主体`],
    [`${key}.code`, CODE_RE.test(s.code.trim()), `请填写${label}代码（字母、数字、点、下划线、短横线）`],
  ]
}

function successorItem(s: Successor) {
  return {
    code: s.code.trim(),
    unit_type: s.unit_type as ServiceUnitCreateUnitType,
    fields: { name: s.name.trim(), department_code: s.dept, campus_code: s.campus, institution_code: s.inst },
  }
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('sv-SE')
}

function SuccessorFields({
  value: s,
  onChange,
  fieldKey,
  title,
  onRemove,
}: {
  value: Successor
  onChange: (s: Successor) => void
  fieldKey: string
  title: string
  onRemove?: () => void
}) {
  const { unitTypeOptions } = useApp()
  const set = (patch: Partial<Successor>) => onChange({ ...s, ...patch })
  return (
    <fieldset className="border-line-subtle grid gap-3 rounded-md border p-3">
      <legend className="text-fg-strong flex w-full items-center px-1 text-xs font-semibold">
        {title}
        {onRemove && (
          <button type="button" className="text-fg-muted hover:text-fg ml-auto text-caption font-normal hover:underline" onClick={onRemove}>
            移除
          </button>
        )}
      </legend>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <TextField label="名称" name={`${fieldKey}.name`} required value={s.name} onChange={(name) => set({ name })} />
        <SelectField
          label="单元类型"
          name={`${fieldKey}.unit_type`}
          required
          value={s.unit_type}
          onChange={(unit_type) => set({ unit_type })}
          options={unitTypeOptions.map((o) => ({ value: o.code, label: o.name }))}
        />
      </div>
      <DepartmentSelect label="所属部门" name={`${fieldKey}.dept`} required value={s.dept} onChange={(dept) => set({ dept })} />
      <div className="grid grid-cols-2 gap-3">
        <CampusSelect label="所属院区" name={`${fieldKey}.campus`} required value={s.campus} onChange={(campus) => set({ campus })} />
        <InstitutionSelect
          label="所属运营主体"
          name={`${fieldKey}.inst`}
          required
          value={s.inst}
          onChange={(inst) => set({ inst })}
          campusCode={s.campus}
        />
      </div>
      <TextField
        label="单元代码"
        name={`${fieldKey}.code`}
        required
        value={s.code}
        onChange={(code) => set({ code })}
        hint="新身份、新代码；不能沿用前身代码"
      />
    </fieldset>
  )
}

export function UnitSplitDialog({ code, current, unitType, ...props }: UnitDialogProps & { unitType: string }) {
  const [day, setDay] = useEffectiveDate()
  const [succ, setSucc] = useState<Successor[]>([successorFrom(current, unitType), successorFrom(current, unitType)])
  const update = (i: number) => (s: Successor) => setSucc(succ.map((x, j) => (j === i ? s : x)))
  return (
    <ItemDialog
      {...props}
      title={`拆分服务单元：${current.name}`}
      description="把一个单元拆成至少两个。前身在生效日前一天退出，后继自生效日起；后继是新身份、新代码，不继承前身的历史，引用也不自动迁移。"
      build={() => {
        const missing = requireFields([
          ['effective_date', !!day, '请选择生效日期'],
          ['effective_date', !day || day > current.valid_from, `生效日须晚于当前版本的开始日 ${current.valid_from}`],
          ...succ.flatMap((s, i) => successorChecks(s, `s${i}`, `后继 ${i + 1} 的`)),
          ...succ.map((s, i): [string, boolean, string] => [`s${i}.code`, s.code.trim() !== code, '后继须用新代码，不能沿用前身代码']),
          ...succ.map((s, i): [string, boolean, string] => [
            `s${i}.code`,
            succ.findIndex((x) => x.code.trim() === s.code.trim()) === i,
            '后继单元代码不能重复',
          ]),
        ])
        return missing ?? { kind: 'service_unit.split', code, effective_date: day, successors: succ.map(successorItem) }
      }}
    >
      <TextField
        label="生效日期"
        name="effective_date"
        type="date"
        required
        value={day}
        onChange={setDay}
        hint={day ? `${current.name} 的最后有效日为 ${dayBefore(day)}，后继自 ${day} 起` : undefined}
      />
      {succ.map((s, i) => (
        <SuccessorFields
          key={i}
          value={s}
          onChange={update(i)}
          fieldKey={`s${i}`}
          title={`后继单元 ${i + 1}`}
          onRemove={succ.length > 2 ? () => setSucc(succ.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      <button
        type="button"
        className="text-fg-secondary hover:text-fg justify-self-start text-xs hover:underline"
        onClick={() => setSucc([...succ, successorFrom(current, unitType)])}
      >
        + 再加一个后继单元
      </button>
    </ItemDialog>
  )
}

export function UnitMergeDialog({ code, current, unitType, ...props }: UnitDialogProps & { unitType: string }) {
  const [day, setDay] = useEffectiveDate()
  const [others, setOthers] = useState<string[]>([''])
  const [succ, setSucc] = useState<Successor>(successorFrom(current, unitType, current.name))
  const chosen = [code, ...others.filter(Boolean)]
  return (
    <ItemDialog
      {...props}
      title={`合并服务单元：${current.name}`}
      description="把至少两个单元合并成一个新单元。全部前身在生效日前一天退出，后继自生效日起；后继是新身份、新代码，不继承前身的历史。"
      build={() => {
        const missing = requireFields([
          ['effective_date', !!day, '请选择生效日期'],
          ...others.map((o, i): [string, boolean, string] => [`p${i}`, !!o, '请选择要一并合并的单元']),
          ...successorChecks(succ, 'succ', '后继单元'),
          ['succ.code', !chosen.includes(succ.code.trim()), '后继须用新代码，不能沿用前身代码'],
        ])
        return missing ?? { kind: 'service_unit.merge', codes: chosen, effective_date: day, successor: successorItem(succ) }
      }}
    >
      <TextField
        label="生效日期"
        name="effective_date"
        type="date"
        required
        value={day}
        onChange={setDay}
        hint={day ? `前身的最后有效日为 ${dayBefore(day)}，后继自 ${day} 起` : undefined}
      />
      <p className="text-xs">
        前身：<span className="text-fg-strong">{current.name}</span>（{code}），以及：
      </p>
      {others.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2">
          <UnitSelect
            label={`前身单元 ${i + 2}`}
            name={`p${i}`}
            required
            value={o}
            onChange={(v) => setOthers(others.map((x, j) => (j === i ? v : x)))}
            exclude={chosen.filter((c) => c !== o)}
            day={day ? dayBefore(day) : undefined}
            hint={day ? `列出 ${dayBefore(day)}（生效日前一天）仍有效的单元` : '先选生效日期，再选要一并合并的单元'}
          />
          {others.length > 1 && (
            <button
              type="button"
              className="text-fg-muted hover:text-fg pb-2 text-caption hover:underline"
              onClick={() => setOthers(others.filter((_, j) => j !== i))}
            >
              移除
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-fg-secondary hover:text-fg justify-self-start text-xs hover:underline"
        onClick={() => setOthers([...others, ''])}
      >
        + 再选一个前身单元
      </button>
      <SuccessorFields value={succ} onChange={setSucc} fieldKey="succ" title="合并后的单元" />
    </ItemDialog>
  )
}
