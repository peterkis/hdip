// 部门的变更表单（D1）。每个表单只拼出一个变更项（kind 与后端 schemas/items.py 对应），保存到草稿后经提交、确认生效。
// 按操作动线原则：名称在前、代码在后；引用主体按名称选择；只给能选的（生命周期只列合法的下一步）。
import { useState } from 'react'
import { useListClassificationSchemes, useListDepartments } from '@/api/generated/master/master'
import type { DepartmentAliasOut, DepartmentRelationOut, DepartmentRow, DepartmentVersionOut } from '@/api/generated/model'
import { CODE_HINT, CODE_RE, useEffectiveDate, versionNote, type DialogProps } from '@/components/forms/change-forms'
import { diffPatch, orNull, requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog } from '@/components/forms/item-dialog'
import { CampusSelect, DepartmentSelect, InstitutionSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { TagInput } from '@/components/kit/tag-input'
import {
  DEPARTMENT_LIFECYCLE,
  DEPT_RELATION,
  ESTABLISHMENT_FORM,
  LIFECYCLE_NEXT,
  type DepartmentLifecycle,
  type DeptRelationKind,
  type EstablishmentForm,
} from '@/lib/format'

const MAIN_SCHEME = 'DEPT_MAIN_CLASS'
const formOptions = Object.entries(ESTABLISHMENT_FORM).map(([value, label]) => ({ value, label }))

/** 部门属性（新建与修订共用的那部分） */
interface Attrs {
  name: string
  short_name: string
  establishment_form: EstablishmentForm
  temporary_until: string
  admin_grade: string
  duties: string[]
  description: string
  basis_note: string
}

function toAttrs(v?: DepartmentVersionOut): Attrs {
  return {
    name: v?.name ?? '',
    short_name: v?.short_name ?? '',
    establishment_form: v?.establishment_form ?? 'STANDING',
    temporary_until: v?.temporary_until ?? '',
    admin_grade: v?.admin_grade ?? '',
    duties: v?.duties ?? [],
    description: v?.description ?? '',
    basis_note: v?.basis_note ?? '',
  }
}

function attrValues(a: Attrs) {
  return {
    name: a.name.trim(),
    short_name: orNull(a.short_name),
    establishment_form: a.establishment_form,
    temporary_until: a.establishment_form === 'TEMPORARY' ? orNull(a.temporary_until) : null,
    admin_grade: orNull(a.admin_grade),
    description: orNull(a.description),
    basis_note: orNull(a.basis_note),
  }
}

function attrChecks(a: Attrs): [string, boolean, string][] {
  return [
    ['name', !!a.name.trim(), '请填写部门名称'],
    ['temporary_until', a.establishment_form !== 'TEMPORARY' || !!a.temporary_until, '经批准的临时部门必须填期限'],
  ]
}

function AttrFields({ a, set }: { a: Attrs; set: (a: Attrs) => void }) {
  const bind = <K extends keyof Attrs>(k: K) => ({ value: a[k] as string, onChange: (v: string) => set({ ...a, [k]: v }) })
  return (
    <>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <TextField label="正式名称" name="name" required {...bind('name')} />
        <TextField label="简称" {...bind('short_name')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="设立形式"
          required
          value={a.establishment_form}
          onChange={(v) => set({ ...a, establishment_form: v as EstablishmentForm })}
          options={formOptions}
        />
        {a.establishment_form === 'TEMPORARY' ? (
          <TextField label="临时部门期限" name="temporary_until" type="date" required {...bind('temporary_until')} />
        ) : (
          <TextField label="行政级别" hint="选填；只有正式文件明确时才填" {...bind('admin_grade')} />
        )}
      </div>
      {a.establishment_form === 'TEMPORARY' && (
        <TextField label="行政级别" hint="选填；只有正式文件明确时才填" {...bind('admin_grade')} />
      )}
      <TagInput
        label="承担职责"
        value={a.duties}
        onChange={(duties) => set({ ...a, duties })}
        hint="自由标签，如临床诊疗、教学、科研、专业质量管理；回车添加"
        suggestions={['临床诊疗', '教学', '科研', '专业质量管理', '医疗技术服务', '业务管理', '运行保障']}
      />
      <TextField label="职责说明" {...bind('description')} />
      <TextField label="依据" hint="选填，文号或说明；不做依据对象、不校验" {...bind('basis_note')} />
    </>
  )
}

// ------------------------------------------------------------------ 新建
export function DepartmentCreateDialog(props: DialogProps) {
  const [a, setA] = useState<Attrs>(toAttrs())
  const [lifecycle, setLifecycle] = useState<'PREPARING' | 'ACTIVE'>('ACTIVE')
  const [inst, setInst] = useState('')
  const [code, setCode] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title="新建部门"
      description="部门身份不因院区、地点、负责人、服务形态或核算口径变化而改变。部门不写院区、名称和代码不拼院区。"
      build={() =>
        requireFields([
          ...attrChecks(a),
          ['code', !!code.trim(), '请填写部门代码'],
          ['code', CODE_RE.test(code.trim()), '代码只能用字母、数字、点、下划线、短横线'],
          ['valid_from', !!validFrom, '请选择设立日期'],
        ]) ?? {
          kind: 'department.create',
          code: code.trim(),
          valid_from: validFrom,
          lifecycle,
          institution_code: orNull(inst),
          duties: a.duties,
          ...attrValues(a),
        }
      }
    >
      <AttrFields a={a} set={setA} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="组织生命周期"
          required
          value={lifecycle}
          onChange={(v) => setLifecycle(v as 'PREPARING' | 'ACTIVE')}
          options={[
            { value: 'ACTIVE', label: '正式履职' },
            { value: 'PREPARING', label: '筹备（不计入部门数）' },
          ]}
        />
        <InstitutionSelect label="主体归属" name="institution" value={inst} onChange={setInst} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="部门代码" name="code" required value={code} onChange={setCode} hint={CODE_HINT} />
        <TextField label="设立日期" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} />
      </div>
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 修订属性
export function DepartmentReviseDialog({ code, current, ...props }: DialogProps & { code: string; current: DepartmentVersionOut }) {
  const [a, setA] = useState<Attrs>(toAttrs(current))
  const [day, setDay] = useEffectiveDate(current.valid_from)
  return (
    <ItemDialog
      {...props}
      title={`修订部门属性：${current.name}`}
      description={`${versionNote(current.valid_from)}修订在生效日起成为新版本；更名后旧名称即曾用名，身份与代码不变。`}
      build={() => {
        const missing = requireFields([...attrChecks(a), ['effective_date', !!day, '请选择生效日期']])
        if (missing) return missing
        const changes: Record<string, unknown> = diffPatch(current, attrValues(a))
        if (a.duties.join('\u0001') !== current.duties.join('\u0001')) changes.duties = a.duties
        if (Object.keys(changes).length === 0) return '没有修改任何内容'
        return { kind: 'department.revise', code, effective_date: day, changes }
      }}
    >
      <AttrFields a={a} set={setA} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 生命周期
export function DepartmentLifecycleDialog({ code, current, ...props }: DialogProps & { code: string; current: DepartmentVersionOut }) {
  const next = LIFECYCLE_NEXT[current.lifecycle as DepartmentLifecycle]
  const [target, setTarget] = useState<string>(next[0] ?? '')
  const [day, setDay] = useEffectiveDate(current.valid_from)
  return (
    <ItemDialog
      {...props}
      title={`变更组织生命周期：${current.name}`}
      description={`当前为“${DEPARTMENT_LIFECYCLE[current.lifecycle as DepartmentLifecycle]}”。筹备 → 正式履职 ⇄ 暂停履职 → 撤销。`}
      build={() => {
        if (next.length === 0) return '该部门已是终态，不能再变更'
        return (
          requireFields([
            ['lifecycle', !!target, '请选择新的生命周期'],
            ['effective_date', !!day, '请选择生效日期'],
          ]) ?? { kind: 'department.change_lifecycle', code, effective_date: day, lifecycle: target as 'ACTIVE' | 'SUSPENDED' | 'REVOKED' }
        )
      }}
    >
      <SelectField
        label="新的生命周期"
        name="lifecycle"
        required
        value={target}
        onChange={setTarget}
        options={next.map((l) => ({ value: l, label: DEPARTMENT_LIFECYCLE[l] }))}
      />
      {target === 'REVOKED' && (
        <Callout tone="warning" title="撤销是终态">撤销后不能恢复，代码永久绑定不再使用；以后重设相似部门须新建身份。</Callout>
      )}
      {target !== 'ACTIVE' && target && (
        <Callout title="依赖它的服务单元">若生效日之后仍有服务单元挂在该部门下，确认会被阻止并列出这些单元；可在同一张申请里先改挂它们。</Callout>
      )}
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 主分类
export function DepartmentClassifyDialog({
  code,
  name,
  currentCode,
  ...props
}: DialogProps & { code: string; name: string; currentCode?: string }) {
  const { data: schemes = [] } = useListClassificationSchemes()
  const scheme = schemes.find((s) => s.code === MAIN_SCHEME)
  const codes = (scheme?.codes ?? []).filter((c) => c.is_active && c.code !== currentCode)
  const [value, setValue] = useState('')
  const [day, setDay] = useEffectiveDate()
  const chosen = scheme?.codes.find((c) => c.code === value)
  const current = scheme?.codes.find((c) => c.code === currentCode)
  return (
    <ItemDialog
      {...props}
      title={`调整部门管理主分类：${name}`}
      description={`同一时点只有一个主分类；调整 = 旧分类止于生效日前一天、新分类自生效日起，历史保留。${current ? `当前：${current.name}。` : '当前未分类。'}`}
      build={() =>
        requireFields([
          ['class_code', !!value, '请选择主分类'],
          ['effective_date', !!day, '请选择生效日期'],
        ]) ?? { kind: 'department.classify', code, scheme_code: MAIN_SCHEME, class_code: value, effective_date: day }
      }
    >
      <SelectField
        label="主分类"
        name="class_code"
        required
        placeholder="请选择主分类"
        value={value}
        onChange={setValue}
        options={codes.map((c) => ({ value: c.code, label: c.name }))}
      />
      {chosen && (
        <Callout title={`按什么判断：${chosen.criterion ?? '—'}`}>{chosen.caution && `防止误判：${chosen.caution}`}</Callout>
      )}
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 主体归属
export function DepartmentAffiliateDialog({ code, name, ...props }: DialogProps & { code: string; name: string }) {
  const [inst, setInst] = useState('')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`调整主体归属：${name}`}
      description="同一时点只有一个主归属；跨院区不增加法人身份。"
      build={() =>
        requireFields([
          ['institution', !!inst, '请选择主体'],
          ['effective_date', !!day, '请选择生效日期'],
        ]) ?? { kind: 'department.affiliate', code, institution_code: inst, effective_date: day }
      }
    >
      <InstitutionSelect label="主体" name="institution" required value={inst} onChange={setInst} />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 别名
export function DepartmentAliasDialog({ code, name, ...props }: DialogProps & { code: string; name: string }) {
  const [kind, setKind] = useState<'ALIAS' | 'SEARCH_CODE'>('ALIAS')
  const [value, setValue] = useState('')
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`添加别名：${name}`}
      description="别名、检索码只用于查找，不参与身份判断。曾用名由更名自动保留，不用在这里添加。"
      build={() =>
        requireFields([
          ['value', !!value.trim(), '请填写别名'],
          ['valid_from', !!day, '请选择开始日期'],
        ]) ?? { kind: 'department.alias_add', code, alias_kind: kind, value: value.trim(), valid_from: day }
      }
    >
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <SelectField
          label="类别"
          value={kind}
          onChange={(v) => setKind(v as 'ALIAS' | 'SEARCH_CODE')}
          options={[
            { value: 'ALIAS', label: '别名' },
            { value: 'SEARCH_CODE', label: '检索码' },
          ]}
        />
        <TextField label="别名" name="value" required value={value} onChange={setValue} />
      </div>
      <TextField label="开始日期" name="valid_from" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function DepartmentAliasCloseDialog({ alias, ...props }: DialogProps & { alias: DepartmentAliasOut }) {
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`停用别名：${alias.value}`}
      description={`自 ${alias.valid_from} 起使用。停用日当天仍有效。`}
      build={() =>
        requireFields([
          ['valid_to', !!day, '请选择停用日'],
          ['valid_to', day >= alias.valid_from, `停用日不能早于开始日 ${alias.valid_from}`],
        ]) ?? { kind: 'department.alias_close', alias_id: alias.id, valid_to: day }
      }
    >
      <TextField label="停用日" name="valid_to" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 行政隶属（D2）
export function DepartmentParentDialog({
  code,
  name,
  currentParent,
  exclude,
  ...props
}: DialogProps & { code: string; name: string; currentParent?: { code: string; name: string } | null; exclude?: string[] }) {
  const [parent, setParent] = useState(currentParent?.code ?? '')
  const [day, setDay] = useEffectiveDate()
  // 不能选的 = 本部门 + 它在生效日的全部下级（否则成环）；按生效日而不是查看日期计算
  const { data: onDay = [] } = useListDepartments({ as_of: day || undefined })
  const self = onDay.find((d) => d.code === code)
  const blocked = [code, ...(exclude ?? []), ...(self ? subordinates(onDay, self.id) : [])]
  return (
    <ItemDialog
      {...props}
      title={`调整行政隶属：${name}`}
      description={`行政视图中同一时点只有一个直接上级，不能成环。${currentParent ? `当前上级：${currentParent.name}。` : '当前为一级部门。'}专业管理关系不受影响。`}
      build={() => {
        if ((parent || null) === (currentParent?.code ?? null)) return currentParent ? '上级没有变化' : '当前已是一级部门'
        return (
          requireFields([['effective_date', !!day, '请选择生效日期']]) ?? {
            kind: 'department.set_parent',
            code,
            view_code: 'ADMIN',
            parent_code: parent || null,
            effective_date: day,
          }
        )
      }}
    >
      <DepartmentSelect
        label="直接上级"
        name="parent"
        value={parent}
        onChange={setParent}
        exclude={blocked}
        placeholder="无上级（一级部门）"
        hint={`不列出本部门及其在 ${day || '生效日'} 的下级；选“无上级”即为一级部门`}
      />
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

function subordinates(rows: DepartmentRow[], id: number): string[] {
  const out: string[] = []
  const walk = (pid: number) => {
    for (const r of rows) {
      if (r.parent?.id === pid) {
        out.push(r.code)
        walk(r.id)
      }
    }
  }
  walk(id)
  return out
}

// ------------------------------------------------------------------ 管理关系（D2）
const RELATION_HELP: Record<DeptRelationKind, { from: string; to: string; scope: string; note: string }> = {
  PROFESSIONAL_MGMT: {
    from: '管理方',
    to: '被管理部门',
    scope: '管理事项',
    note: '按事项实施专业管理（如医务部对临床医疗工作、护理部对护理专业），不构成行政上级。',
  },
  COLLABORATION: { from: '协作一方', to: '协作另一方', scope: '协作范围', note: '与哪些部门共同承担某项服务或任务。' },
  CAMPUS_MGMT: {
    from: '院区管理组织',
    to: '对象部门（可空）',
    scope: '管理范围',
    note: '某院区管理组织在某院区对某范围有管理职责；院区与管理组织分别引用。',
  },
}

export function DepartmentRelationDialog({
  code,
  name,
  ...props
}: DialogProps & { code: string; name: string }) {
  const [kind, setKind] = useState<DeptRelationKind>('PROFESSIONAL_MGMT')
  // 默认本部门是“对象”一方（在被管理部门的页面上发起最常见）；可切换为本部门是管理方
  const [selfIsFrom, setSelfIsFrom] = useState(false)
  const [other, setOther] = useState('')
  const [campus, setCampus] = useState('')
  const [scope, setScope] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [validTo, setValidTo] = useState('')
  const help = RELATION_HELP[kind]
  const isCampus = kind === 'CAMPUS_MGMT'
  const from = selfIsFrom ? code : other
  const to = selfIsFrom ? other : code
  return (
    <ItemDialog
      {...props}
      title={`建立管理关系：${name}`}
      description={help.note}
      build={() =>
        requireFields([
          ['other', isCampus && selfIsFrom ? true : !!other, `请选择${selfIsFrom ? help.to : help.from}`],
          ['campus', !isCampus || !!campus, '请选择院区'],
          ['scope', !!scope.trim(), `请填写${help.scope}`],
          ['valid_from', !!validFrom, '请选择开始日'],
          ['valid_to', !validTo || validTo >= validFrom, '结束日不能早于开始日'],
        ]) ?? {
          kind: 'department.relation_create',
          relation_kind: kind,
          from_code: from,
          to_code: to || null,
          campus_code: isCampus ? campus : null,
          scope: scope.trim(),
          valid_from: validFrom,
          valid_to: orNull(validTo),
        }
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="关系类型"
          required
          value={kind}
          onChange={(v) => setKind(v as DeptRelationKind)}
          options={Object.entries(DEPT_RELATION).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          label={`${name}是`}
          required
          value={selfIsFrom ? 'from' : 'to'}
          onChange={(v) => setSelfIsFrom(v === 'from')}
          options={[
            { value: 'to', label: help.to.replace('（可空）', '') },
            { value: 'from', label: help.from },
          ]}
        />
      </div>
      <DepartmentSelect
        label={selfIsFrom ? help.to : help.from}
        name="other"
        required={!(isCampus && selfIsFrom)}
        value={other}
        onChange={setOther}
        exclude={code}
        placeholder={isCampus && selfIsFrom ? '不指定（整个院区）' : undefined}
      />
      {isCampus && <CampusSelect label="院区" name="campus" required value={campus} onChange={setCampus} />}
      <TextField label={help.scope} name="scope" required value={scope} onChange={setScope} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} />
        <TextField label="结束日" name="valid_to" type="date" value={validTo} onChange={setValidTo} hint="不填为长期" />
      </div>
    </ItemDialog>
  )
}

export function DepartmentRelationCloseDialog({ relation, ...props }: DialogProps & { relation: DepartmentRelationOut }) {
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`结束${DEPT_RELATION[relation.kind]}：${relation.scope}`}
      description={`${relation.from_department.name}${relation.to_department ? ` → ${relation.to_department.name}` : ''}，自 ${relation.valid_from} 起。结束日当天仍有效。`}
      build={() =>
        requireFields([
          ['valid_to', !!day, '请选择结束日'],
          ['valid_to', day >= relation.valid_from, `结束日不能早于开始日 ${relation.valid_from}`],
        ]) ?? { kind: 'department.relation_close', relation_id: relation.id, valid_to: day }
      }
    >
      <TextField label="结束日" name="valid_to" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}
