// 各类变更的表单。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应）。
import { useState } from 'react'
import { useListCampuses, useListInstitutions } from '@/api/generated/master/master'
import type { CampusVersionOut, InstitutionVersionOut, RelationOut } from '@/api/generated/model'
import { diffPatch, orNull, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { useApp } from '@/lib/app-context'
import {
  OPERATING_STATUS,
  OPERATING_STATUS_ORDER,
  RELATION_TYPE,
  today,
  type OperatingStatus,
  type RelationType,
} from '@/lib/format'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixedTarget?: number
}

const CODE_HINT = '字母、数字、点、下划线、短横线；一经使用永久绑定，退出后也不复用'
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function useEffectiveDate() {
  return useState(today)
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
      <TextField label="名称" required {...bind('name')} />
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
      build={() => {
        if (!CODE_RE.test(code.trim())) return '请填写有效的主体代码'
        if (!f.name.trim()) return '请填写名称'
        if (!validFrom) return '请填写生效日期'
        return {
          kind: 'institution.create',
          code: code.trim(),
          valid_from: validFrom,
          fields: institutionValues(f),
        }
      }}
    >
      <TextField label="主体代码" required value={code} onChange={setCode} hint={CODE_HINT} />
      <InstitutionFields f={f} set={setF} />
      <TextField label="生效日期" type="date" required value={validFrom} onChange={setValidFrom} />
    </ItemDialog>
  )
}

export function InstitutionReviseDialog({
  code,
  current,
  ...props
}: DialogProps & { code: string; current: InstitutionVersionOut }) {
  const [f, setF] = useState(toInstitutionForm(current))
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`修订主体 ${code}`}
      description={`当前版本自 ${current.valid_from} 起。修订在生效日起成为新版本，旧版本保留。`}
      build={() => {
        if (!f.name.trim()) return '名称不能为空'
        const changes = diffPatch(current, institutionValues(f))
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'institution.revise', code, effective_date: day, changes }
      }}
    >
      <InstitutionFields f={f} set={setF} />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 院区
const emptyCampus = {
  name: '',
  node_role: '',
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
    node_role: orNull(f.node_role),
    address: orNull(f.address),
    admin_division_code: orNull(f.admin_division_code),
    phone: orNull(f.phone),
    actual_open_date: orNull(f.actual_open_date),
  }
}

function CampusFields({ f, set }: { f: CampusForm; set: (f: CampusForm) => void }) {
  const { nodeRoleOptions } = useApp()
  const bind = (k: keyof CampusForm) => ({ value: f[k], onChange: (v: string) => set({ ...f, [k]: v }) })
  return (
    <>
      <TextField label="名称" required {...bind('name')} />
      <SelectField
        label="节点角色"
        allowEmpty
        options={nodeRoleOptions.map((o) => ({ value: o.code, label: o.name }))}
        {...bind('node_role')}
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
  const [status, setStatus] = useState<OperatingStatus>('PLANNING')
  const [validFrom, setValidFrom] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title="新建院区"
      description="院区不等于法人；运营主体通过“建立运营关系”绑定。"
      build={() => {
        if (!CODE_RE.test(code.trim())) return '请填写有效的院区代码'
        if (!f.name.trim()) return '请填写名称'
        return {
          kind: 'campus.create',
          code: code.trim(),
          valid_from: validFrom,
          operating_status: status,
          fields: campusValues(f),
        }
      }}
    >
      <TextField label="院区代码" required value={code} onChange={setCode} hint={CODE_HINT} />
      <CampusFields f={f} set={setF} />
      <SelectField
        label="初始运营状态"
        required
        value={status}
        onChange={(v) => setStatus(v as OperatingStatus)}
        options={statusOptions().slice(0, 3)}
      />
      <TextField label="生效日期" type="date" required value={validFrom} onChange={setValidFrom} />
    </ItemDialog>
  )
}

export function CampusReviseDialog({
  code,
  current,
  ...props
}: DialogProps & { code: string; current: CampusVersionOut }) {
  const [f, setF] = useState(toCampusForm(current))
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`修订院区资料 ${code}`}
      description={`当前版本自 ${current.valid_from} 起。运营状态请用“变更运营状态”。`}
      build={() => {
        if (!f.name.trim()) return '名称不能为空'
        const changes = diffPatch(current, campusValues(f))
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'campus.revise', code, effective_date: day, changes }
      }}
    >
      <CampusFields f={f} set={setF} />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function CampusStatusDialog({
  code,
  current,
  ...props
}: DialogProps & { code: string; current: OperatingStatus }) {
  const next = statusOptions(OPERATING_STATUS_ORDER.indexOf(current) + 1)
  const [status, setStatus] = useState<string>(next[0]?.value ?? '')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`变更运营状态 ${code}`}
      description={`当前为“${OPERATING_STATUS[current]}”。状态只能按 筹建 → 试运行 → 运行 → 停用 推进，停用后不可恢复。`}
      build={() => {
        if (!status) return '院区已停用，不能再变更运营状态'
        return {
          kind: 'campus.change_status',
          code,
          effective_date: day,
          operating_status: status as OperatingStatus,
        }
      }}
    >
      <SelectField label="新的运营状态" required value={status} onChange={setStatus} options={next} />
      <TextField label="生效日期" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 运营关系
export function RelationCreateDialog({
  institutionCode = '',
  campusCode = '',
  ...props
}: DialogProps & { institutionCode?: string; campusCode?: string }) {
  const { asOf } = useApp()
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf }, { query: { enabled: props.open } })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf }, { query: { enabled: props.open } })
  const [inst, setInst] = useState(institutionCode)
  const [campus, setCampus] = useState(campusCode)
  const [type, setType] = useState<RelationType>('OPERATE')
  const [primary, setPrimary] = useState('true')
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [validTo, setValidTo] = useState('')
  return (
    <ItemDialog
      {...props}
      title="建立运营关系"
      description="同一院区在重叠期间最多一个主要运营方。调整期间或主要方 = 关闭旧关系 + 新建。"
      build={() => {
        if (!inst.trim() || !campus.trim()) return '请填写主体代码和院区代码'
        if (validTo && validTo < validFrom) return '结束日不能早于开始日'
        return {
          kind: 'operator_relation.create',
          institution_code: inst.trim(),
          campus_code: campus.trim(),
          relation_type: type,
          is_primary: type === 'OPERATE' && primary === 'true',
          valid_from: validFrom,
          valid_to: orNull(validTo),
        }
      }}
    >
      <datalist id="institution-codes">
        {institutions.map((i) => (
          <option key={i.id} value={i.code}>
            {i.version.name}
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
      <TextField
        label="主体代码"
        required
        list="institution-codes"
        value={inst}
        onChange={setInst}
        hint="可选择已有主体；同一张申请里新建的主体直接填代码"
      />
      <TextField
        label="院区代码"
        required
        list="campus-codes"
        value={campus}
        onChange={setCampus}
        hint="可选择已有院区；同一张申请里新建的院区直接填代码"
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
        <TextField label="开始日" type="date" required value={validFrom} onChange={setValidFrom} />
        <TextField label="结束日" type="date" value={validTo} onChange={setValidTo} hint="不填为长期" />
      </div>
    </ItemDialog>
  )
}

export function RelationCloseDialog({ relation, ...props }: DialogProps & { relation: RelationOut }) {
  const [validTo, setValidTo] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`关闭运营关系 #${relation.id}`}
      description={`${relation.institution_name} → ${relation.campus_name}（${RELATION_TYPE[relation.relation_type as RelationType]}${relation.is_primary ? '，主要' : ''}），自 ${relation.valid_from} 起。结束日当天仍有效。`}
      build={() => {
        if (validTo < relation.valid_from) return '结束日不能早于开始日'
        return { kind: 'operator_relation.close', relation_id: relation.id, valid_to: validTo }
      }}
    >
      <TextField label="结束日" type="date" required value={validTo} onChange={setValidTo} />
    </ItemDialog>
  )
}
