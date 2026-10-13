// 部门与服务单元的变更表单。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应）。
// 引用其他对象一律填代码（可从列表里选），所以同一张申请里新建的部门、院区也能直接填代码。
import { useState } from 'react'
import { useListCampuses, useListDepartments, useListInstitutions } from '@/api/generated/master/master'
import type { DepartmentRow, ServiceUnitCreateUnitType, ServiceUnitVersionOut } from '@/api/generated/model'
import {
  CODE_HINT,
  CODE_RE,
  useEffectiveDate,
  type DialogProps,
} from '@/components/forms/change-forms'
import { diffPatch, orNull, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { useApp } from '@/lib/app-context'
import { DEPARTMENT_STATUS, UNIT_STATUS, type DepartmentStatus, type UnitStatus } from '@/lib/format'

// ------------------------------------------------------------------ 代码候选
function useCodeLists(open: boolean) {
  const { asOf } = useApp()
  const { data: departments = [] } = useListDepartments({ as_of: asOf }, { query: { enabled: open } })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf }, { query: { enabled: open } })
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf }, { query: { enabled: open } })
  return { departments, campuses, institutions }
}

function CodeLists({ open }: { open: boolean }) {
  const { departments, campuses, institutions } = useCodeLists(open)
  return (
    <>
      <datalist id="department-codes">
        {departments
          .filter((d) => d.status === 'ACTIVE')
          .map((d) => (
            <option key={d.id} value={d.code}>
              {d.name}
            </option>
          ))}
      </datalist>
      <datalist id="campus-codes">
        {campuses.map((c) => (
          <option key={c.id} value={c.code}>
            {c.version.name}
          </option>
        ))}
      </datalist>
      <datalist id="institution-codes">
        {institutions.map((i) => (
          <option key={i.id} value={i.code}>
            {i.version.name}
          </option>
        ))}
      </datalist>
    </>
  )
}

const SAME_REQUEST_HINT = '可从列表选择；同一张申请里新建的对象直接填代码'

// ------------------------------------------------------------------ 部门
export function DepartmentCreateDialog(props: DialogProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  return (
    <ItemDialog
      {...props}
      title="新建部门"
      description="部门不写院区、不拼院区；同一部门在多个院区 = 一个部门 + 多个服务单元。"
      build={() => {
        if (!CODE_RE.test(code.trim())) return '请填写有效的部门代码'
        if (!name.trim()) return '请填写名称'
        return { kind: 'department.create', code: code.trim(), name: name.trim() }
      }}
    >
      <TextField label="部门代码" required value={code} onChange={setCode} hint={CODE_HINT} />
      <TextField label="名称" required value={name} onChange={setName} />
    </ItemDialog>
  )
}

export function DepartmentRenameDialog({ department, ...props }: DialogProps & { department: DepartmentRow }) {
  const [name, setName] = useState(department.name)
  return (
    <ItemDialog
      {...props}
      title={`部门改名 ${department.code}`}
      description="部门暂无版本，确认后立即生效；按历史日期查询时也会显示新名称（改动前后记在变更申请里）。"
      build={() => {
        if (!name.trim()) return '请填写名称'
        if (name.trim() === department.name) return '名称没有变化'
        return { kind: 'department.rename', code: department.code, name: name.trim() }
      }}
    >
      <TextField label="新名称" required value={name} onChange={setName} />
    </ItemDialog>
  )
}

export function DepartmentStatusDialog({ department, ...props }: DialogProps & { department: DepartmentRow }) {
  const next: DepartmentStatus = department.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  return (
    <ItemDialog
      {...props}
      title={`${next === 'INACTIVE' ? '停用' : '恢复'}部门 ${department.code} ${department.name}`}
      description={
        next === 'INACTIVE'
          ? '停用后不能被新建或改挂的单元选用；已有单元保留引用，并标出“所属部门已停用”。确认后立即生效。'
          : '恢复后可再被单元选用。确认后立即生效。'
      }
      build={() => ({ kind: 'department.change_status', code: department.code, status: next })}
    >
      <p className="text-xs">
        状态：{DEPARTMENT_STATUS[department.status as DepartmentStatus]} → {DEPARTMENT_STATUS[next]}
      </p>
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 服务单元
export function UnitCreateDialog({
  departmentCode = '',
  campusCode = '',
  ...props
}: DialogProps & { departmentCode?: string; campusCode?: string }) {
  const { unitTypeOptions } = useApp()
  const { campuses } = useCodeLists(props.open)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [unitType, setUnitType] = useState('')
  const [dept, setDept] = useState(departmentCode)
  const [campus, setCampus] = useState(campusCode)
  const [inst, setInst] = useState('')
  const [phone, setPhone] = useState('')
  const [scope, setScope] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()

  // 选了院区而运营主体还空着时，带出该院区的主要运营方
  const primary = campuses.find((c) => c.code === campus.trim())?.primary_operator?.code
  const instValue = inst || primary || ''

  return (
    <ItemDialog
      {...props}
      title="新建服务单元"
      description="服务单元 = 部门 × 院区 × 运营主体 × 期间。服务方向、接诊形式、换房间都不产生新单元。"
      build={() => {
        if (!CODE_RE.test(code.trim())) return '请填写有效的单元代码'
        if (!name.trim()) return '请填写名称'
        if (!unitType) return '请选择单元类型'
        if (!dept.trim() || !campus.trim() || !instValue.trim()) return '请填写所属部门、院区和运营主体'
        return {
          kind: 'service_unit.create',
          code: code.trim(),
          unit_type: unitType as ServiceUnitCreateUnitType,
          valid_from: validFrom,
          fields: {
            name: name.trim(),
            department_code: dept.trim(),
            campus_code: campus.trim(),
            institution_code: instValue.trim(),
            phone: orNull(phone),
            scope_note: orNull(scope),
          },
        }
      }}
    >
      <CodeLists open={props.open} />
      <TextField
        label="单元代码"
        required
        value={code}
        onChange={setCode}
        hint={`${CODE_HINT}；不要由部门代码 + 院区拼出`}
      />
      <TextField label="名称" required value={name} onChange={setName} />
      <SelectField
        label="单元类型"
        required
        allowEmpty
        value={unitType}
        onChange={setUnitType}
        options={unitTypeOptions.map((o) => ({ value: o.code, label: `${o.name}（${o.code}）` }))}
        hint="类型不允许修订；职责变化走拆分或新建"
      />
      <TextField label="所属部门代码" required list="department-codes" value={dept} onChange={setDept} hint={SAME_REQUEST_HINT} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="院区代码" required list="campus-codes" value={campus} onChange={setCampus} />
        <TextField
          label="运营主体代码"
          required
          list="institution-codes"
          value={instValue}
          onChange={setInst}
          hint={!inst && primary ? '已带出该院区的主要运营方' : undefined}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="电话" value={phone} onChange={setPhone} />
        <TextField label="生效日期" type="date" required value={validFrom} onChange={setValidFrom} />
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
      title={`修订服务单元 ${code}`}
      description={currentDesc(current)}
      build={() => {
        if (!f.name.trim()) return '名称不能为空'
        const changes = diffPatch(current, {
          name: f.name.trim(),
          phone: orNull(f.phone),
          scope_note: orNull(f.scope_note),
        })
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'service_unit.revise', code, effective_date: day, changes }
      }}
    >
      <TextField label="名称" required {...bind('name')} />
      <TextField label="电话" {...bind('phone')} />
      <TextField label="范围说明" {...bind('scope_note')} />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
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
      title={`重新绑定 ${code}`}
      description={`换院区或运营主体。新院区须非停用，运营主体与之须有覆盖整个期间的“运营”关系。${currentDesc(current)}`}
      build={() => {
        const c = campus.trim()
        const i = inst.trim()
        if (!c || !i) return '院区和运营主体都不能为空'
        if (c === current.campus_code && i === current.institution_code) return '院区和运营主体都没有变化'
        return {
          kind: 'service_unit.rebind',
          code,
          effective_date: day,
          ...(c !== current.campus_code && { campus_code: c }),
          ...(i !== current.institution_code && { institution_code: i }),
        }
      }}
    >
      <CodeLists open={props.open} />
      <TextField
        label="院区代码"
        required
        list="campus-codes"
        value={campus}
        onChange={setCampus}
        hint={`当前：${current.campus_code} ${current.campus_name}`}
      />
      <TextField
        label="运营主体代码"
        required
        list="institution-codes"
        value={inst}
        onChange={setInst}
        hint={`当前：${current.institution_code} ${current.institution_name}`}
      />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitChangeDepartmentDialog({ code, current, ...props }: UnitDialogProps) {
  const [dept, setDept] = useState('')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`更换所属部门 ${code}`}
      description={`按生效日之前的日期回溯，仍显示原部门。${currentDesc(current)}`}
      build={() => {
        const d = dept.trim()
        if (!d) return '请填写新的所属部门代码'
        if (d === current.department_code) return '所属部门没有变化'
        return { kind: 'service_unit.change_department', code, effective_date: day, department_code: d }
      }}
    >
      <CodeLists open={props.open} />
      <TextField
        label="新的所属部门代码"
        required
        list="department-codes"
        value={dept}
        onChange={setDept}
        hint={`当前：${current.department_code} ${current.department_name}。${SAME_REQUEST_HINT}`}
      />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitStatusDialog({ code, current, ...props }: UnitDialogProps) {
  const next: UnitStatus = current.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`${next === 'SUSPENDED' ? '暂停' : '恢复'}服务单元 ${code}`}
      description={currentDesc(current)}
      build={() => ({ kind: 'service_unit.change_status', code, effective_date: day, status: next })}
    >
      <p className="text-xs">
        状态：{UNIT_STATUS[current.status as UnitStatus]} → {UNIT_STATUS[next]}
      </p>
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function UnitRetireDialog({ code, current, ...props }: UnitDialogProps) {
  const [validTo, setValidTo] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`永久退出 ${code} ${current.name}`}
      description="终态，不可恢复；代码永久绑定，不会释放给新单元。最后有效日当天仍有效，次日起查不到该单元。"
      build={() => {
        if (validTo < current.valid_from) return `最后有效日不能早于当前版本的开始日 ${current.valid_from}`
        return { kind: 'service_unit.retire', code, valid_to: validTo }
      }}
    >
      <TextField label="最后有效日" type="date" required value={validTo} onChange={setValidTo} />
    </ItemDialog>
  )
}
