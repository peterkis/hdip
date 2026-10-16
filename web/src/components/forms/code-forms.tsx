// 外部标识与服务单元分类的变更表单（D3）。每个表单只拼出一个变更项，保存到草稿后经提交、确认生效。
// 原则：代码跟着它标识的对象走；来源只知道部门就映射部门，不推测单元；同一代码同一时点只有一个解释。
import { useState } from 'react'
import { useListClassificationSchemes, useListSourceSystems } from '@/api/generated/master/master'
import type { AssignmentOut, ClassificationSchemeOut, DepartmentClassificationOut, ExternalCodeRow } from '@/api/generated/model'
import { useEffectiveDate, type DialogProps } from '@/components/forms/change-forms'
import { orNull, requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog, useDraftItems } from '@/components/forms/item-dialog'
import { CampusSelect, DepartmentSelect, UnitSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { useApp } from '@/lib/app-context'
import { TARGET_TYPE, UNMODELED_TYPE, type TargetType, type UnmodeledType } from '@/lib/format'

/** 字典选择：值为“系统代码/字典代码” */
function NamespaceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { asOf } = useApp()
  const { data: systems = [] } = useListSourceSystems({ as_of: asOf })
  const options = systems
    .filter((s) => s.is_active)
    .flatMap((s) =>
      s.namespaces.filter((n) => n.is_active).map((n) => ({ value: `${s.code}/${n.code}`, label: `${s.name} · ${n.name}` })),
    )
  return (
    <SelectField
      label="来源字典"
      name="namespace"
      required
      value={value}
      onChange={onChange}
      options={options}
      placeholder="请选择来源系统与字典"
      hint={options.length === 0 ? '还没有登记来源系统与字典，请先在台账页“来源系统”里登记' : undefined}
    />
  )
}

function splitNs(v: string) {
  const [system_code, namespace_code] = v.split('/')
  return { system_code, namespace_code }
}

// ------------------------------------------------------------------ 登记
export function ExternalCodeRegisterDialog({ namespace: initialNs = '', ...props }: DialogProps & { namespace?: string }) {
  const [ns, setNs] = useState(initialNs)
  const [code, setCode] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [note, setNote] = useState('')
  return (
    <ItemDialog
      {...props}
      title="登记外部代码"
      description="台账里的一条源记录。只登记、不解释时，它在任何日期都是待裁决，不进入导出；解释另作一项，可放在同一张申请里。"
      build={() =>
        requireFields([
          ['namespace', !!ns, '请选择来源字典'],
          ['external_code', !!code.trim(), '请填写源代码'],
        ]) ?? {
          kind: 'external_code.register',
          ...splitNs(ns),
          external_code: code.trim(),
          source_name: orNull(sourceName),
          semantic_note: orNull(note),
        }
      }
    >
      <NamespaceSelect value={ns} onChange={setNs} />
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <TextField label="源代码" name="external_code" required value={code} onChange={setCode} hint="按源系统原样填写，前导零、点号、后缀都保留" />
        <TextField label="源名称" value={sourceName} onChange={setSourceName} hint="源系统里的名称，原样记录" />
      </div>
      <TextField label="含义说明" value={note} onChange={setNote} hint="经核实的含义；不确定就留空" />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 解释
const TARGET_HELP: Record<TargetType, string> = {
  department: '代码代表整个部门（来源只知道部门）。不要因为它“看起来属于某单元”就推测到单元。',
  service_unit: '代码明确到具体的服务单元（如某院区的门诊、病房）。汇总到部门时沿单元的所属部门往上走，不另映射部门。',
  unmodeled: '已经核实：代码代表护理单元、病区、地点等本平台尚未建模的对象。将来建模后结束这条解释、再指向新对象。',
}

export function ExternalCodeAssignDialog({ code: fixed, ...props }: DialogProps & { code?: ExternalCodeRow }) {
  const draft = useDraftItems()
  const [ns, setNs] = useState(fixed ? `${fixed.system_code}/${fixed.namespace_code}` : '')
  const [extCode, setExtCode] = useState(fixed?.code ?? '')
  const [target, setTarget] = useState<TargetType>('department')
  const [dept, setDept] = useState('')
  const [unit, setUnit] = useState('')
  const [unmodeled, setUnmodeled] = useState<UnmodeledType | ''>('')
  const [campus, setCampus] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [validTo, setValidTo] = useState('')
  const [evidence, setEvidence] = useState('')
  const registeredInDraft = draft.some(
    (i) => i.kind === 'external_code.register' && `${i.system_code}/${i.namespace_code}` === ns && i.external_code === extCode.trim(),
  )
  const current = fixed?.current ?? []
  return (
    <ItemDialog
      {...props}
      title={fixed ? `解释外部代码：${fixed.code}${fixed.source_name ? ` ${fixed.source_name}` : ''}` : '解释外部代码'}
      description="说明这个代码自开始日起标识的是哪个对象。裁决待裁决的代码 = 新增一条解释，开始日可以在过去，不覆盖任何已有记录。"
      build={() =>
        requireFields([
          ['namespace', !!ns, '请选择来源字典'],
          ['external_code', !!extCode.trim(), '请填写源代码'],
          ['department', target !== 'department' || !!dept, '请选择部门'],
          ['unit', target !== 'service_unit' || !!unit, '请选择服务单元'],
          ['unmodeled', target !== 'unmodeled' || !!unmodeled, '请选择对象类别'],
          ['valid_from', !!validFrom, '请选择开始日'],
          ['valid_to', !validTo || validTo >= validFrom, '结束日不能早于开始日'],
        ]) ?? {
          kind: 'external_code.assign',
          ...splitNs(ns),
          external_code: extCode.trim(),
          target_type: target,
          department_code: target === 'department' ? dept : null,
          service_unit_code: target === 'service_unit' ? unit : null,
          unmodeled_type: target === 'unmodeled' ? (unmodeled as UnmodeledType) : null,
          campus_code: orNull(campus),
          valid_from: validFrom,
          valid_to: orNull(validTo),
          evidence_note: orNull(evidence),
        }
      }
    >
      {!fixed && (
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <NamespaceSelect value={ns} onChange={setNs} />
          <TextField
            label="源代码"
            name="external_code"
            required
            value={extCode}
            onChange={setExtCode}
            hint={registeredInDraft ? '本申请新登记的代码' : '须已登记，或在本申请里先登记'}
          />
        </div>
      )}
      {current.length > 0 && (
        <Callout tone="warning" title="这个代码当前已有解释">
          {current.map((a) => `${assignmentTarget(a)}（自 ${a.valid_from}${a.campus_name ? `，${a.campus_name}` : ''}）`).join('；')}
          。同一代码同一院区条件同一时点只能有一个解释：新解释的开始日须在原解释结束之后，或先在同一张申请里结束原解释。
        </Callout>
      )}
      <SelectField
        label="指向"
        required
        value={target}
        onChange={(v) => setTarget(v as TargetType)}
        options={Object.entries(TARGET_TYPE).map(([value, label]) => ({ value, label }))}
        hint={TARGET_HELP[target]}
      />
      {target === 'department' && <DepartmentSelect label="部门" name="department" required value={dept} onChange={setDept} />}
      {target === 'service_unit' && <UnitSelect label="服务单元" name="unit" required value={unit} onChange={setUnit} />}
      {target === 'unmodeled' && (
        <SelectField
          label="对象类别"
          name="unmodeled"
          required
          placeholder="请选择对象类别"
          value={unmodeled}
          onChange={(v) => setUnmodeled(v as UnmodeledType)}
          options={Object.entries(UNMODELED_TYPE).map(([value, label]) => ({ value, label }))}
        />
      )}
      <CampusSelect
        label="院区条件"
        name="campus"
        value={campus}
        onChange={setCampus}
        placeholder="不区分院区"
        hint="只有同一字典同一代码在不同院区指向不同对象时才填；同一时点要么都区分院区，要么都不区分"
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="开始日" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} />
        <TextField label="结束日" name="valid_to" type="date" value={validTo} onChange={setValidTo} hint="不填为长期；历史代码复用时填写" />
      </div>
      <TextField label="判定说明" value={evidence} onChange={setEvidence} hint="选填：为什么这样判定（如名称一致、字典说明、经某科室确认）" />
    </ItemDialog>
  )
}

export function assignmentTarget(a: AssignmentOut): string {
  if (a.department) return `部门 ${a.department.name}`
  if (a.service_unit) return `服务单元 ${a.service_unit.name}`
  return `对象未建模（${UNMODELED_TYPE[a.unmodeled_type as UnmodeledType] ?? a.unmodeled_type}）`
}

export function AssignmentCloseDialog({
  assignment,
  code,
  ...props
}: DialogProps & { assignment: AssignmentOut; code: ExternalCodeRow }) {
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`结束解释：${code.code} → ${assignmentTarget(assignment)}`}
      description={`自 ${assignment.valid_from} 起。结束日当天仍有效；之后若没有新解释，该代码自次日起为待裁决。`}
      build={() =>
        requireFields([
          ['valid_to', !!day, '请选择结束日'],
          ['valid_to', day >= assignment.valid_from, `结束日不能早于开始日 ${assignment.valid_from}`],
        ]) ?? { kind: 'external_code.assignment_close', assignment_id: assignment.id, valid_to: day }
      }
    >
      <TextField label="结束日" name="valid_to" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

// ------------------------------------------------------------------ 分类（部门的外部分类方案、服务单元分类）
// 部门管理主分类有专门的表单（department-forms.tsx），这里不列它。
type ClassOwner = 'department' | 'unit'

export function ClassifyDialog({ owner, code, name, ...props }: DialogProps & { owner: ClassOwner; code: string; name: string }) {
  const { data: schemes = [] } = useListClassificationSchemes()
  const meaningOf = (s: ClassificationSchemeOut) => (owner === 'department' ? s.meaning_for_department : s.meaning_for_unit)
  const usable = schemes.filter((s) => s.is_active && meaningOf(s) && s.code !== 'DEPT_MAIN_CLASS')
  const [schemeCode, setSchemeCode] = useState('')
  const [value, setValue] = useState('')
  const [day, setDay] = useEffectiveDate()
  const scheme = usable.find((s) => s.code === schemeCode)
  const what = owner === 'department' ? '部门' : '服务单元'
  return (
    <ItemDialog
      {...props}
      title={`设置${what}分类：${name}`}
      description={
        owner === 'department'
          ? '按某个分类方案（如病案科室分类、诊疗科目）给部门赋值。部门分类不会自动下发给它的服务单元；多个对象归入同一类别，不表示它们是同一个对象。'
          : '服务单元的分类与所属部门的分类相互独立，部门分类不会自动下发。多个对象归入同一类别，不表示它们是同一个对象。'
      }
      build={() =>
        requireFields([
          ['scheme', !!schemeCode, '请选择分类方案'],
          ['class_code', !!value, '请选择分类'],
          ['effective_date', !!day, '请选择生效日期'],
        ]) ??
        (owner === 'department'
          ? { kind: 'department.classify', code, scheme_code: schemeCode, class_code: value, effective_date: day }
          : { kind: 'service_unit.classify', code, scheme_code: schemeCode, class_code: value, effective_date: day })
      }
    >
      <SelectField
        label="分类方案"
        name="scheme"
        required
        placeholder="请选择分类方案"
        value={schemeCode}
        onChange={(v) => {
          setSchemeCode(v)
          setValue('')
        }}
        options={usable.map((s) => ({ value: s.code, label: `${s.name}（${meaningOf(s)}）` }))}
        hint={usable.length === 0 ? `没有适用于${what}的分类方案；请在“分类方案”页写明方案用于${what}时的含义` : undefined}
      />
      {scheme && (
        <SelectField
          label="分类"
          name="class_code"
          required
          placeholder="请选择分类"
          value={value}
          onChange={setValue}
          options={scheme.codes.filter((c) => c.is_active).map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))}
          hint={scheme.is_exclusive ? '单选方案：同一时点只有一个，调整 = 旧分类止于生效日前一天' : '可多选方案：可同时有多个；不再适用的用“结束”'}
        />
      )}
      <TextField label="生效日期" name="effective_date" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}

export function ClassificationCloseDialog({
  owner,
  classification: c,
  ...props
}: DialogProps & { owner: ClassOwner; classification: DepartmentClassificationOut }) {
  const [day, setDay] = useEffectiveDate()
  return (
    <ItemDialog
      {...props}
      title={`结束分类：${c.scheme_name} · ${c.code} ${c.name}`}
      description={`自 ${c.valid_from} 起。最后有效日当天仍有效；按之前的日期回溯仍能看到这条分类。`}
      build={() =>
        requireFields([
          ['valid_to', !!day, '请选择最后有效日'],
          ['valid_to', day >= c.valid_from, `最后有效日不能早于开始日 ${c.valid_from}`],
        ]) ??
        (owner === 'department'
          ? { kind: 'department.classification_close', classification_id: c.id, valid_to: day }
          : { kind: 'service_unit.classification_close', classification_id: c.id, valid_to: day })
      }
    >
      <TextField label="最后有效日" name="valid_to" type="date" required value={day} onChange={setDay} />
    </ItemDialog>
  )
}
