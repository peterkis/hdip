// 部门与服务单元的变更表单。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应）。
// 引用其他对象一律“按名称选择”（ref-selects.tsx），代码由选择带出，操作人员不需要记代码。
import { useState } from 'react'
import type { DepartmentRow, ServiceUnitCreateUnitType, ServiceUnitVersionOut } from '@/api/generated/model'
import { CODE_HINT, CODE_RE, useEffectiveDate, type DialogProps } from '@/components/forms/change-forms'
import { diffPatch, orNull, requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { CampusSelect, DepartmentSelect, InstitutionSelect } from '@/components/forms/ref-selects'
import { useApp } from '@/lib/app-context'
import { DEPARTMENT_STATUS, UNIT_STATUS, type DepartmentStatus, type UnitStatus } from '@/lib/format'

// ------------------------------------------------------------------ 部门
export function DepartmentCreateDialog(props: DialogProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  return (
    <ItemDialog
      {...props}
      title="新建部门"
      description="部门不写院区、不拼院区；同一部门在多个院区 = 一个部门 + 多个服务单元。"
      build={() =>
        requireFields([
          ['name', !!name.trim(), '请填写部门名称'],
          ['code', !!code.trim(), '请填写部门代码'],
          ['code', CODE_RE.test(code.trim()), '代码只能用字母、数字、点、下划线、短横线'],
        ]) ?? { kind: 'department.create', code: code.trim(), name: name.trim() }
      }
    >
      <TextField label="名称" name="name" required value={name} onChange={setName} />
      <TextField label="部门代码" name="code" required value={code} onChange={setCode} hint={CODE_HINT} />
    </ItemDialog>
  )
}

export function DepartmentRenameDialog({ department, ...props }: DialogProps & { department: DepartmentRow }) {
  const [name, setName] = useState(department.name)
  return (
    <ItemDialog
      {...props}
      title={`部门改名：${department.name}`}
      description="部门暂无版本，确认后立即生效；按历史日期查询时也会显示新名称（改动前后记在变更申请里）。"
      build={() =>
        requireFields([
          ['name', !!name.trim(), '请填写新名称'],
          ['name', name.trim() !== department.name, '名称没有变化'],
        ]) ?? { kind: 'department.rename', code: department.code, name: name.trim() }
      }
    >
      <TextField label="新名称" name="name" required value={name} onChange={setName} />
    </ItemDialog>
  )
}

export function DepartmentStatusDialog({ department, ...props }: DialogProps & { department: DepartmentRow }) {
  const next: DepartmentStatus = department.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  return (
    <ItemDialog
      {...props}
      title={`${next === 'INACTIVE' ? '停用' : '恢复'}部门：${department.name}`}
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
