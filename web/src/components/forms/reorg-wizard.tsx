// 部门组织变更向导（docs/部门组织变更-评估与分期.md 第一期）：
// ① 身份裁决 → ② 参与部门 → ③ 承接清单 → ④ 核对。一次生成一整张申请：新建部门、组织变更事件，
// 以及逐项处置依赖的变更项（单元改挂 / 退出、下级部门改挂、结束指向原部门的编码解释、新部门的上级与主分类）。
// 空白不等于“全部跟着走”：退出部门的每个单元、每个下级部门都要明确选择，系统不按名称推断、不默认。
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { createChangeRequest } from '@/api/generated/changes/changes'
import { getGetDepartmentDependenciesQueryOptions, useListClassificationSchemes, useListDepartments } from '@/api/generated/master/master'
import type { DepartmentDependencies } from '@/api/generated/model'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { CODE_HINT, CODE_RE, useEffectiveDate } from '@/components/forms/change-forms'
import { FormErrorsContext, requireFields, SelectField, TextField, type Option } from '@/components/forms/fields'
import type { ChangeItemInput } from '@/components/forms/item-dialog'
import { DepartmentSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { Steps, type StepItem } from '@/components/kit/steps'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/app-context'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'

type ReorgType = 'SPLIT' | 'SPLIT_OFF' | 'ABSORB' | 'MERGE'

const TYPES: { value: ReorgType; title: string; identity: string; example: string }[] = [
  { value: 'SPLIT', title: '整体拆分', identity: '原部门退出（被替代），新设两个及以上部门', example: '撤销呼吸内科，新设呼吸一科、呼吸二科' },
  { value: 'SPLIT_OFF', title: '分设', identity: '原部门继续存在（可同时改名），另新设部门承接部分职责', example: '呼吸内科更名为呼吸一科，另分设呼吸二科' },
  { value: 'ABSORB', title: '吸收合并', identity: '原部门退出，并入一个已有部门；承接部门身份不变', example: '核医学科并入放射科' },
  { value: 'MERGE', title: '合并新设', identity: '两个及以上原部门都退出，新设一个部门', example: '撤销甲、乙两科，新设丙科' },
]
export const REORG_TITLE: Record<ReorgType, string> = { SPLIT: '整体拆分', SPLIT_OFF: '分设', ABSORB: '吸收合并', MERGE: '合并新设' }

const STEP_LABELS = ['身份裁决', '参与部门', '承接清单', '核对']
const KEEP = '__keep'
const RETIRE = '__retire'
const TOP = '__top'
const MAIN_SCHEME = 'DEPT_MAIN_CLASS'

interface NewDept {
  name: string
  code: string
  scope: string
  parent: string
  mainClass: string
}

export interface ReorgSource {
  id: number
  code: string
  name: string
  institutionCode: string | null
  parentCode: string | null
  mainClass: string | null
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function DepartmentReorgWizard({
  open,
  onOpenChange,
  source,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: ReorgSource
}) {
  const { asOf } = useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [type, setType] = useState<ReorgType | ''>('')
  const [day, setDay] = useEffectiveDate()
  const [basis, setBasis] = useState('')
  const [sourceScope, setSourceScope] = useState('')
  const [rename, setRename] = useState('')
  const [target, setTarget] = useState('')
  const [others, setOthers] = useState<string[]>([''])
  const blank = (): NewDept => ({ name: '', code: '', scope: '', parent: source.parentCode ?? '', mainClass: source.mainClass ?? '' })
  const [news, setNews] = useState<NewDept[]>([blank(), blank()])
  const [unitTo, setUnitTo] = useState<Record<string, string>>({})
  const [childTo, setChildTo] = useState<Record<string, string>>({})
  const [otherMatters, setOtherMatters] = useState('')

  const { data: depts = [] } = useListDepartments({ as_of: asOf })
  const { data: schemes = [] } = useListClassificationSchemes()
  const mainCodes = (schemes.find((s) => s.code === MAIN_SCHEME)?.codes ?? []).filter((c) => c.is_active)
  const deptName = (code: string) => depts.find((d) => d.code === code)?.version.name ?? code

  const exits = type !== '' && type !== 'SPLIT_OFF'
  const hasNew = type !== '' && type !== 'ABSORB'
  const newList = type === 'MERGE' ? news.slice(0, 1) : news
  const sourceCodes = [source.code, ...(type === 'MERGE' ? others.filter(Boolean) : [])]
  const sourceIds = sourceCodes.map((c) => (c === source.code ? source.id : depts.find((d) => d.code === c)?.id)).filter((x): x is number => !!x)

  // 承接清单：每个原部门在生效日及以后仍有效的依赖
  const deps = useQueries({
    queries: sourceIds.map((id) =>
      getGetDepartmentDependenciesQueryOptions(id, { day }, { query: { enabled: open && step >= 2 && !!day } }),
    ),
  })
  const depsBySource = sourceCodes.map((code, i) => ({ code, data: deps[i]?.data as DepartmentDependencies | undefined }))
  const allUnits = depsBySource.flatMap((d) => (d.data?.units ?? []).map((u) => ({ ...u, from: d.code })))
  const allChildren = depsBySource.flatMap((d) => (d.data?.children ?? []).map((c) => ({ ...c, from: d.code })))
  const allCodes = depsBySource.flatMap((d) => (d.data?.code_links ?? []).map((c) => ({ ...c, from: d.code })))
  const allClasses = depsBySource.flatMap((d) => (d.data?.classifications ?? []).map((c) => ({ ...c, from: d.code })))
  const allRelations = depsBySource.flatMap((d) => (d.data?.relations ?? []).map((r) => ({ ...r, from: d.code })))

  // 承接方：新设部门，或吸收合并的已有部门；分设时原部门也可“保持”
  const resultOptions: Option[] = hasNew
    ? newList.map((n, i) => ({ value: n.code.trim() || `#${i}`, label: `${n.name.trim() || `新部门 ${i + 1}`}（新设）` }))
    : target
      ? [{ value: target, label: `${deptName(target)}（承接）` }]
      : []
  const unitOptions: Option[] = [
    ...(type === 'SPLIT_OFF' ? [{ value: KEEP, label: `保持在${rename.trim() || source.name}（存续）` }] : []),
    ...resultOptions,
    { value: RETIRE, label: `单元永久退出（最后有效日 ${day ? dayBefore(day) : '—'}）` },
  ]
  const childOptions: Option[] = [
    ...(type === 'SPLIT_OFF' ? [{ value: KEEP, label: `保持隶属${rename.trim() || source.name}` }] : []),
    ...resultOptions,
    { value: TOP, label: '改为一级部门' },
  ]
  const unitChoice = (code: string) => unitTo[code] ?? (type === 'SPLIT_OFF' ? KEEP : '')
  const childChoice = (code: string) => childTo[code] ?? (type === 'SPLIT_OFF' ? KEEP : '')

  function check(): Record<string, string> | null {
    if (step === 0) return type ? null : { type: '请选择这次组织变更的类型' }
    if (step === 1) {
      const codes = newList.map((n) => n.code.trim())
      const r = requireFields([
        ['day', !!day, '请选择生效日'],
        ['basis', !!basis.trim(), '请填写正式依据（文件号或决定说明）'],
        ...(type === 'ABSORB' ? [['target', !!target, '请选择承接的已有部门'] as [string, boolean, string]] : []),
        ...(type === 'MERGE'
          ? others.map((o, i): [string, boolean, string] => [`other.${i}`, !!o, '请选择一并合并的原部门'])
          : []),
        ...(hasNew
          ? newList.flatMap((n, i): [string, boolean, string][] => [
              [`new.${i}.name`, !!n.name.trim(), '请填写新部门名称'],
              [`new.${i}.code`, CODE_RE.test(n.code.trim()), '请填写管理编码（字母、数字、点、下划线、短横线）'],
              [`new.${i}.code`, codes.indexOf(n.code.trim()) === i, '新部门的编码不能重复'],
              [`new.${i}.code`, !depts.some((d) => d.code === n.code.trim()), '这个编码已被使用，代码永不复用'],
            ])
          : []),
      ])
      return r?.fieldErrors ?? null
    }
    if (step === 2) {
      if (deps.some((q) => q.isPending)) return { _: '承接清单还在加载' }
      const r = requireFields([
        ...allUnits.map((u): [string, boolean, string] => [`unit.${u.code}`, !!unitChoice(u.code), '请选择这个单元由谁承接']),
        ...allChildren.map((c): [string, boolean, string] => [`child.${c.code}`, !!childChoice(c.code), '请选择这个下级部门改挂到哪里']),
      ])
      return r?.fieldErrors ?? null
    }
    return null
  }

  // 校验未通过时，标红渲染完成后把焦点放到第一个出错字段
  const bodyRef = useRef<HTMLDivElement>(null)
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    if (focusTick) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusTick])
  const next = () => {
    const e = check()
    setErrors(e ?? {})
    if (e) setFocusTick((t) => t + 1)
    else setStep(step + 1)
  }

  function buildItems(): ChangeItemInput[] {
    const last = dayBefore(day)
    const items: ChangeItemInput[] = []
    if (hasNew)
      for (const n of newList)
        items.push({
          kind: 'department.create',
          code: n.code.trim(),
          name: n.name.trim(),
          valid_from: day,
          lifecycle: 'ACTIVE',
          institution_code: source.institutionCode,
        })
    if (type === 'SPLIT_OFF' && rename.trim() && rename.trim() !== source.name)
      items.push({ kind: 'department.revise', code: source.code, effective_date: day, changes: { name: rename.trim() } })
    items.push({
      kind: 'department.reorganize',
      event_type: type as ReorgType,
      effective_date: day,
      basis_note: basis.trim(),
      other_matters: otherMatters.trim() || null,
      sources: sourceCodes.map((c) => ({ code: c, scope_note: c === source.code ? sourceScope.trim() || null : null })),
      results: hasNew
        ? newList.map((n) => ({ code: n.code.trim(), scope_note: n.scope.trim() || null }))
        : [{ code: target }],
    })
    for (const u of allUnits) {
      const to = unitChoice(u.code)
      if (to === KEEP) continue
      if (to === RETIRE) items.push({ kind: 'service_unit.retire', code: u.code, valid_to: last })
      else items.push({ kind: 'service_unit.change_department', code: u.code, effective_date: day, department_code: to })
    }
    for (const c of allChildren) {
      const to = childChoice(c.code)
      if (to === KEEP) continue
      items.push({ kind: 'department.set_parent', code: c.code, view_code: 'ADMIN', parent_code: to === TOP ? null : to, effective_date: day })
    }
    if (exits)
      for (const c of allCodes)
        if (c.valid_from <= last) items.push({ kind: 'external_code.assignment_close', assignment_id: c.assignment_id, valid_to: last })
    if (hasNew)
      for (const n of newList) {
        if (n.parent && !sourceCodes.includes(n.parent))
          items.push({ kind: 'department.set_parent', code: n.code.trim(), view_code: 'ADMIN', parent_code: n.parent, effective_date: day })
        if (n.mainClass)
          items.push({ kind: 'department.classify', code: n.code.trim(), scheme_code: MAIN_SCHEME, class_code: n.mainClass, effective_date: day })
      }
    return items
  }

  const save = useMutation({
    mutationFn: () =>
      createChangeRequest({
        items: buildItems(),
        note: `${REORG_TITLE[type as ReorgType]}：${sourceCodes.map(deptName).join('、')}（组织变更向导生成）`,
      }),
    onSuccess: async (cr) => {
      notify.success(`已生成草稿 #${cr.id}，请核对后提交`)
      await qc.invalidateQueries()
      onOpenChange(false)
      navigate(`/changes/${cr.id}`)
    },
  })

  const steps: StepItem[] = STEP_LABELS.map((label, i) => ({ label, state: i < step ? 'done' : i === step ? 'current' : 'upcoming' }))
  const setNew = (i: number, patch: Partial<NewDept>) => setNews(news.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  const errorsCtx = {
    errors,
    clear: (name: string) =>
      setErrors((prev) => {
        const nextErrors = { ...prev }
        delete nextErrors[name]
        return nextErrors
      }),
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>部门组织变更：{source.name}</DialogTitle>
          <DialogDescription>先定身份（谁存续、谁退出、谁新设），再逐项处置受影响的单元、下级部门与编码。生成一张草稿，提交、确认后整体生效。</DialogDescription>
        </DialogHeader>
        <Steps steps={steps} className="py-1" />
        <FormErrorsContext.Provider value={errorsCtx}>
          <div ref={bodyRef} className="grid max-h-[58vh] gap-3 overflow-y-auto px-0.5 pb-0.5">
            {step === 0 && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        setType(t.value)
                        setErrors({})
                        // 整体拆分至少两个新部门；分设、合并新设先给一个
                        if (t.value !== type) setNews(t.value === 'SPLIT' ? [blank(), blank()] : [blank()])
                      }}
                      className={cn(
                        'grid gap-1 rounded-md border p-3 text-left text-xs transition-colors',
                        type === t.value ? 'border-brand ring-brand bg-brand-soft ring-1' : 'border-line hover:bg-surface-hover',
                      )}
                    >
                      <span className="text-fg-strong font-medium">{t.title}</span>
                      <span className="text-fg-secondary">{t.identity}</span>
                      <span className="text-fg-muted text-caption">例：{t.example}</span>
                    </button>
                  ))}
                </div>
                {errors.type && <p className="text-danger-text text-xs">{errors.type}</p>}
                <Callout title="以下情况不是部门组织变更，请走对应的操作">
                  原部门保留、下设子部门 → 新建部门并设上级；只是把业务分成几个门诊或住院单元 → 服务单元拆分；几个部门只是统一主任、排班或专业管理 →
                  专业管理 / 协作关系；两条记录其实是同一个部门 → 身份纠错（第二期），不要用合并代替。
                </Callout>
              </>
            )}

            {step === 1 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="生效日"
                    name="day"
                    type="date"
                    required
                    value={day}
                    onChange={setDay}
                    hint={day ? (exits ? `原部门最后有效日 ${dayBefore(day)}，次日起被替代` : `新部门自 ${day} 起`) : undefined}
                  />
                  <TextField label="正式依据" name="basis" required value={basis} onChange={setBasis} placeholder="文件号或决定说明" />
                </div>
                <TextField
                  label={`${source.name}${exits ? '移出的职责' : '保留的职责'}`}
                  value={sourceScope}
                  onChange={setSourceScope}
                  placeholder="选填，如：门诊与本部住院"
                />
                {type === 'SPLIT_OFF' && (
                  <TextField label="原部门同时改名为" value={rename} onChange={setRename} hint="选填；身份、代码与历史都不变，旧名称即曾用名" />
                )}
                {type === 'ABSORB' && (
                  <DepartmentSelect
                    label="并入的已有部门"
                    name="target"
                    required
                    value={target}
                    onChange={setTarget}
                    exclude={source.code}
                    hint="承接部门保留原身份，不会因吸收而新建"
                  />
                )}
                {type === 'MERGE' &&
                  others.map((o, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <DepartmentSelect
                        label={`一并合并的原部门 ${i + 2}`}
                        name={`other.${i}`}
                        required
                        value={o}
                        onChange={(v) => setOthers(others.map((x, j) => (j === i ? v : x)))}
                        exclude={[source.code, ...others.filter((x) => x && x !== o)]}
                      />
                      <button
                        type="button"
                        className="text-fg-muted hover:text-fg pb-2 text-caption hover:underline"
                        onClick={() => (others.length > 1 ? setOthers(others.filter((_, j) => j !== i)) : setOthers([...others, '']))}
                      >
                        {others.length > 1 ? '移除' : '再加一个'}
                      </button>
                    </div>
                  ))}
                {hasNew &&
                  newList.map((n, i) => (
                    <fieldset key={i} className="border-line-subtle grid gap-3 rounded-md border p-3">
                      <legend className="text-fg-strong flex w-full items-center px-1 text-xs font-semibold">
                        新设部门 {newList.length > 1 ? i + 1 : ''}
                        {(type === 'SPLIT' && news.length > 2) || (type === 'SPLIT_OFF' && news.length > 1) ? (
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg ml-auto text-caption font-normal hover:underline"
                            onClick={() => setNews(news.filter((_, j) => j !== i))}
                          >
                            移除
                          </button>
                        ) : null}
                      </legend>
                      <div className="grid grid-cols-2 gap-3">
                        <TextField label="名称" name={`new.${i}.name`} required value={n.name} onChange={(name) => setNew(i, { name })} />
                        <TextField label="管理编码" name={`new.${i}.code`} required value={n.code} onChange={(code) => setNew(i, { code })} hint={CODE_HINT} />
                      </div>
                      <TextField label="承接的职责" value={n.scope} onChange={(scope) => setNew(i, { scope })} placeholder="选填，如：高新院区住院" />
                      <div className="grid grid-cols-2 gap-3">
                        <DepartmentSelect
                          label="行政上级"
                          name={`new.${i}.parent`}
                          value={n.parent}
                          onChange={(parent) => setNew(i, { parent })}
                          exclude={sourceCodes}
                          placeholder="一级部门（无上级）"
                          hint={source.parentCode ? '按原部门的上级预填，可改' : undefined}
                        />
                        <SelectField
                          label="部门管理主分类"
                          value={n.mainClass}
                          onChange={(mainClass) => setNew(i, { mainClass })}
                          options={mainCodes.map((c) => ({ value: c.code, label: c.name }))}
                          placeholder="暂不设置"
                          hint={source.mainClass ? '原部门的分类只作为候选预填，请按新部门的主要职责确认' : undefined}
                        />
                      </div>
                    </fieldset>
                  ))}
                {(type === 'SPLIT' || type === 'SPLIT_OFF') && (
                  <button type="button" className="text-fg-secondary hover:text-fg justify-self-start text-xs hover:underline" onClick={() => setNews([...news, blank()])}>
                    + 再新设一个部门
                  </button>
                )}
              </>
            )}

            {step === 2 && (
              <>
                {deps.some((q) => q.isPending) && <p className="text-fg-muted text-xs">正在列出 {day} 起受影响的依赖…</p>}
                <ChecklistSection
                  title={`服务单元（${allUnits.length}）`}
                  hint={exits ? '单元身份不变，只是自生效日起改挂承接部门；每个都要选，不默认' : '默认留在原部门；转给新部门的逐个选择'}
                  empty="没有挂在原部门的服务单元"
                  bulk={exits ? resultOptions : []}
                  onBulk={(to) => setUnitTo(Object.fromEntries(allUnits.map((u) => [u.code, to])))}
                >
                  {allUnits.map((u) => (
                    <ChecklistRow key={u.code} label={`${u.version.name}`} sub={`${u.code} · ${u.version.campus_name}${sourceCodes.length > 1 ? ` · 原属 ${deptName(u.from)}` : ''}`}>
                      <SelectField
                        label="由谁承接"
                        name={`unit.${u.code}`}
                        value={unitChoice(u.code)}
                        onChange={(v) => setUnitTo({ ...unitTo, [u.code]: v })}
                        options={unitOptions}
                        placeholder="请选择"
                      />
                    </ChecklistRow>
                  ))}
                </ChecklistSection>
                <ChecklistSection
                  title={`下级部门（${allChildren.length}）`}
                  hint="上级退出不代表下级退出；不会默认挂到第一个新部门"
                  empty="没有下级部门"
                  bulk={[]}
                >
                  {allChildren.map((c) => (
                    <ChecklistRow key={c.code} label={c.name} sub={c.code}>
                      <SelectField
                        label="改挂到"
                        name={`child.${c.code}`}
                        value={childChoice(c.code)}
                        onChange={(v) => setChildTo({ ...childTo, [c.code]: v })}
                        options={childOptions}
                        placeholder="请选择"
                      />
                    </ChecklistRow>
                  ))}
                </ChecklistSection>
                {exits && (
                  <>
                    <ChecklistSection title={`指向原部门的外部编码（${allCodes.length}）`} empty="没有外部编码指向原部门" bulk={[]}>
                      {allCodes.map((c) => (
                        <ChecklistRow key={c.assignment_id} label={`${c.code} ${c.source_name ?? ''}`} sub={`${c.system_name} · ${c.namespace_name}`}>
                          <span className="text-fg-secondary text-xs">结束解释（最后有效日 {dayBefore(day)}），历史仍指向原部门</span>
                        </ChecklistRow>
                      ))}
                      {allCodes.length > 0 && (
                        <p className="text-fg-muted text-caption">
                          不把旧代码直接改指向新部门。生效后这些代码在编码映射台账里为“待裁决”；外部系统确有重新分配记录的，再在台账为它新增解释并写明依据。
                        </p>
                      )}
                    </ChecklistSection>
                    <ChecklistSection title="随原部门结束（历史保留）" empty="原部门没有分类与管理关系" bulk={[]}>
                      {allClasses.map((c) => (
                        <ChecklistRow key={`c${c.id}`} label={`${c.scheme_name}：${c.name}`} sub={deptName(c.from)}>
                          <span className="text-fg-muted text-xs">分类止于 {dayBefore(day)}；新部门的分类在上一步逐个确认</span>
                        </ChecklistRow>
                      ))}
                      {allRelations.map((r) => (
                        <ChecklistRow key={`r${r.id}`} label={r.scope} sub={`${r.from_department.name}${r.to_department ? ` → ${r.to_department.name}` : ''}`}>
                          <span className="text-fg-muted text-xs">关系止于 {dayBefore(day)}；需要的请生效后为承接部门重建</span>
                        </ChecklistRow>
                      ))}
                    </ChecklistSection>
                  </>
                )}
                {errors._ && <p className="text-danger-text text-xs">{errors._}</p>}
              </>
            )}

            {step === 3 && (
              <Review
                type={type as ReorgType}
                day={day}
                sources={sourceCodes.map((c) => ({ code: c, name: deptName(c) }))}
                results={
                  hasNew
                    ? newList.map((n) => ({ code: n.code.trim(), name: n.name.trim() }))
                    : [{ code: target, name: deptName(target) }]
                }
                continuing={type === 'SPLIT_OFF' ? { code: source.code, name: rename.trim() || source.name } : null}
                items={buildItems()}
                otherMatters={otherMatters}
                setOtherMatters={setOtherMatters}
              />
            )}
          </div>
        </FormErrorsContext.Provider>
        {save.error && <p className="text-danger-text text-xs">{save.error.message}</p>}
        <DialogFooter>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" onClick={next}>
              下一步
            </Button>
          ) : (
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? '生成中…' : '生成变更申请草稿'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChecklistSection({
  title,
  hint,
  empty,
  bulk,
  onBulk,
  children,
}: {
  title: string
  hint?: string
  empty: string
  bulk: Option[]
  onBulk?: (value: string) => void
  children: React.ReactNode
}) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : []
  return (
    <section className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-fg-strong text-xs font-semibold">{title}</h4>
        {hint && <span className="text-fg-muted text-caption">{hint}</span>}
        {rows.length > 1 &&
          onBulk &&
          bulk.map((o) => (
            <button key={o.value} type="button" className="text-fg-secondary hover:text-fg text-caption hover:underline" onClick={() => onBulk(o.value)}>
              全部 → {o.label}
            </button>
          ))}
      </div>
      {rows.length === 0 ? <p className="text-fg-disabled text-xs">{empty}</p> : <div className="grid gap-1">{children}</div>}
    </section>
  )
}

function ChecklistRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border-line-subtle grid grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.2fr)] items-center gap-3 rounded-md border px-3 py-2">
      <div className="grid min-w-0">
        <span className="text-fg truncate text-xs">{label}</span>
        {sub && <span className="text-fg-muted truncate text-caption">{sub}</span>}
      </div>
      <div className="[&_label]:sr-only">{children}</div>
    </div>
  )
}

const ITEM_GROUPS: [string, string][] = [
  ['department.create', '新建部门'],
  ['department.revise', '原部门改名'],
  ['department.reorganize', '组织变更事件'],
  ['service_unit.change_department', '单元改挂'],
  ['service_unit.retire', '单元退出'],
  ['department.set_parent', '调整行政隶属'],
  ['external_code.assignment_close', '结束编码解释'],
  ['department.classify', '新部门主分类'],
]

function Review({
  type,
  day,
  sources,
  results,
  continuing,
  items,
  otherMatters,
  setOtherMatters,
}: {
  type: ReorgType
  day: string
  sources: { code: string; name: string }[]
  results: { code: string; name: string }[]
  continuing: { code: string; name: string } | null
  items: ChangeItemInput[]
  otherMatters: string
  setOtherMatters: (v: string) => void
}) {
  const last = dayBefore(day)
  const exits = type !== 'SPLIT_OFF'
  const before: FlowUnit[] = sources.map((s) => ({
    name: s.name,
    code: s.code,
    footer: exits ? `最后有效日 ${last}` : '继续存在',
    tag: exits ? { label: '退出', tone: 'retire' } : { label: '存续', tone: 'current' },
  }))
  const after: FlowUnit[] = [
    ...(continuing ? [{ name: continuing.name, code: continuing.code, footer: '身份不变', tag: { label: '存续', tone: 'current' as const } }] : []),
    ...results.map(
      (r): FlowUnit =>
        type === 'ABSORB'
          ? { name: r.name, code: r.code, footer: '身份不变', tag: { label: '承接', tone: 'current' } }
          : { name: r.name, code: r.code, footer: `自 ${day} 起`, tag: { label: '新设', tone: 'new' } },
    ),
  ]
  const counts = ITEM_GROUPS.map(([kind, label]) => [label, items.filter((i) => i.kind === kind).length] as const).filter(([, n]) => n > 0)
  return (
    <>
      <EvolveFlow kind={sources.length > 1 ? 'merge' : 'split'} day={day} label={REORG_TITLE[type]} before={before} after={after} />
      <p className="text-fg-secondary text-xs">
        将生成一张草稿，共 {items.length} 项：{counts.map(([label, n]) => `${label} ${n}`).join('、')}。提交前系统会再按数据预演一遍；有依赖没处置会被拦下。
      </p>
      <Field label="需其他系统办理的事项（选填）">
        <Textarea
          value={otherMatters}
          onChange={(e) => setOtherMatters(e.target.value)}
          placeholder="如：人员任职、临床授权、医保科室备案、在途单据、成本核算由相关部门另行办理。本平台只登记，不执行"
        />
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="text-fg-strong font-medium">{label}</span>
      {children}
    </label>
  )
}
