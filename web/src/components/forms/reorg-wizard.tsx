// 部门组织变更向导（docs/部门组织变更-评估与分期.md 第一期）：
// ① 身份裁决 → ② 参与部门 → ③ 承接清单 → ④ 核对。一次生成一整张申请：新建部门、组织变更事件，
// 以及逐项处置依赖的变更项（单元改挂 / 退出、人员调科 / 结束归属、下级部门改挂、结束指向原部门的编码解释、新部门的上级与主分类）。
// 空白不等于“全部跟着走”：退出部门的每个单元、每个下级部门都要明确选择，系统不按名称推断、不默认。
// 可靠性（U3R-04）：每个参与的原部门按代码对应自己的依赖读取（读取中 / 已读 / 失败 / 找不到），失败不当作“没有”；
// “下一步”与“保存”用同一个纯校验（各步字段 + 读取范围 + 承接选择仍有效），未通过才跳到出错步骤并聚焦；
// 选择按单元代码、下级代码、归属 id 记住，重试、回退都不丢，指向已删除新部门的选择标为失效要求重选；
// 编辑保护、保存中锁定、失败保留请求键与公共表单（ItemDialog）一致。
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { createChangeRequest, updateChangeRequest } from '@/api/generated/changes/changes'
import { getGetDepartmentDependenciesQueryOptions, useListClassificationSchemes, useListDepartments } from '@/api/generated/master/master'
import type { DepartmentDependencies } from '@/api/generated/model'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { AutoCodeField, PinyinField, pinyinCheck } from '@/components/forms/code-fields'
import { fillNewCodes, isNewCode, newCode } from '@/components/forms/new-code'
import { FormErrorsContext, requireFields, SelectField, TextField, type Option } from '@/components/forms/fields'
import { saveFailureText, type ChangeItemInput } from '@/components/forms/item-dialog'
import { DepartmentSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { FormEditContext } from '@/components/kit/form-edit'
import { ReadError, readStatus } from '@/components/kit/read-state'
import { Steps, type StepItem } from '@/components/kit/steps'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/app-context'
import { today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { useMe } from '@/lib/use-me'
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
// 人员归属：结束（或取消尚未开始的调入），之后为“暂未分配”
const END = '__end'
const MAIN_SCHEME = 'DEPT_MAIN_CLASS'

interface NewDept {
  name: string
  /** 新设部门的代码：保存时由系统分配（先用占位符，见 forms/new-code.ts）；回到向导时是已分配的代码 */
  code: string
  pinyin: string
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

/** 向导要编辑的已有草稿：按草稿里的变更项恢复向导状态，保存时整体替换这张草稿的变更项 */
export interface ReorgDraft {
  id: number
  note: string | null
  items: ChangeItemInput[]
}

type Item = Record<string, unknown> & { kind: string }

/** 从草稿的变更项恢复向导状态（向导生成的草稿可以完整还原） */
function fromDraft(draft: ReorgDraft | undefined, source: ReorgSource) {
  const items = (draft?.items ?? []) as unknown as Item[]
  const ev = items.find((i) => i.kind === 'department.reorganize') as
    | (Item & { event_type: ReorgType; effective_date: string; basis_note: string; other_matters?: string | null; sources: { code: string; scope_note?: string | null }[]; results: { code: string; scope_note?: string | null }[] })
    | undefined
  if (!ev) return null
  const created = new Map(items.filter((i) => i.kind === 'department.create').map((i) => [i.code as string, i]))
  const parentOf = new Map(items.filter((i) => i.kind === 'department.set_parent').map((i) => [i.code as string, (i.parent_code as string | null) ?? null]))
  const classOf = new Map(items.filter((i) => i.kind === 'department.classify').map((i) => [i.code as string, (i.class_code as string) ?? '']))
  const news: NewDept[] =
    ev.event_type === 'ABSORB'
      ? []
      : ev.results.map((r) => ({
          name: String(created.get(r.code)?.name ?? ''),
          code: r.code,
          pinyin: String(created.get(r.code)?.pinyin ?? ''),
          scope: r.scope_note ?? '',
          parent: parentOf.has(r.code) ? (parentOf.get(r.code) ?? '') : '',
          mainClass: classOf.get(r.code) ?? '',
        }))
  const unitTo: Record<string, string> = {}
  for (const i of items) {
    if (i.kind === 'service_unit.change_department') unitTo[i.code as string] = i.department_code as string
    if (i.kind === 'service_unit.retire') unitTo[i.code as string] = RETIRE
  }
  const personTo: Record<string, string> = {}
  for (const i of items) {
    if (i.kind === 'person.transfer') personTo[String(i.assignment_id)] = i.department_code as string
    if (i.kind === 'person.assignment_set_end') personTo[String(i.assignment_id)] = END
  }
  const childTo: Record<string, string> = {}
  for (const i of items)
    if (i.kind === 'department.set_parent' && !created.has(i.code as string)) childTo[i.code as string] = (i.parent_code as string | null) ?? TOP
  const rename = items.find((i) => i.kind === 'department.revise' && i.code === source.code) as (Item & { changes: { name?: string } }) | undefined
  return {
    type: ev.event_type,
    day: ev.effective_date,
    basis: ev.basis_note,
    otherMatters: ev.other_matters ?? '',
    sourceScope: ev.sources.find((x) => x.code === source.code)?.scope_note ?? '',
    others: ev.event_type === 'MERGE' ? ev.sources.filter((x) => x.code !== source.code).map((x) => x.code) : [''],
    target: ev.event_type === 'ABSORB' ? ev.results[0]?.code ?? '' : '',
    rename: rename?.changes.name ?? '',
    news,
    unitTo,
    childTo,
    personTo,
  }
}

export function DepartmentReorgWizard({
  open,
  onOpenChange,
  source,
  draft,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: ReorgSource
  /** 给出时为“回到向导调整”：恢复草稿内容，保存时整体替换这张草稿的变更项 */
  draft?: ReorgDraft
}) {
  const [init] = useState(() => fromDraft(draft, source))
  const { asOf } = useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  // 字段错误（就地标红）、读取范围问题、保存失败分开表达，互不覆盖
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [scopeTried, setScopeTried] = useState(false)
  // 编辑保护：本次打开期间改过即算（从草稿回填不算）；纯浏览步骤、重试读取不算
  const [dirty, setDirty] = useState(false)
  const markDirty = useCallback(() => setDirty(true), [])
  const editCtx = useMemo(() => ({ markDirty }), [markDirty])
  const [confirmClose, setConfirmClose] = useState(false)
  const saving = useRef(false)
  const [type, setType] = useState<ReorgType | ''>(init?.type ?? '')
  const [day, setDay] = useState(() => init?.day ?? today())
  const [basis, setBasis] = useState(init?.basis ?? '')
  const [sourceScope, setSourceScope] = useState(init?.sourceScope ?? '')
  const [rename, setRename] = useState(init?.rename ?? '')
  const [target, setTarget] = useState(init?.target ?? '')
  const [others, setOthers] = useState<string[]>(init?.others ?? [''])
  // 每个新设部门一个占位代码槽位；保存时整张草稿一起换成系统分配的代码，重试拿回同一批号
  const [requestKey] = useState(() => crypto.randomUUID())
  const slot = useRef(0)
  const blank = (): NewDept => ({ name: '', code: newCode('department', slot.current++), pinyin: '', scope: '', parent: source.parentCode ?? '', mainClass: source.mainClass ?? '' })
  const [news, setNews] = useState<NewDept[]>(init?.news.length ? init.news : [blank(), blank()])
  const [unitTo, setUnitTo] = useState<Record<string, string>>(init?.unitTo ?? {})
  const [childTo, setChildTo] = useState<Record<string, string>>(init?.childTo ?? {})
  const [personTo, setPersonTo] = useState<Record<string, string>>(init?.personTo ?? {})
  const [otherMatters, setOtherMatters] = useState(init?.otherMatters ?? '')

  const { can, permsKnown } = useMe()
  const deptQuery = useListDepartments({ as_of: asOf })
  const depts = useMemo(() => deptQuery.data ?? [], [deptQuery.data])
  const { data: schemes = [] } = useListClassificationSchemes()
  const mainCodes = (schemes.find((s) => s.code === MAIN_SCHEME)?.codes ?? []).filter((c) => c.is_active)
  const deptName = (code: string) => depts.find((d) => d.code === code)?.version.name ?? code

  const exits = type !== '' && type !== 'SPLIT_OFF'
  const hasNew = type !== '' && type !== 'ABSORB'
  const newList = type === 'MERGE' ? news.slice(0, 1) : news
  const sourceCodes = [source.code, ...(type === 'MERGE' ? others.filter(Boolean) : [])]

  // 当前读取范围 = 参与的原部门（按代码）+ 生效日。每个原部门按代码对应自己的查询，不按下标拼接；
  // 找不到 id 的原部门不从范围里悄悄去掉（部门列表还在读 / 读取失败 / 已不可选，各自说明）。
  // 查询键带 id 与生效日：换日期、换部门后旧请求晚到也不会被当成新范围的结果。
  const deptsStatus = readStatus(deptQuery)
  const entries = sourceCodes.map((code) => ({ code, id: code === source.code ? source.id : depts.find((d) => d.code === code)?.id }))
  const withId = entries.filter((e): e is { code: string; id: number } => e.id !== undefined)
  const depQueries = useQueries({
    queries: withId.map((e) => getGetDepartmentDependenciesQueryOptions(e.id, { day }, { query: { enabled: open && step >= 2 && !!day } })),
  })
  const sources: SourceState[] = entries.map((e) => {
    if (e.id === undefined)
      return { code: e.code, status: deptsStatus === 'ready' ? 'missing' : deptsStatus, query: deptsStatus === 'error' ? deptQuery : undefined }
    const q = depQueries[withId.findIndex((w) => w.code === e.code)]
    const st = readStatus(q)
    return { code: e.code, status: st, query: q, data: st === 'ready' ? (q.data as DepartmentDependencies) : undefined, stale: st === 'ready' && q.isError }
  })
  const readySources = sources.filter((x) => x.status === 'ready')
  // 汇总只用读取成功的原部门；其余在承接清单顶部逐个说明
  const allUnits = readySources.flatMap((d) => (d.data?.units ?? []).map((u) => ({ ...u, from: d.code })))
  const allChildren = readySources.flatMap((d) => (d.data?.children ?? []).map((c) => ({ ...c, from: d.code })))
  const allCodes = readySources.flatMap((d) => (d.data?.code_links ?? []).map((c) => ({ ...c, from: d.code })))
  const allClasses = readySources.flatMap((d) => (d.data?.classifications ?? []).map((c) => ({ ...c, from: d.code })))
  const allRelations = readySources.flatMap((d) => (d.data?.relations ?? []).map((r) => ({ ...r, from: d.code })))
  // 人员归属：接口在没有“查看人员”权限时返回空列表，所以“没有人员”只在有权限时才能这么说
  const personsVisible = permsKnown && can('person.view')
  const allPersons = personsVisible ? readySources.flatMap((d) => (d.data?.persons ?? []).map((p) => ({ ...p, from: d.code }))) : []
  const scope = { ready: readySources.length, total: sources.length }

  /** 读取范围是否可用于核对与保存（纯函数）：有找不到、失败、未读完或刷新失败的原部门都不行 */
  function scopeProblem(): string | null {
    if (!day) return '请先在“参与部门”选择生效日'
    const name = (xs: SourceState[]) => xs.map((x) => deptName(x.code)).join('、')
    const missing = sources.filter((x) => x.status === 'missing')
    if (missing.length) return `找不到原部门 ${name(missing)}（查看日期当天不可选），请回到“参与部门”重选`
    const failed = sources.filter((x) => x.status === 'error')
    if (failed.length) return `${name(failed)} 的依赖没有读取成功：重试成功后才能继续（已读取 ${scope.ready}/${scope.total} 个原部门）`
    const loading = sources.filter((x) => x.status === 'loading')
    if (loading.length) return `还在读取 ${name(loading)} 的依赖（已读取 ${scope.ready}/${scope.total} 个原部门）`
    const stale = sources.filter((x) => x.stale)
    if (stale.length) return `${name(stale)} 的依赖刷新没有成功，可能不是最新：重试后再继续`
    if (!permsKnown) return '还在确认查看人员的权限'
    return null
  }

  // 承接方：新设部门，或吸收合并的已有部门；分设时原部门也可“保持”
  const resultOptions: Option[] = hasNew
    ? newList.map((n, i) => ({ value: n.code.trim() || `#${i}`, label: `${n.name.trim() || `新部门 ${i + 1}`}（新设）` }))
    : target
      ? [{ value: target, label: `${deptName(target)}（承接）` }]
      : []
  // 生效日之后才开始的单元（计划中）：改挂在它的开始日直接更正那一版；“退出”即取消这个计划，从未生效
  const planned = (u: { version: { valid_from: string } }) => !!day && u.version.valid_from > day
  // 计划中的有两种：单元本身尚未开始（第 1 版），或单元已在别的部门、预约以后改挂进来（后续版本）
  const movingIn = (u: { version: { valid_from: string; version_no: number } }) => planned(u) && u.version.version_no > 1
  const unitOptions = (u: { version: { valid_from: string; version_no: number } }): Option[] => [
    ...(type === 'SPLIT_OFF' ? [{ value: KEEP, label: `保持在${rename.trim() || source.name}（存续）` }] : []),
    ...resultOptions.map((o) =>
      movingIn(u)
        ? { ...o, label: `${o.label}，原定 ${u.version.valid_from} 的改挂改为挂到这里` }
        : planned(u)
          ? { ...o, label: `${o.label}，自 ${u.version.valid_from} 开始时就挂在这里` }
          : o,
    ),
    movingIn(u)
      ? { value: RETIRE, label: `单元永久退出（最后有效日 ${dayBefore(u.version.valid_from)}，不再改挂进来）` }
      : planned(u)
        ? { value: RETIRE, label: `取消这个计划中的单元（原定 ${u.version.valid_from} 开始，取消后从未生效）` }
        : { value: RETIRE, label: `单元永久退出（最后有效日 ${day ? dayBefore(day) : '—'}）` },
  ]
  const childOptions: Option[] = [
    ...(type === 'SPLIT_OFF' ? [{ value: KEEP, label: `保持隶属${rename.trim() || source.name}` }] : []),
    ...resultOptions,
    { value: TOP, label: '改为一级部门' },
  ]
  const personOptions = (p: { valid_from: string }): Option[] => {
    const later = !!day && p.valid_from > day
    return [
      ...(type === 'SPLIT_OFF' ? [{ value: KEEP, label: `保持在${rename.trim() || source.name}（存续）` }] : []),
      ...resultOptions.map((o) => (later ? { ...o, label: `${o.label}，原定 ${p.valid_from} 的调入改为调到这里` } : { ...o, label: `${o.label}，自 ${day} 起` })),
      later
        ? { value: END, label: `取消这次调入（原定 ${p.valid_from} 开始，取消后从未生效）` }
        : { value: END, label: `结束归属（最后有效日 ${day ? dayBefore(day) : '—'}），之后暂未分配` },
    ]
  }
  const personChoice = (id: number) => personTo[String(id)] ?? (type === 'SPLIT_OFF' ? KEEP : '')
  const unitChoice = (code: string) => unitTo[code] ?? (type === 'SPLIT_OFF' ? KEEP : '')
  const childChoice = (code: string) => childTo[code] ?? (type === 'SPLIT_OFF' ? KEEP : '')
  /** 已选的值是否仍是当前选项之一（新部门被删除、类型改变后旧选择会失效，不悄悄改投） */
  const inOptions = (v: string, opts: Option[]) => opts.some((o) => o.value === v)
  const choiceCheck = (name: string, v: string, opts: Option[], ask: string): [string, boolean, string] => [
    name,
    !!v && inOptions(v, opts),
    v ? '原来的选择已失效（承接部门已删除或类型已改），请重选' : ask,
  ]
  const unitStale = (u: (typeof allUnits)[number]) => !!unitChoice(u.code) && !inOptions(unitChoice(u.code), unitOptions(u))
  const personStale = (p: (typeof allPersons)[number]) => !!personChoice(p.assignment_id) && !inOptions(personChoice(p.assignment_id), personOptions(p))
  const childStale = (c: (typeof allChildren)[number]) => !!childChoice(c.code) && !inOptions(childChoice(c.code), childOptions)

  /** 某一步的字段检查（纯函数：不切步骤、不改状态、不发请求）；承接清单另看读取范围 scopeProblem() */
  function checkStep(n: number): Record<string, string> | null {
    if (n === 0) return type ? null : { type: '请选择这次组织变更的类型' }
    if (n === 1) {
      const r = requireFields([
        ['day', !!day, '请选择生效日'],
        ['basis', !!basis.trim(), '请填写正式依据（文件号或决定说明）'],
        ...(type === 'ABSORB' ? [['target', !!target, '请选择承接的已有部门'] as [string, boolean, string]] : []),
        ...(type === 'MERGE'
          ? others.map((o, i): [string, boolean, string] => [`other.${i}`, !!o, '请选择一并合并的原部门'])
          : []),
        ...(hasNew
          ? newList.flatMap((g, i): [string, boolean, string][] => [
              [`new.${i}.name`, !!g.name.trim(), '请填写新部门名称'],
              pinyinCheck(g.pinyin, `new.${i}.pinyin`),
            ])
          : []),
      ])
      return r?.fieldErrors ?? null
    }
    if (n === 2) {
      const r = requireFields([
        ...allUnits.map((u) => choiceCheck(`unit.${u.code}`, unitChoice(u.code), unitOptions(u), '请选择这个单元由谁承接')),
        ...allChildren.map((c) => choiceCheck(`child.${c.code}`, childChoice(c.code), childOptions, '请选择这个下级部门改挂到哪里')),
        ...allPersons.map((p) =>
          choiceCheck(`person.${p.assignment_id}`, personChoice(p.assignment_id), personOptions(p), '请选择这个人调到哪里，或结束归属'),
        ),
      ])
      return r?.fieldErrors ?? null
    }
    return null
  }

  /** 走到第 upTo 步之前要满足的全部条件：前面各步字段、承接清单的读取范围与选择。返回第一个不满足的步骤 */
  function validateUpTo(upTo: number): { step: number; errors: Record<string, string> } | { step: number; scope: string } | null {
    for (let n = 0; n <= Math.min(upTo, 2); n++) {
      if (n === 2) {
        const sp = scopeProblem()
        if (sp) return { step: 2, scope: sp }
      }
      const e = checkStep(n)
      if (e) return { step: n, errors: e }
    }
    return null
  }

  // 校验未通过时，标红渲染完成后把焦点放到第一个出错字段
  const bodyRef = useRef<HTMLFieldSetElement>(null)
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    if (focusTick) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusTick])
  /** 只在明确点“下一步 / 保存”未通过时：切到出错的步骤、标红并聚焦第一个（被动重验不切步骤、不移焦点） */
  const reveal = (r: NonNullable<ReturnType<typeof validateUpTo>>) => {
    setStep(r.step)
    if ('errors' in r) {
      setErrors(r.errors)
      setFocusTick((t) => t + 1)
    } else setScopeTried(true)
  }
  const next = () => {
    const r = validateUpTo(step)
    if (r) return reveal(r)
    setErrors({})
    setScopeTried(false)
    setStep(step + 1)
  }
  // 出过错后每次改动按当前步骤重新检查：只清掉已通过的字段，空格等仍无效的保持标红，不给未标红的字段新加错误
  useEffect(() => {
    const flagged = Object.keys(errors)
    if (flagged.length === 0) return
    const still = checkStep(step) ?? {}
    const nextErrors = Object.fromEntries(flagged.filter((k) => k in still).map((k) => [k, still[k]]))
    if (flagged.length !== Object.keys(nextErrors).length || flagged.some((k) => nextErrors[k] !== errors[k])) setErrors(nextErrors)
  })

  function buildItems(): ChangeItemInput[] {
    const last = dayBefore(day)
    const items: ChangeItemInput[] = []
    if (hasNew)
      for (const n of newList)
        items.push({
          kind: 'department.create',
          code: n.code,
          name: n.name.trim(),
          pinyin: n.pinyin || null,
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
      // 计划中的单元：在它的开始日处理（更正那一版 / 取消计划），不能早于开始日
      const start = u.version.valid_from > day ? u.version.valid_from : null
      if (to === RETIRE) items.push({ kind: 'service_unit.retire', code: u.code, valid_to: start ? dayBefore(start) : last })
      else items.push({ kind: 'service_unit.change_department', code: u.code, effective_date: start ?? day, department_code: to })
    }
    // 人员：不按单元或名称自动迁人，每条归属由人选择（人员设计第 6 节）
    for (const p of allPersons) {
      const to = personChoice(p.assignment_id)
      if (to === KEEP) continue
      const start = p.valid_from > day ? p.valid_from : null
      if (to === END)
        items.push({ kind: 'person.assignment_set_end', assignment_id: p.assignment_id, expected_valid_to: p.valid_to ?? null, valid_to: start ? dayBefore(start) : last })
      else
        items.push({ kind: 'person.transfer', assignment_id: p.assignment_id, expected_valid_to: p.valid_to ?? null, department_code: to, effective_date: start ?? day })
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
    // 一张完整草稿：新建时创建，回到向导时整体替换原草稿的变更项；请求键在本次打开期间不变，重试拿回同一批代码。
    // 请求体只由向导内容决定（不读草稿），内容没改的重试与上次相同，服务端认作同一次保存（迁移 0022）
    mutationFn: async () => {
      const note = `${REORG_TITLE[type as ReorgType]}：${sourceCodes.map(deptName).join('、')}（组织变更向导生成）`
      const items = await fillNewCodes(buildItems(), requestKey)
      // 回到向导调整：整体替换草稿的变更项，组织变更始终作为一个整体保存
      return draft
        ? updateChangeRequest(draft.id, { items, note: draft.note ?? note, request_key: requestKey })
        : createChangeRequest({ items, note, request_key: requestKey })
    },
    onSuccess: async (cr) => {
      notify.success(draft ? `草稿 #${cr.id} 已按向导内容更新，请核对后提交` : `已生成草稿 #${cr.id}，请核对后提交`)
      await qc.invalidateQueries()
      onOpenChange(false)
      navigate(`/changes/${cr.id}`)
    },
    onSettled: () => {
      saving.current = false
    },
  })
  const trySave = () => {
    if (saving.current) return
    // 已在核对页也要再过一遍：读取刷新失败、范围变了，不能凭旧预览保存（回到承接清单，内容保留）
    const r = validateUpTo(2)
    if (r) return reveal(r)
    saving.current = true
    save.mutate()
  }
  const pending = save.isPending
  /** 取消、×、Esc、点遮罩：保存中不关闭；改过内容时先确认一次 */
  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) return onOpenChange(true)
    if (pending || confirmClose) return
    if (dirty) return setConfirmClose(true)
    onOpenChange(false)
  }

  const steps: StepItem[] = STEP_LABELS.map((label, i) => ({ label, state: i < step ? 'done' : i === step ? 'current' : 'upcoming' }))
  const setNew = (i: number, patch: Partial<NewDept>) => setNews(news.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  // 错误只由重验清除（不因键入任意字符就清掉）
  const errorsCtx = { errors, clear: () => {} }
  const scopeNow = step >= 2 ? scopeProblem() : null

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            部门组织变更：{source.name}
            {draft && <span className="text-fg-muted ml-2 text-xs font-normal">调整草稿 #{draft.id}</span>}
          </DialogTitle>
          <DialogDescription>
            先定身份（谁存续、谁退出、谁新设），再逐项处置受影响的单元、人员、下级部门与编码。保存后仍是草稿；提交并由确认人确认后，整张正式登记，各项按自己的业务日期生效——确认时间不等于业务生效日期。
          </DialogDescription>
        </DialogHeader>
        <Steps steps={steps} className="py-1" />
        {type && step > 0 && (
          <p className="text-fg-secondary text-caption">
            {REORG_TITLE[type as ReorgType]} · 原部门 {sourceCodes.map(deptName).join('、')}
            {day && ` · 本次组织变更生效日 ${day}`}
          </p>
        )}
        <FormEditContext.Provider value={editCtx}>
        <FormErrorsContext.Provider value={errorsCtx}>
          {/* 保存中整组停用；原生输入（如“其他事项”）的改动由这里记为“改过” */}
          <fieldset
            ref={bodyRef}
            disabled={pending}
            onInput={markDirty}
            onChange={markDirty}
            className="-m-1 grid max-h-[58vh] min-w-0 gap-3 overflow-y-auto p-1.5"
          >
            {step === 0 && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        if (t.value === type) return
                        markDirty()
                        setType(t.value)
                        setErrors({})
                        // 整体拆分至少两个新部门；分设、合并新设先给一个。已做的承接选择不清掉：指向旧新部门的会标为失效、要求重选
                        setNews(t.value === 'SPLIT' ? [blank(), blank()] : [blank()])
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
                        onClick={() => {
                          markDirty()
                          if (others.length > 1) setOthers(others.filter((_, j) => j !== i))
                          else setOthers([...others, ''])
                        }}
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
                            onClick={() => {
                              markDirty()
                              setNews(news.filter((_, j) => j !== i))
                            }}
                          >
                            移除
                          </button>
                        ) : null}
                      </legend>
                      <div className="grid grid-cols-2 gap-3">
                        <TextField label="名称" name={`new.${i}.name`} required value={n.name} onChange={(name) => setNew(i, { name })} />
                        <PinyinField source={n.name} name={`new.${i}.pinyin`} value={n.pinyin} onChange={(pinyin) => setNew(i, { pinyin })} />
                      </div>
                      <AutoCodeField type="department" label="管理编码" code={n.code} />
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
                  <button type="button" className="text-fg-secondary hover:text-fg justify-self-start text-xs hover:underline" onClick={() => {
                    markDirty()
                    setNews([...news, blank()])
                  }}>
                    + 再新设一个部门
                  </button>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <SourceStatus sources={sources} name={deptName} day={day} onBack={() => setStep(1)} />
                <ChecklistSection
                  title="服务单元"
                  count={allUnits.length}
                  scope={scope}
                  open={allUnits.filter((u) => !unitChoice(u.code) || unitStale(u)).length}
                  hint={exits ? '单元身份不变，只是自生效日起改挂承接部门；每个都要选，不默认' : '默认留在原部门；转给新部门的逐个选择'}
                  empty="没有挂在原部门的服务单元"
                  bulk={exits ? resultOptions : []}
                  onBulk={(to) => {
                    markDirty()
                    setUnitTo({ ...unitTo, ...Object.fromEntries(allUnits.map((u) => [u.code, to])) })
                  }}
                >
                  {allUnits.map((u) => (
                    <ChecklistRow
                      key={u.code}
                      label={`${u.version.name}`}
                      sub={`${u.code} · ${u.version.campus_name}${sourceCodes.length > 1 ? ` · 原属 ${deptName(u.from)}` : ''}${movingIn(u) ? ` · 预约 ${u.version.valid_from} 起改挂进来` : planned(u) ? ` · 计划 ${u.version.valid_from} 开始` : ''}`}
                      stale={unitStale(u) && !errors[`unit.${u.code}`]}
                    >
                      <SelectField
                        label="由谁承接"
                        name={`unit.${u.code}`}
                        value={unitChoice(u.code)}
                        onChange={(v) => setUnitTo({ ...unitTo, [u.code]: v })}
                        options={unitOptions(u)}
                        placeholder="请选择"
                      />
                    </ChecklistRow>
                  ))}
                </ChecklistSection>
                {!personsVisible ? (
                  <section className="grid gap-1">
                    <h4 className="text-fg-strong text-xs font-semibold">人员</h4>
                    <p className="text-fg-muted text-xs">
                      {permsKnown
                        ? '你没有“查看人员”的权限，这里不列出人员归属，也不能据此认为没有人员；提交、确认时服务端会检查仍归属原部门的人员。'
                        : '正在确认查看人员的权限…'}
                    </p>
                  </section>
                ) : (
                  <ChecklistSection
                    title="人员"
                    count={allPersons.length}
                    scope={scope}
                    open={allPersons.filter((p) => !personChoice(p.assignment_id) || personStale(p)).length}
                    hint="人员身份不变，只换归属部门；不跟着服务单元走，也不按名称推断。每个都要选"
                    empty="没有归属原部门的人员"
                    bulk={exits ? resultOptions : []}
                    onBulk={(to) => {
                      markDirty()
                      setPersonTo({ ...personTo, ...Object.fromEntries(allPersons.map((p) => [String(p.assignment_id), to])) })
                    }}
                  >
                    {allPersons.map((p) => (
                      <ChecklistRow
                        key={p.assignment_id}
                        label={p.person_name}
                        sub={`${p.person_code}${sourceCodes.length > 1 ? ` · 原属 ${deptName(p.from)}` : ''}${p.not_yet_effective ? ` · 预约 ${p.valid_from} 起调入` : ''}`}
                        stale={personStale(p) && !errors[`person.${p.assignment_id}`]}
                      >
                        <SelectField
                          label="调到"
                          name={`person.${p.assignment_id}`}
                          value={personChoice(p.assignment_id)}
                          onChange={(v) => setPersonTo({ ...personTo, [String(p.assignment_id)]: v })}
                          options={personOptions(p)}
                          placeholder="请选择"
                        />
                      </ChecklistRow>
                    ))}
                  </ChecklistSection>
                )}
                <ChecklistSection
                  title="下级部门"
                  count={allChildren.length}
                  scope={scope}
                  open={allChildren.filter((c) => !childChoice(c.code) || childStale(c)).length}
                  hint="上级退出不代表下级退出；不会默认挂到第一个新部门"
                  empty="没有下级部门"
                  bulk={[]}
                >
                  {allChildren.map((c) => (
                    <ChecklistRow key={c.code} label={c.name} sub={c.code} stale={childStale(c) && !errors[`child.${c.code}`]}>
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
                    <ChecklistSection title="指向原部门的外部编码" count={allCodes.length} scope={scope} empty="没有外部编码指向原部门" bulk={[]}>
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
                    <ChecklistSection
                      title="随原部门结束（历史保留）"
                      count={allClasses.length + allRelations.length}
                      scope={scope}
                      empty="原部门没有分类与管理关系"
                      bulk={[]}
                    >
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
              </>
            )}

            {step === 3 && (
              <Review
                type={type as ReorgType}
                day={day}
                sources={sourceCodes.map((c) => ({ code: c, name: deptName(c) }))}
                results={
                  hasNew
                    ? newList.map((n) => ({ code: isNewCode(n.code) ? '待分配（保存时由系统分配）' : n.code, name: n.name.trim() }))
                    : [{ code: target, name: deptName(target) }]
                }
                continuing={type === 'SPLIT_OFF' ? { code: source.code, name: rename.trim() || source.name } : null}
                items={buildItems()}
                otherMatters={otherMatters}
                setOtherMatters={setOtherMatters}
                draftId={draft?.id}
              />
            )}
          </fieldset>
        </FormErrorsContext.Provider>
        </FormEditContext.Provider>
        {/* 读取范围的问题：点过“下一步 / 保存”后持续显示，读取恢复、重选后自动消失 */}
        {scopeTried && scopeNow && step === 2 && (
          <p role="alert" className="text-danger-text text-xs">
            {scopeNow}
          </p>
        )}
        {save.error && (
          <p role="alert" className="text-danger-text text-xs">
            {saveFailureText(save.error, '已填写的内容与选择都还在')}
          </p>
        )}
        {confirmClose ? (
          <div role="alertdialog" aria-label="放弃组织变更向导里的内容" className="bg-surface-subtle grid gap-3 rounded-lg px-3 py-3">
            <p className="text-fg text-xs">关闭会丢弃向导里已填写的内容与承接选择，还没有保存到任何申请。</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                autoFocus
                onClick={() => {
                  // 先把焦点放回向导，再收起确认条（按钮卸载时若仍有焦点，Dialog 会把焦点收回弹窗本身）
                  bodyRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
                  setConfirmClose(false)
                }}
              >
                继续填写
              </Button>
              <Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>
                放弃并关闭
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            {step > 0 && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => setStep(step - 1)}>
                上一步
              </Button>
            )}
            {step < 3 ? (
              <Button type="button" onClick={next}>
                下一步
              </Button>
            ) : (
              <Button type="button" disabled={pending} onClick={trySave}>
                {pending ? '保存中…' : draft ? `更新草稿 #${draft.id}` : '生成变更申请草稿'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface SourceState {
  code: string
  status: 'loading' | 'error' | 'ready' | 'missing'
  query?: { data?: unknown; isError: boolean; error: unknown; isFetching: boolean; refetch: () => unknown }
  data?: DepartmentDependencies
  /** 有上次成功的结果，但这次刷新失败 */
  stale?: boolean
}

/** 承接清单顶部：每个原部门的读取状态；失败的就地重试（只重取这一个），找不到的回到“参与部门” */
function SourceStatus({ sources, name, day, onBack }: { sources: SourceState[]; name: (code: string) => string; day: string; onBack: () => void }) {
  const ready = sources.filter((x) => x.status === 'ready').length
  return (
    <section aria-label="原部门依赖的读取状态" className="grid gap-1.5">
      <p className="text-fg-secondary text-xs">
        {day} 起受影响的依赖：已读取 {ready}/{sources.length} 个原部门
        {ready < sources.length && '；未读取成功的不计入下面的数量，也不能进入核对'}
      </p>
      {sources
        .filter((x) => x.status !== 'ready' || x.stale)
        .map((x) =>
          x.status === 'loading' ? (
            <p key={x.code} role="status" className="text-fg-muted text-xs">
              正在读取 {name(x.code)} 的依赖…
            </p>
          ) : x.status === 'missing' ? (
            <div key={x.code} role="alert">
              <Callout tone="danger" title={`找不到原部门 ${name(x.code)}`}>
                <span className="flex flex-wrap items-center gap-3">
                  查看日期当天它不在可选部门里。
                  <Button size="sm" variant="outline" onClick={onBack}>
                    回到参与部门
                  </Button>
                </span>
              </Callout>
            </div>
          ) : x.query ? (
            x.stale ? (
              <div key={x.code} role="alert">
                <Callout tone="warning" title={`${name(x.code)} 的依赖刷新没有成功，下面是上次读到的，可能不是最新`}>
                  <Button size="sm" variant="outline" disabled={x.query.isFetching} onClick={() => x.query?.refetch()}>
                    {x.query.isFetching ? '正在重试…' : '重试'}
                  </Button>
                </Callout>
              </div>
            ) : (
              <ReadError key={x.code} what={`${name(x.code)} 的依赖`} query={x.query} compact />
            )
          ) : null,
        )}
    </section>
  )
}

/**
 * 承接清单的一组：组头写名称、数量（只计读取成功的原部门）、未处理数与批量动作；
 * 组内一个容器、连续行、细横线分隔（不再每条一个圆角卡片）。
 */
function ChecklistSection({
  title,
  count,
  scope,
  open,
  hint,
  empty,
  bulk,
  onBulk,
  children,
}: {
  title: string
  count: number
  scope: { ready: number; total: number }
  /** 还没有有效选择的条数（无需选择的组不传） */
  open?: number
  hint?: string
  empty: string
  bulk: Option[]
  onBulk?: (value: string) => void
  children: ReactNode
}) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : []
  const complete = scope.ready === scope.total
  const countText = scope.ready === 0 ? '待读取' : complete ? `${count}` : `已读取部分 ${count}`
  return (
    <section className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-fg-strong text-xs font-semibold">
          {title}（{countText}）
        </h4>
        {open !== undefined && open > 0 && <span className="text-warning-text text-caption">未处理 {open}</span>}
        {hint && <span className="text-fg-muted text-caption">{hint}</span>}
        {rows.length > 1 &&
          onBulk &&
          bulk.map((o) => (
            <button key={o.value} type="button" className="text-fg-secondary hover:text-fg text-caption hover:underline" onClick={() => onBulk(o.value)}>
              全部 → {o.label}
            </button>
          ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-fg-muted text-xs">
          {scope.ready === 0 ? '原部门的依赖还没有读取成功' : complete ? empty : `已读取的原部门里${empty.replace(/^没有/, '没有')}；其余原部门尚未读取成功`}
        </p>
      ) : (
        <div className="border-line-subtle divide-line-subtle divide-y rounded-md border">{children}</div>
      )}
    </section>
  )
}

function ChecklistRow({ label, sub, stale, children }: { label: string; sub?: string; stale?: boolean; children: ReactNode }) {
  return (
    <div className="grid min-h-(--hd-row-height) grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.2fr)] items-center gap-3 px-3 py-2">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-fg text-xs break-words">{label}</span>
        {sub && <span className="text-fg-muted text-caption break-words">{sub}</span>}
        {stale && <span className="text-warning-text text-caption">原来的选择已失效，请重选</span>}
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
  ['person.transfer', '人员调科'],
  ['person.assignment_set_end', '人员结束归属'],
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
  draftId,
}: {
  draftId?: number
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
      <p className="text-fg-strong text-xs font-medium">本次组织变更生效日：{day}</p>
      <p className="text-fg-secondary text-xs">
        {draftId ? `将整体替换草稿 #${draftId} 的变更项` : '将生成一张草稿'}，共 {items.length} 项：{counts.map(([label, n]) => `${label} ${n}`).join('、')}。
        计划中的单元、预约调入的人员按它们自己的开始日处理，不改成 {day}。{type !== 'ABSORB' && '新设部门的代码保存时由系统分配。'}
      </p>
      <p className="text-fg-muted text-caption">
        保存后仍是草稿。提交前系统会再按数据预演一遍，有依赖没处置会被拦下；提交并由确认人确认后，整张正式登记，各项按自己的业务日期生效——确认时间不等于业务生效日期。
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
