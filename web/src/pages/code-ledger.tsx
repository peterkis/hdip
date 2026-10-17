// 编码映射台账（标准与数据集）：外部系统代码 → 部门 / 服务单元 / 对象未建模。
// 同一事实只有一个编辑入口：登记、解释、结束解释都在这里发起，经变更申请确认后生效。
// 状态按查看日期计算：当天没有任何解释的代码即“待裁决”，不单独存状态。
import { Add01Icon, Download01Icon, Link04Icon, ServerStack01Icon } from '@hugeicons/core-free-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useCreateCodeNamespace, useCreateSourceSystem, useUpdateCodeNamespace } from '@/api/generated/dictionary/dictionary'
import { useGetExternalCode, useListExternalCodes, useListSourceSystems } from '@/api/generated/master/master'
import type { AssignmentOut, ExternalCodeRow, SourceSystemOut } from '@/api/generated/model'
import { AssignmentCloseDialog, assignmentTarget, ExternalCodeAssignDialog, ExternalCodeRegisterDialog } from '@/components/forms/code-forms'
import { FormErrorsContext, requireFields, SelectField, TextField, useFocusFirstInvalid } from '@/components/forms/fields'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { CODE_STATUS, SOURCE_KIND, stamp, type CodeStatus } from '@/lib/format'
import { notify } from '@/lib/notify'
import { CODE_STATUS_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

const PAGE = 100

export function CodeLedgerPage() {
  const { asOf } = useApp()
  const { isMaintainer, me } = useMe()
  const canConfig = me?.permissions.includes('dictionary.maintain') ?? false
  const [params, setParams] = useSearchParams()
  const ns = params.get('ns') ?? ''
  const status = (params.get('status') ?? '') as CodeStatus | ''
  const openId = Number(params.get('code')) || null
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const [limit, setLimit] = useState(PAGE)
  const [dialog, setDialog] = useState<'register' | 'assign' | 'systems' | null>(null)
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
    setLimit(PAGE)
  }

  const { data: systems = [], isSuccess: systemsLoaded } = useListSourceSystems({ as_of: asOf })
  const { data: page, isPending } = useListExternalCodes({
    as_of: asOf,
    limit,
    ...(ns && { namespace_id: Number(ns) }),
    ...(status && { status }),
    ...(q && { q }),
  })
  const rows = page?.rows ?? []
  const counts = page?.counts ?? { pending: 0, mapped: 0, unmodeled: 0 }
  const all = counts.pending + counts.mapped + counts.unmodeled

  const exporting = useMutation({
    mutationFn: () => downloadCsv('external-codes', asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的编码映射`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        icon={Link04Icon}
        title="编码映射台账"
        description={`外部系统代码各自标识哪个对象：部门、服务单元，或尚未建模的对象。按 ${asOf} 当天的解释显示。`}
        actions={
          <>
            <Button variant="ghost" disabled={exporting.isPending} onClick={() => exporting.mutate()} title="导出当天指向部门或服务单元的解释；待裁决与对象未建模不导出">
              <Icon icon={Download01Icon} inline="start" />
              导出 CSV
            </Button>
            {canConfig && (
              <Button variant="outline" onClick={() => setDialog('systems')}>
                <Icon icon={ServerStack01Icon} inline="start" />
                来源系统
              </Button>
            )}
            {isMaintainer && (
              <>
                <Button variant="outline" onClick={() => setDialog('assign')}>
                  解释代码
                </Button>
                <Button onClick={() => setDialog('register')}>
                  <Icon icon={Add01Icon} inline="start" />
                  登记代码
                </Button>
              </>
            )}
          </>
        }
      />

      <LedgerGuide empty={!isPending && all === 0 && !q && !status && !ns} />

      {systemsLoaded && systems.length === 0 && (
        <Callout className="mb-4" title="还没有登记来源系统">
          先登记来源系统实例（如某 HIS 实例、病案系统）及其字典，再登记字典里的代码。来源系统与字典是配置，维护人直接维护；代码与解释是业务数据，经变更申请确认。
        </Callout>
      )}

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="搜索代码或源名称" />}>
        <FilterPill
          label="字典"
          icon={ServerStack01Icon}
          value={ns}
          onChange={(v) => set('ns', v)}
          options={systems.flatMap((s) => s.namespaces.map((n) => ({ value: String(n.id), label: `${s.name} · ${n.name}` })))}
        />
        <ToggleChip label={`全部 ${all}`} checked={!status} onChange={() => set('status', '')} />
        {(Object.keys(CODE_STATUS) as CodeStatus[]).map((k) => (
          <ToggleChip key={k} label={`${CODE_STATUS[k]} ${counts[k]}`} checked={status === k} onChange={(on) => set('status', on ? k : '')} />
        ))}
      </DbToolbar>

      {!isPending && rows.length === 0 ? (
        <DbEmpty
          title={all === 0 && !q ? '台账里还没有代码' : '没有符合条件的代码'}
          hint={all === 0 && !q ? '登记代码后经提交、确认才会出现在这里。' : '换个筛选条件或搜索词试试。'}
        />
      ) : (
        <DbTable
          columns={[
            { label: '代码' },
            { label: '源名称', className: 'min-w-40' },
            { label: '来源字典' },
            { label: '状态' },
            { label: `当前解释（${asOf}）`, className: 'min-w-56' },
          ]}
        >
          {rows.map((r) => (
            <CodeRow key={r.id} row={r} onOpen={() => set('code', String(r.id))} />
          ))}
        </DbTable>
      )}

      <DbFooter>
        <span>
          显示 <span className="text-fg-secondary">{rows.length}</span> / {page?.total ?? 0} 条
        </span>
        {page && rows.length < page.total && (
          <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
            再显示 {Math.min(PAGE, page.total - rows.length)} 条
          </Button>
        )}
        <span>同一字典同一代码、同一院区条件、同一时点只有一个解释；要汇总到部门，沿服务单元的所属部门往上走</span>
      </DbFooter>

      {openId && <CodeDetailDialog id={openId} onClose={() => set('code', '')} />}
      {dialog === 'register' && (
        <ExternalCodeRegisterDialog open onOpenChange={(o) => !o && setDialog(null)} namespace={nsKey(systems, ns)} />
      )}
      {dialog === 'assign' && <ExternalCodeAssignDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === 'systems' && <SourceSystemsDialog systems={systems} onClose={() => setDialog(null)} />}
    </>
  )
}

function nsKey(systems: SourceSystemOut[], nsId: string): string {
  for (const s of systems) for (const n of s.namespaces) if (String(n.id) === nsId) return `${s.code}/${n.code}`
  return ''
}

function TargetCell({ a }: { a: AssignmentOut }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {a.department ? (
        <>
          <Tag tone="blue">部门</Tag>
          <Link to={`/departments/${a.department.id}`} className="hover:underline">
            {a.department.name}
          </Link>
        </>
      ) : a.service_unit ? (
        <>
          <Tag tone="green">服务单元</Tag>
          <Link to={`/service-units/${a.service_unit.id}`} className="hover:underline">
            {a.service_unit.name}
          </Link>
        </>
      ) : (
        <span className="text-fg-secondary">{assignmentTarget(a)}</span>
      )}
      {a.campus_name && <Tag tone="purple">{a.campus_name}</Tag>}
    </span>
  )
}

function CodeRow({ row: r, onOpen }: { row: ExternalCodeRow; onOpen: () => void }) {
  return (
    <DbRow>
      <DbCell className="whitespace-nowrap">
        <button type="button" onClick={onOpen} className="text-fg-strong decoration-line-strong font-mono font-medium underline-offset-4 hover:underline">
          {r.code}
        </button>
      </DbCell>
      <DbCell>{r.source_name ?? <span className="text-fg-disabled">—</span>}</DbCell>
      <DbCell className="text-fg-secondary whitespace-nowrap">
        {r.system_name} · {r.namespace_name}
      </DbCell>
      <DbCell className="whitespace-nowrap">
        <Tag tone={CODE_STATUS_TONE[r.status]}>{CODE_STATUS[r.status as CodeStatus]}</Tag>
      </DbCell>
      <DbCell className="py-1.5">
        {r.current.length ? (
          <span className="grid gap-1">
            {r.current.map((a) => (
              <TargetCell key={a.id} a={a} />
            ))}
          </span>
        ) : (
          <span className="text-fg-disabled">未解释</span>
        )}
      </DbCell>
    </DbRow>
  )
}

// ------------------------------------------------------------------ 单条代码：解释历史
function CodeDetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data } = useGetExternalCode(id, { as_of: asOf })
  const [assigning, setAssigning] = useState(false)
  const [closing, setClosing] = useState<AssignmentOut | null>(null)
  if (!data) return null
  if (assigning) return <ExternalCodeAssignDialog open onOpenChange={(o) => !o && setAssigning(false)} code={data} />
  if (closing) return <AssignmentCloseDialog open onOpenChange={(o) => !o && setClosing(null)} assignment={closing} code={data} />
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{data.code}</span> {data.source_name}
            <Tag tone={CODE_STATUS_TONE[data.status]}>{CODE_STATUS[data.status as CodeStatus]}</Tag>
          </DialogTitle>
          <DialogDescription>
            {data.system_name} · {data.namespace_name}。登记于 {stamp(data.recorded_at)}（
            <Link to={`/changes/${data.created_change_id}`} className="hover:underline">
              #{data.created_change_id}
            </Link>
            ）。{data.semantic_note && `含义：${data.semantic_note}`}
          </DialogDescription>
        </DialogHeader>
        {data.assignments.length === 0 ? (
          <Callout tone="warning" title="待裁决">
            这个代码还没有任何解释，在任何日期都是待裁决，不进入导出。裁决 = 新增一条解释，开始日可以在过去。
          </Callout>
        ) : (
          <DbTable columns={[{ label: '指向' }, { label: '期间' }, { label: '判定说明', className: 'min-w-40' }, { label: '来源申请' }, { label: '' }]}>
            {data.assignments.map((a) => {
              const current = a.valid_from <= asOf && (a.valid_to === null || a.valid_to >= asOf)
              return (
                <DbRow key={a.id} className={cn(!current && 'text-fg-muted')}>
                  <DbCell className="py-1.5">
                    <TargetCell a={a} />
                  </DbCell>
                  <DbCell className="whitespace-nowrap">
                    {a.valid_from} → {a.valid_to ?? '长期'}
                  </DbCell>
                  <DbCell className="py-1.5">{a.evidence_note ?? '—'}</DbCell>
                  <DbCell className="whitespace-nowrap">
                    <Link to={`/changes/${a.change_id}`} className="text-fg-secondary hover:underline">
                      #{a.change_id}
                    </Link>
                    {a.closed_change_id && (
                      <Link to={`/changes/${a.closed_change_id}`} className="text-fg-secondary ml-1.5 hover:underline">
                        结束 #{a.closed_change_id}
                      </Link>
                    )}
                  </DbCell>
                  <DbCell className="text-right">
                    {isMaintainer && a.valid_to === null && (
                      <Button size="xs" variant="ghost" onClick={() => setClosing(a)}>
                        结束
                      </Button>
                    )}
                  </DbCell>
                </DbRow>
              )
            })}
          </DbTable>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {isMaintainer && <Button onClick={() => setAssigning(true)}>新增解释</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ 来源系统与字典（配置，保存即生效）
function SourceSystemsDialog({ systems, onClose }: { systems: SourceSystemOut[]; onClose: () => void }) {
  const qc = useQueryClient()
  const opts = { mutation: { onSuccess: () => qc.invalidateQueries(), onError: (e: Error) => notify.error(e.message) } }
  const createSystem = useCreateSourceSystem(opts)
  const createNs = useCreateCodeNamespace(opts)
  const updateNs = useUpdateCodeNamespace(opts)
  const [mode, setMode] = useState<'system' | 'ns'>(systems.length ? 'ns' : 'system')
  const [f, setF] = useState({ system: systems[0] ? String(systems[0].id) : '', code: '', name: '', kind: 'HIS', note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const focus = useFocusFirstInvalid()
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (v: string) => setF({ ...f, [k]: v }) })
  // 只有一个来源系统时直接选中它（含刚在本窗口登记的第一个）
  const system = f.system || (systems.length === 1 ? String(systems[0].id) : '')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const bad = requireFields([
      ['system', mode === 'system' || !!system, '请选择来源系统'],
      ['code', /^[A-Z][A-Z0-9_]{0,63}$/.test(f.code.trim()), '代码只能用大写字母、数字、下划线，且以字母开头'],
      ['name', !!f.name.trim(), '请填写名称'],
    ])
    if (bad) {
      setErrors(bad.fieldErrors)
      focus.focusFirst()
      return
    }
    const done = () => {
      notify.success(`已登记“${f.name.trim()}”`)
      setF({ ...f, code: '', name: '', note: '' })
    }
    const body = { code: f.code.trim(), name: f.name.trim(), note: f.note }
    if (mode === 'system') createSystem.mutate({ data: { ...body, kind: f.kind } }, { onSuccess: done })
    else createNs.mutate({ systemId: Number(system), data: body }, { onSuccess: done })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>来源系统与字典</DialogTitle>
          <DialogDescription>
            配置，保存即生效，不需确认。同一厂商的多个实例（如各院区账套）分别登记；字典不限定只装一种对象，混装字典逐条解释。代码新建后不可改，只能停用。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {systems.map((s) => (
            <div key={s.id} className="grid gap-1">
              <p className="text-fg-strong text-xs font-semibold">
                {s.name} <span className="text-fg-muted font-mono font-normal">{s.code}</span>
                <Tag className="ml-2">{SOURCE_KIND[s.kind as keyof typeof SOURCE_KIND] ?? s.kind}</Tag>
              </p>
              {s.note && <p className="text-fg-muted text-caption">{s.note}</p>}
              {s.namespaces.map((n) => (
                <p key={n.id} className={cn('flex items-center gap-2 pl-3 text-xs', !n.is_active && 'text-fg-muted')}>
                  <span>{n.name}</span>
                  <span className="text-fg-muted font-mono text-caption">{n.code}</span>
                  <span className="text-fg-muted text-caption">
                    {n.code_count} 个代码 · 待裁决 {n.pending_count}
                  </span>
                  {!n.is_active && <Tag>已停用</Tag>}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    disabled={updateNs.isPending}
                    onClick={() => updateNs.mutate({ namespaceId: n.id, data: { is_active: !n.is_active } })}
                  >
                    {n.is_active ? '停用' : '恢复'}
                  </Button>
                </p>
              ))}
            </div>
          ))}
        </div>
        <form ref={focus.ref} onSubmit={onSubmit} noValidate className="border-line-subtle grid gap-3 border-t pt-4">
          <div className="flex gap-1.5">
            <ToggleChip label="登记字典" checked={mode === 'ns'} onChange={() => setMode('ns')} />
            <ToggleChip label="登记来源系统" checked={mode === 'system'} onChange={() => setMode('system')} />
          </div>
          <FormErrorsContext.Provider
            value={{
              errors,
              clear: (n) =>
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next[n]
                  return next
                }),
            }}
          >
            {mode === 'ns' ? (
              <SelectField
                label="来源系统"
                name="system"
                required
                placeholder="请选择来源系统"
                value={system}
                onChange={(v) => setF({ ...f, system: v })}
                options={systems.map((s) => ({ value: String(s.id), label: s.name }))}
              />
            ) : (
              <SelectField
                label="系统类别"
                required
                value={f.kind}
                onChange={(v) => setF({ ...f, kind: v })}
                options={Object.entries(SOURCE_KIND).map(([value, label]) => ({ value, label }))}
              />
            )}
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <TextField label="代码" name="code" required hint="大写字母、数字、下划线" {...bind('code')} />
              <TextField label="名称" name="name" required hint={mode === 'ns' ? '如“科室字典”“挂号单元字典”' : '如“HIS（本院实例）”'} {...bind('name')} />
            </div>
            <TextField label="说明" {...bind('note')} />
          </FormErrorsContext.Provider>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button type="submit" disabled={createSystem.isPending || createNs.isPending}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ 使用说明
const GUIDE_STEPS = [
  { title: '登记来源系统与字典', who: '配置 · 维护人直接维护', text: '如“HIS（本部实例）”下的“科室字典”。一个字典可以同时装部门、单元和其他对象的代码。' },
  { title: '登记代码', who: '变更申请', text: '把字典里的一条记录原样抄进来：代码、源名称、语义备注。登记后不可改，只记录“它存在”。' },
  { title: '解释代码', who: '变更申请', text: '判断这条代码标识的是哪个部门、哪个服务单元，或是还没建模的对象（如护理单元）；带开始日，可限定院区。' },
  { title: '确认后生效', who: '确认人', text: '确认后按查看日期显示状态；只有指向部门、服务单元的解释会进入导出。' },
]

const GUIDE_EXAMPLES: { code: string; source: string; status: CodeStatus; meaning: string }[] = [
  { code: '0301', source: '心内科', status: 'mapped', meaning: '部门：心血管内科' },
  { code: '0301-MZ', source: '心内科门诊', status: 'mapped', meaning: '服务单元：心血管内科门诊（本部院区）' },
  { code: 'HL05', source: '五病区护理单元', status: 'unmodeled', meaning: '对象未建模：护理单元（不进导出）' },
  { code: '1288', source: '体检中心', status: 'pending', meaning: '还没人判断 → 点开代码“新增解释”' },
]

/** 台账为空时展开，有数据后收起成一行入口 */
function LedgerGuide({ empty }: { empty: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? empty
  return (
    <div className="border-line-subtle mb-4 rounded-md border">
      <button
        type="button"
        className="text-fg-secondary hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-4 py-2 text-left text-xs"
        onClick={() => setOpen(!shown)}
      >
        <span className="text-fg-strong font-medium">这张台账怎么用？</span>
        <span className="text-fg-muted">外部系统的代码各自代表什么：哪个部门、哪个服务单元，还是尚未建模的对象</span>
        <span className="text-fg-muted ml-auto">{shown ? '收起' : '展开'}</span>
      </button>
      {shown && (
        <div className="grid gap-4 px-4 pt-1 pb-4">
          <ol className="grid gap-2 sm:grid-cols-4">
            {GUIDE_STEPS.map((st, i) => (
              <li key={st.title} className="bg-surface-subtle grid content-start gap-1 rounded-md p-3 text-xs">
                <span className="text-fg-strong flex items-center gap-1.5 font-medium">
                  <span className="bg-brand text-fg-on-brand flex size-5 items-center justify-center rounded-full text-caption">{i + 1}</span>
                  {st.title}
                </span>
                <span className="text-fg-muted text-caption">{st.who}</span>
                <span className="text-fg-secondary">{st.text}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-1.5">
            <span className="text-fg-muted text-caption">示例（不是真实数据）：同一个 HIS 科室字典里的四条代码，判断结果各不相同</span>
            <DbTable columns={[{ label: '代码' }, { label: '源名称' }, { label: '状态' }, { label: '解释为' }]}>
              {GUIDE_EXAMPLES.map((e) => (
                <DbRow key={e.code}>
                  <DbCell className="font-mono">{e.code}</DbCell>
                  <DbCell>{e.source}</DbCell>
                  <DbCell>
                    <Tag tone={CODE_STATUS_TONE[e.status]}>{CODE_STATUS[e.status]}</Tag>
                  </DbCell>
                  <DbCell className="text-fg-secondary">{e.meaning}</DbCell>
                </DbRow>
              ))}
            </DbTable>
            <span className="text-fg-muted text-caption">
              要点：代码跟着它标识的对象走——同一字典里“心内科”指部门、“心内科门诊”指服务单元，逐条判断，不按系统名一刀切；某天没有任何解释的代码即“待裁决”。
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
