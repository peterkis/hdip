// 各类变更的表单。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应）。
import { useState } from 'react'
import type {
  CampusCreateOperatingStatus,
  CampusVersionOut,
  InstitutionVersionOut,
  RelationOut,
} from '@/api/generated/model'
import { diffPatch, orNull, requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { CampusSelect, InstitutionSelect, useStartFloor } from '@/components/forms/ref-selects'
import {
  OPERATING_STATUS,
  OPERATING_STATUS_ORDER,
  RELATION_TYPE,
  today,
  type OperatingStatus,
  type RelationType,
} from '@/lib/format'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixedTarget?: number
}

export const CODE_HINT = '字母、数字、点、下划线、短横线；一经使用永久绑定，退出后也不复用'
export const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * 生效日默认今天。给了当前版本的开始日且它尚未生效时，默认为该开始日：
 * 在开始日当天修订 = 更正这一版（原版本保留为“生效前已更正”），不必等到生效后再改。
 */
export function useEffectiveDate(versionStart?: string) {
  return useState(() => (versionStart && versionStart > today() ? versionStart : today()))
}

/** 修订表单的说明：当前版本尚未生效时，提示可直接更正 */
export function versionNote(validFrom: string): string {
  return validFrom > today()
    ? `当前版本自 ${validFrom} 起，尚未生效：生效日填 ${validFrom} 即直接更正这一版；填更晚的日期则从那天起再变。`
    : `当前版本自 ${validFrom} 起。`
}

// ------------------------------------------------------------------ 主体
const emptyInstitution = {
  name: '',
  nature: '',
  unified_credit_code: '',
  medical_reg_code: '',
  license_no: '',
  license_valid_from: '',
  license_valid_to: '',
}
type InstitutionForm = typeof emptyInstitution

function toInstitutionForm(v?: InstitutionVersionOut): InstitutionForm {
  if (!v) return { ...emptyInstitution }
  return Object.fromEntries(
    Object.keys(emptyInstitution).map((k) => [k, (v[k as keyof InstitutionVersionOut] as string) ?? '']),
  ) as InstitutionForm
}

function institutionValues(f: InstitutionForm) {
  return {
    name: f.name.trim(),
    nature: orNull(f.nature),
    unified_credit_code: orNull(f.unified_credit_code),
    medical_reg_code: orNull(f.medical_reg_code),
    license_no: orNull(f.license_no),
    license_valid_from: orNull(f.license_valid_from),
    license_valid_to: orNull(f.license_valid_to),
  }
}

function InstitutionFields({ f, set }: { f: InstitutionForm; set: (f: InstitutionForm) => void }) {
  const bind = (k: keyof InstitutionForm) => ({ value: f[k], onChange: (v: string) => set({ ...f, [k]: v }) })
  return (
    <>
      <TextField label="名称" name="name" required {...bind('name')} />
      <TextField label="主体性质" hint="按登记证照填写，不由院区名称推断" {...bind('nature')} />
      <TextField label="统一社会信用代码" {...bind('unified_credit_code')} />
      <TextField label="医疗机构登记代码" {...bind('medical_reg_code')} />
      <TextField label="执业许可证号" {...bind('license_no')} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="许可证有效期起" type="date" {...bind('license_valid_from')} />
        <TextField label="许可证有效期止" type="date" {...bind('license_valid_to')} />
      </div>
    </>
  )
}

export function InstitutionCreateDialog(props: DialogProps) {
  const [code, setCode] = useState('')
  const [f, setF] = useState(toInstitutionForm())
  const [validFrom, setValidFrom] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title="新建主体"
      build={() =>
        requireFields([
          ['name', !!f.name.trim(), '请填写名称'],
          ['code', !!code.trim(), '请填写主体代码'],
          ['code', CODE_RE.test(code.trim()), '代码只能用字母、数字、点、下划线、短横线'],
          ['valid_from', !!validFrom, '请选择生效日期'],
        ]) ?? {
          kind: 'institution.create',
          code: code.trim(),
          valid_from: validFrom,
          fields: institutionValues(f),
        }
      }
    >
      <InstitutionFields f={f} set={setF} />
      <TextField label="主体代码" name="code" required value={code} onChange={setCode} hint={CODE_HINT} />
      <TextField label="生效日期" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} />
    </ItemDialog>
  )
}

export function InstitutionReviseDialog({
  code,
  current,
  ...props
}: DialogProps & { code: string; current: InstitutionVersionOut }) {
  const [f, setF] = useState(toInstitutionForm(current))
  const [day, setDay] = useEffectiveDate(current.valid_from)
  return (
    <ItemDialog
      {...props}
      title={`修订主体 ${code}`}
      description={`${versionNote(current.valid_from)}修订在生效日起成为新版本，旧版本保留。`}
      build={() => {
        const missing = requireFields([
          ['name', !!f.name.trim(), '名称不能为空'],
          ['effective_date', !!day, '请选择生效日期'],
        ])
        if (missing) return missing
        const changes = diffPatch(current, institutionValues(f))
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'institution.revise', code, effective_date: day, changes }
      }}
    >
      <InstitutionFields f={f} set={setF} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 院区
const emptyCampus = {
  name: '',
  public_name: '',
  address: '',
  admin_division_code: '',
  phone: '',
  actual_open_date: '',
}
type CampusForm = typeof emptyCampus

function toCampusForm(v?: CampusVersionOut): CampusForm {
  if (!v) return { ...emptyCampus }
  return Object.fromEntries(
    Object.keys(emptyCampus).map((k) => [k, (v[k as keyof CampusVersionOut] as string) ?? '']),
  ) as CampusForm
}

function campusValues(f: CampusForm) {
  return {
    name: f.name.trim(),
    public_name: orNull(f.public_name),
    address: orNull(f.address),
    admin_division_code: orNull(f.admin_division_code),
    phone: orNull(f.phone),
    actual_open_date: orNull(f.actual_open_date),
  }
}

function CampusFields({ f, set }: { f: CampusForm; set: (f: CampusForm) => void }) {
  const bind = (k: keyof CampusForm) => ({ value: f[k], onChange: (v: string) => set({ ...f, [k]: v }) })
  return (
    <>
      <TextField label="名称" name="name" required {...bind('name')} />
      <TextField
        label="对外名称"
        hint="对外使用、与名称不同的叫法，如中心院区对外称“成都市中心医院”；相同则不填"
        {...bind('public_name')}
      />
      <TextField label="地址" {...bind('address')} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="行政区划代码" {...bind('admin_division_code')} />
        <TextField label="电话" {...bind('phone')} />
      </div>
      <TextField
        label="实际启用日期"
        type="date"
        hint="有证据的实际启用日，不填计划日期"
        {...bind('actual_open_date')}
      />
    </>
  )
}

const statusOptions = (from = 0) =>
  OPERATING_STATUS_ORDER.slice(from).map((s) => ({ value: s, label: OPERATING_STATUS[s] }))

export function CampusCreateDialog(props: DialogProps) {
  const [code, setCode] = useState('')
  const [f, setF] = useState(toCampusForm())
  const [status, setStatus] = useState<CampusCreateOperatingStatus>('PLANNING')
  const [validFrom, setValidFrom] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title="新建院区"
      description="院区不等于法人；运营主体通过“建立运营关系”绑定。"
      build={() =>
        requireFields([
          ['name', !!f.name.trim(), '请填写名称'],
          ['code', !!code.trim(), '请填写院区代码'],
          ['code', CODE_RE.test(code.trim()), '代码只能用字母、数字、点、下划线、短横线'],
          ['valid_from', !!validFrom, '请选择生效日期'],
        ]) ?? {
          kind: 'campus.create',
          code: code.trim(),
          valid_from: validFrom,
          operating_status: status,
          fields: campusValues(f),
        }
      }
    >
      <CampusFields f={f} set={setF} />
      <TextField label="院区代码" name="code" required value={code} onChange={setCode} hint={CODE_HINT} />
      <SelectField
        label="初始运营状态"
        required
        value={status}
        onChange={(v) => setStatus(v as CampusCreateOperatingStatus)}
        options={statusOptions().slice(0, 3)}
      />
      <TextField
        label="生效日期"
        name="valid_from"
        type="date"
        required
        value={validFrom}
        onChange={setValidFrom}
        hint="院区在主数据里开始存在的日子，筹建期也算——通常就是决定筹建、开始准备数据的那天。开诊那天改运营状态为运行，不必等到那时才建院区"
      />
    </ItemDialog>
  )
}

export function CampusReviseDialog({
  code,
  current,
  ...props
}: DialogProps & { code: string; current: CampusVersionOut }) {
  const [f, setF] = useState(toCampusForm(current))
  const [day, setDay] = useEffectiveDate(current.valid_from)
  return (
    <ItemDialog
      {...props}
      title={`修订院区资料 ${code}`}
      description={`${versionNote(current.valid_from)}运营状态请用“变更运营状态”。`}
      build={() => {
        const missing = requireFields([
          ['name', !!f.name.trim(), '名称不能为空'],
          ['effective_date', !!day, '请选择生效日期'],
        ])
        if (missing) return missing
        const changes = diffPatch(current, campusValues(f))
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'campus.revise', code, effective_date: day, changes }
      }}
    >
      <CampusFields f={f} set={setF} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function CampusStatusDialog({
  code,
  name,
  current,
  ...props
}: DialogProps & { code: string; name: string; current: OperatingStatus }) {
  const next = statusOptions(OPERATING_STATUS_ORDER.indexOf(current) + 1)
  const [status, setStatus] = useState<string>(next[0]?.value ?? '')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`变更运营状态：${name}`}
      description={`当前为“${OPERATING_STATUS[current]}”。状态只能按 筹建 → 试运行 → 运行 → 停用 推进，停用后不可恢复。`}
      build={() => {
        if (next.length === 0) return '院区已停用，不能再变更运营状态'
        return (
          requireFields([
            ['status', !!status, '请选择新的运营状态'],
            ['effective_date', !!day, '请选择生效日期'],
          ]) ?? {
            kind: 'campus.change_status',
            code,
            effective_date: day,
            operating_status: status as OperatingStatus,
          }
        )
      }}
    >
      <SelectField label="新的运营状态" name="status" required value={status} onChange={setStatus} options={next} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 运营关系
export function RelationCreateDialog({
  institutionCode = '',
  campusCode = '',
  ...props
}: DialogProps & { institutionCode?: string; campusCode?: string }) {
  const [inst, setInst] = useState(institutionCode)
  const [campus, setCampus] = useState(campusCode)
  const [type, setType] = useState<RelationType>('OPERATE')
  const [primary, setPrimary] = useState('true')
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [validTo, setValidTo] = useState('')
  const startHint = useStartFloor(validFrom, setValidFrom, { campus, institution: inst })
  return (
    <ItemDialog
      {...props}
      title="建立运营关系"
      description="同一院区在重叠期间最多一个主要运营方。调整期间或主要方 = 关闭旧关系 + 新建。"
      build={() =>
        requireFields([
          ['institution', !!inst, '请选择主体'],
          ['campus', !!campus, '请选择院区'],
          ['valid_from', !!validFrom, '请选择开始日'],
          ['valid_to', !validTo || validTo >= validFrom, '结束日不能早于开始日'],
        ]) ?? {
          kind: 'operator_relation.create',
          institution_code: inst,
          campus_code: campus,
          relation_type: type,
          is_primary: type === 'OPERATE' && primary === 'true',
          valid_from: validFrom,
          valid_to: orNull(validTo),
        }
      }
    >
      <InstitutionSelect
        label="主体"
        name="institution"
        required
        value={inst}
        onChange={setInst}
        hint="同一张申请里新建的主体也会出现在列表中"
      />
      <CampusSelect
        label="院区"
        name="campus"
        required
        value={campus}
        onChange={setCampus}
        hint="同一张申请里新建的院区也会出现在列表中"
      />
      <SelectField
        label="关系类型"
        required
        value={type}
        onChange={(v) => setType(v as RelationType)}
        options={Object.entries(RELATION_TYPE).map(([value, label]) => ({ value, label }))}
      />
      {type === 'OPERATE' && (
        <SelectField
          label="是否主要运营方"
          required
          value={primary}
          onChange={setPrimary}
          options={[
            { value: 'true', label: '是' },
            { value: 'false', label: '否' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} hint={startHint} />
        <TextField label="结束日" name="valid_to" type="date" value={validTo} onChange={setValidTo} hint="不填为长期" />
      </div>
    </ItemDialog>
  )
}

export function RelationCloseDialog({ relation, ...props }: DialogProps & { relation: RelationOut }) {
  const [validTo, setValidTo] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title="关闭运营关系"
      description={`${relation.institution_name} → ${relation.campus_name}（${RELATION_TYPE[relation.relation_type as RelationType]}${relation.is_primary ? '，主要' : ''}），自 ${relation.valid_from} 起。结束日当天仍有效。`}
      build={() =>
        requireFields([
          ['valid_to', !!validTo, '请选择结束日'],
          ['valid_to', validTo >= relation.valid_from, `结束日不能早于开始日 ${relation.valid_from}`],
        ]) ?? { kind: 'operator_relation.close', relation_id: relation.id, valid_to: validTo }
      }
    >
      <TextField label="结束日" name="valid_to" type="date" required value={validTo} onChange={setValidTo} />
    </ItemDialog>
  )
}
