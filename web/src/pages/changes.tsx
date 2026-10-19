import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  cancelChangeRequest,
  confirmChangeRequest,
  copyChangeRequest,
  returnChangeRequest,
  submitChangeRequest,
  updateChangeRequest,
  useGetChangeRequest,
  useListChangeRequests,
} from '@/api/generated/changes/changes'
import type { ChangeRequestOut, ChangeRequestSummary, ItemOutcome, ListChangeRequestsStatus } from '@/api/generated/model'
import { ChangeStatusBadge } from '@/components/badges'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { DepartmentReorgWizard, REORG_TITLE } from '@/components/forms/reorg-wizard'
import { useListDepartments } from '@/api/generated/master/master'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbRow, DbTable, DbToolbar, ToggleChip } from '@/components/kit/database'
import { Missing } from '@/components/kit/missing'
import { ProblemCard } from '@/components/problem-card'
import { groupItems, ReorgExtras, ReviewGroupSection, ReviewNav, useReviewChecks } from '@/components/change-review'
import { Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { Steps, type StepItem } from '@/components/kit/steps'
import { FileEditIcon, QuoteDownIcon } from '@hugeicons/core-free-icons'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/app-context'
import { CHANGE_STATUS, FIELD_LABELS, formatValue, stamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'

// ------------------------------------------------------------------ 列表
export function ChangesPage() {
  const [status, setStatus] = useState<string>('all')
  const { data: rows = [] } = useListChangeRequests(
    status === 'all' ? undefined : { status: status as ListChangeRequestsStatus },
  )
  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader icon={FileEditIcon} title="变更申请" description="所有写入都经变更申请：草稿 → 提交 → 确认后生效。" />
      <DbToolbar>
        <ToggleChip label="全部" checked={status === 'all'} onChange={() => setStatus('all')} />
        {Object.entries(CHANGE_STATUS).map(([k, label]) => (
          <ToggleChip key={k} label={label} checked={status === k} onChange={(on) => setStatus(on ? k : 'all')} />
        ))}
      </DbToolbar>
      {rows.length === 0 ? (
        <DbEmpty title="没有变更申请" hint="在各对象页面上发起变更，保存后会出现在这里。" />
      ) : (
        <DbTable
          columns={[
            { label: '#', className: 'w-12' },
            { label: '状态', className: 'w-20' },
            { label: '变更内容', className: 'min-w-64' },
            { label: '说明', className: 'w-48' },
            { label: '最近处理', className: 'w-36' },
          ]}
        >
          {rows.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <Link className="text-fg-strong font-medium hover:underline" to={`/changes/${r.id}`}>
                  #{r.id}
                </Link>
              </DbCell>
              <DbCell>
                <ChangeStatusBadge status={r.status} />
              </DbCell>
              <DbCell className="py-1.5">
                <ItemSummary labels={r.item_labels} />
              </DbCell>
              <DbCell className="max-w-48">
                <span className="text-fg-secondary block truncate" title={r.note ?? undefined}>
                  {r.note ?? ''}
                </span>
              </DbCell>
              <DbCell className="whitespace-nowrap">
                <LastStep r={r} />
              </DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
    </div>
  )
}

/** 最近一步：确认 / 退回 / 撤销 / 提交 / 创建，只显示最新的一步与时间（完整流程在详情页的进度条里） */
function LastStep({ r }: { r: ChangeRequestSummary }) {
  const [label, at] = r.confirmed_at
    ? ['确认', r.confirmed_at]
    : r.returned_at
      ? ['退回', r.returned_at]
      : r.cancelled_at
        ? ['撤销', r.cancelled_at]
        : r.submitted_at
          ? ['提交', r.submitted_at]
          : ['创建', r.created_at]
  return (
    <span className="grid leading-tight" title={`创建：${r.created_by.display_name} ${stamp(r.created_at)}`}>
      <span className="text-fg-secondary">{label}</span>
      <span className="text-fg-muted text-caption">{stamp(at)}</span>
    </span>
  )
}

/**
 * 变更内容摘要：同类变更项合并计数（“新建部门 ×94”），按数量从多到少，最多显示 3 类，其余收成“另 N 类”。
 * 大批量导入的申请不再把表格撑出屏幕；完整内容在申请详情里看。
 */
function ItemSummary({ labels }: { labels: string[] }) {
  if (labels.length === 0) return <span className="text-fg-disabled">（空）</span>
  const groups = [...labels.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const shown = groups.slice(0, 3)
  const rest = groups.slice(3)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(([label, n]) => (
        <Tag key={label} tone="gray">
          {label}
          {n > 1 && <span className="text-fg-muted ml-1 tabular-nums">×{n}</span>}
        </Tag>
      ))}
      {rest.length > 0 && (
        <span className="text-fg-muted text-caption" title={rest.map(([l, n]) => `${l} ×${n}`).join('、')}>
          另 {rest.length} 类
        </span>
      )}
      {labels.length > 1 && <span className="text-fg-muted text-caption">共 {labels.length} 项</span>}
    </span>
  )
}

// ------------------------------------------------------------------ 详情
export function ChangeDetailPage() {
  const id = Number(useParams().id)
  const { data: cr, isError } = useGetChangeRequest(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [returning, setReturning] = useState(false)
  const [reorgEditing, setReorgEditing] = useState(false)
  // 大批量申请（如初始导入上千项）分批显示，避免一次渲染全部
  const [itemLimit, setItemLimit] = useState(50)
  const groups = useMemo(() => (cr ? groupItems(cr) : []), [cr])
  const checks = useReviewChecks(cr ? `${cr.id}-${cr.updated_at}` : null, groups)
  // 从顶部问题清单跳到对应的变更项（必要时先把它显示出来）
  const jumpTo = (index: number) => {
    if (index >= itemLimit) setItemLimit(index + 1)
    requestAnimationFrame(() => document.getElementById(`item-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  useCrumb(Number.isInteger(id) ? `#${id}` : '地址无效')
  const [note, setNote] = useState('')
  const [noteFor, setNoteFor] = useState<number | null>(null)
  if (cr && noteFor !== cr.id) {
    // 换到另一张申请时，用它保存的说明重置输入框
    setNoteFor(cr.id)
    setNote(cr.note ?? '')
  }

  const action = useMutation({
    mutationFn: (fn: () => Promise<ChangeRequestOut>) => fn(),
    onSuccess: async (next) => {
      await qc.invalidateQueries()
      if (next.id !== id) navigate(`/changes/${next.id}`)
    },
  })

  if (!cr) return isError || !Number.isInteger(id) ? <Missing what="变更申请" back={{ to: '/changes', label: '返回变更申请列表' }} /> : null
  const p = cr.permissions
  /** done：成功后的轻提示（失败信息仍显示在页面上方，便于逐条处理） */
  const run = (fn: () => Promise<ChangeRequestOut>, done?: string) =>
    action.mutate(fn, { onSuccess: () => done && notify.success(done) })
  // 申请页只用于核对与提交：不逐项移除（会拆散组织变更这类整体变更）。
  // 向导生成的草稿回到向导调整，保存时整体替换；其他草稿可撤销后重新发起。
  const reorg = cr.items.find((i) => i.kind === 'department.reorganize')
  // 逐组核对：能提交（草稿）或能确认（已提交）的人，全部组核对完才能继续
  const checkable = (cr.status === 'draft' && p.can_submit) || (cr.status === 'submitted' && p.can_confirm)
  const gateTitle = checkable && !checks.all ? '逐组看完并点“我已核对”后才能继续' : undefined
  const primary = p.can_submit ? (
    <Button
      disabled={action.isPending || (checkable && !checks.all)}
      title={gateTitle}
      onClick={() =>
        run(async () => {
          // 填了说明却没点“保存说明”就提交时，先把说明存上，免得丢失
          if (noteDirty) await updateChangeRequest(id, { items: cr.items, note: note.trim() || null })
          return submitChangeRequest(id)
        }, `申请 #${id} 已提交，等待确认`)
      }
    >
      提交
    </Button>
  ) : cr.status === 'submitted' ? (
    <Button
      disabled={!p.can_confirm || action.isPending || (checkable && !checks.all)}
      title={gateTitle ?? p.confirm_hint ?? undefined}
      onClick={() => run(() => confirmChangeRequest(id), `申请 #${id} 已确认生效`)}
    >
      确认生效
    </Button>
  ) : null
  const noteDirty = (note.trim() || null) !== (cr.note ?? null)
  const saveNote = () => run(() => updateChangeRequest(id, { items: cr.items, note: note.trim() || null }), '变更说明已保存')

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={FileEditIcon}
        title={
          <span className="flex flex-wrap items-center gap-2">
            变更申请 #{cr.id} <ChangeStatusBadge status={cr.status} />
          </span>
        }
        description={cr.copied_from_id ? <>复制自 <Link className="underline" to={`/changes/${cr.copied_from_id}`}>#{cr.copied_from_id}</Link></> : undefined}
        actions={
          <>
            {p.can_edit && reorg && (
              <Button variant="outline" disabled={action.isPending} onClick={() => setReorgEditing(true)}>
                回到向导调整
              </Button>
            )}
            {p.can_cancel && (
              <Button variant="ghost" disabled={action.isPending} onClick={() => run(() => cancelChangeRequest(id), `申请 #${id} 已撤销`)}>
                撤销
              </Button>
            )}
            {p.can_copy && (
              <Button variant="outline" disabled={action.isPending} onClick={() => run(() => copyChangeRequest(id), '已复制为新草稿')}>
                复制为新草稿
              </Button>
            )}
            {p.can_return && (
              <Button variant="outline" disabled={action.isPending} onClick={() => setReturning(true)}>
                退回
              </Button>
            )}
            {primary}
          </>
        }
      />

      <div className="grid gap-4">
        <div className="border-line-subtle rounded-md border px-2 py-4 sm:px-4">
          <Steps steps={progress(cr)} />
        </div>
        {action.error && (
          <Callout tone="danger" title="操作未成功">
            {action.error.message}
          </Callout>
        )}
        <div className="grid items-start gap-10 lg:grid-cols-4">
          <main className="grid min-w-0 gap-9 lg:col-span-3">
            {cr.problems.length > 0 && (
              <section className="grid gap-2" aria-label="需要处理的问题">
                <h2 className="text-danger-text text-sm font-semibold">
                  还有 {cr.problems.length} 个问题，{cr.status === 'draft' ? '处理后才能提交' : '处理后才能确认'}
                </h2>
                {cr.problems.map((pr, k) => (
                  <ProblemCard
                    key={k}
                    problem={pr}
                    title={pr.item_index != null ? `第 ${pr.item_index + 1} 项 · ${cr.item_summaries?.[pr.item_index] ?? cr.item_labels[pr.item_index]}` : undefined}
                    onJump={pr.item_index != null ? () => jumpTo(pr.item_index!) : undefined}
                  />
                ))}
              </section>
            )}

            {p.can_edit ? (
              <Section
                title={
                  <>
                    变更说明
                    <span className="text-fg-muted text-caption font-normal">选填；提交后确认人会在页面上方看到</span>
                  </>
                }
                action={
                  <Button size="sm" variant="outline" disabled={!noteDirty || action.isPending} onClick={() => saveNote()}>
                    保存说明
                  </Button>
                }
              >
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="为什么做这次变更（提交时会一并保存）" />
              </Section>
            ) : (
              cr.note && (
                <Callout
                  tone="info"
                  icon={QuoteDownIcon}
                  title={
                    <span className="flex items-center gap-2">
                      变更说明
                      <span className="text-fg-muted font-normal">
                        {cr.created_by.display_name}
                        {cr.submitted_at && ` · 提交于 ${stamp(cr.submitted_at)}`}
                      </span>
                    </span>
                  }
                >
                  <p className="text-fg text-sm whitespace-pre-wrap">{cr.note}</p>
                </Callout>
              )
            )}

            {cr.items.length === 0 && <p className="text-fg-disabled text-xs">没有变更项</p>}
            {groups.map((g, k) => (
              <ReviewGroupSection
                key={g.key}
                cr={cr}
                group={g}
                number={k + 1}
                checkable={checkable}
                checked={checks.checked.has(g.key)}
                onCheck={() => checks.toggle(g.key)}
                renderDiff={(o) => <OutcomeDiff outcome={o} />}
              />
            ))}
            <ReorgExtras cr={cr} number={groups.length + 1} />

            {primary && (
              <div className="border-line-subtle flex flex-wrap items-center gap-4 border-t pt-6">
                <div className="min-w-0 flex-1">
                  <div className="text-fg-strong text-sm font-semibold">{checks.all || !checkable ? '看完了？' : `还有 ${checks.total - checks.done} 组没核对`}</div>
                  <div className="text-fg-secondary text-xs">
                    {cr.status === 'draft' ? '提交后不能再改；确认人确认时会按当天的数据再预演一次。' : '确认后在一个事务里全部生效，之后不能撤回。'}
                  </div>
                </div>
                {primary}
              </div>
            )}
          </main>
          <ReviewNav cr={cr} groups={groups} checks={checks} checkable={checkable} />
        </div>
      </div>

      <ReturnDialog
        open={returning}
        onOpenChange={setReturning}
        pending={action.isPending}
        onReturn={(reason) =>
          action.mutate(() => returnChangeRequest(id, { reason }), {
            onSuccess: () => {
              setReturning(false)
              notify.success(`申请 #${id} 已退回`)
            },
          })
        }
      />
      {reorgEditing && reorg?.kind === 'department.reorganize' && (
        <ReorgEditor cr={cr} sourceCode={reorg.sources[0].code} onClose={() => setReorgEditing(false)} />
      )}
    </div>
  )
}

/** 回到向导调整组织变更草稿：找到原部门，按草稿恢复向导 */
function ReorgEditor({ cr, sourceCode, onClose }: { cr: ChangeRequestOut; sourceCode: string; onClose: () => void }) {
  const { asOf } = useApp()
  const { data: depts } = useListDepartments({ as_of: asOf })
  const row = depts?.find((d) => d.code === sourceCode)
  if (!row) return null
  const created = cr.items.find((i) => i.kind === 'department.create')
  return (
    <DepartmentReorgWizard
      open
      onOpenChange={(o) => !o && onClose()}
      source={{
        id: row.id,
        code: row.code,
        name: row.version.name,
        institutionCode: created && 'institution_code' in created ? (created.institution_code ?? null) : null,
        parentCode: row.parent?.code ?? null,
        mainClass: row.main_class?.code ?? null,
      }}
      draft={{ id: cr.id, note: cr.note ?? null, items: cr.items }}
    />
  )
}

/** 申请的三步：起草 → 提交 → 确认生效；退回、撤销停在发生的那一步 */
function progress(cr: ChangeRequestOut): StepItem[] {
  const by = (who?: { display_name: string } | null, at?: string | null) =>
    at ? (
      <>
        {who?.display_name}
        <br />
        {stamp(at)}
      </>
    ) : undefined
  const cancelled = by(cr.cancelled_by, cr.cancelled_at)
  const draft: StepItem = { label: '起草', state: 'done', detail: by(cr.created_by, cr.created_at) }
  let submit: StepItem
  let confirm: StepItem
  if (cr.status === 'draft') {
    submit = { label: '提交', state: 'current', detail: '补齐变更项后提交' }
    confirm = { label: '确认生效', state: 'upcoming' }
  } else if (cr.status === 'cancelled' && !cr.submitted_at) {
    submit = { label: '提交', state: 'stopped', detail: <>未提交即撤销：{cancelled}</> }
    confirm = { label: '确认生效', state: 'skipped' }
  } else {
    submit = { label: '提交', state: 'done', detail: by(cr.submitted_by, cr.submitted_at) }
    confirm =
      cr.status === 'confirmed'
        ? { label: '确认生效', state: 'done', detail: by(cr.confirmed_by, cr.confirmed_at) }
        : cr.status === 'returned'
          ? { label: '已退回', state: 'stopped', detail: <>{by(cr.returned_by, cr.returned_at)}<br />原因：{cr.return_reason}</> }
          : cr.status === 'cancelled'
            ? { label: '已撤销', state: 'stopped', detail: cancelled }
            : { label: '确认生效', state: 'current', detail: cr.permissions.confirm_hint ?? '等待确认人确认' }
  }
  return [draft, submit, confirm]
}

/** 拆分 / 合并：前身与后继各列一行，确认人一眼看清“谁变成了谁” */
function EvolveDiff({ outcome }: { outcome: ItemOutcome }) {
  const { optionLabels } = useApp()
  const before = (outcome.before ?? {}) as { predecessors?: Record<string, unknown>[] }
  const after = (outcome.after ?? {}) as { effective_date?: string; successors?: Record<string, unknown>[] }
  const day = String(after.effective_date)
  const rows = [
    ...(before.predecessors ?? []).map((u) => ({ role: '前身', u })),
    ...(after.successors ?? []).map((u) => ({ role: '后继', u })),
  ]
  // 快照里的部门、院区是“代码 名称”，图上只显示名称
  const nameOf = (v: unknown) => String(v ?? '').replace(/^\S+\s/, '')
  const card = (u: Record<string, unknown>, tone: 'retire' | 'new'): FlowUnit => ({
    name: String(u.name),
    code: String(u.code ?? ''),
    subtitle: [formatValue('unit_type', u.unit_type, optionLabels), nameOf(u.department), nameOf(u.campus)].join(' · '),
    footer: tone === 'retire' ? `最后有效日 ${dayBefore(day)}` : `自 ${day} 起`,
    tag: tone === 'retire' ? { label: '退出', tone } : { label: '新建', tone },
  })
  return (
    <div className="grid gap-2">
      <EvolveFlow
        kind={(before.predecessors ?? []).length > 1 ? 'merge' : 'split'}
        day={day}
        before={(before.predecessors ?? []).map((u) => card(u, 'retire'))}
        after={(after.successors ?? []).map((u) => card(u, 'new'))}
      />
      <p className="text-xs">
        前身最后有效日 {dayBefore(day)}，次日起退出；后继自 {day} 起，是新身份、新代码，不继承前身历史。
      </p>
      <DbTable columns={[{ label: '', className: 'w-12' }, { label: '单元' }, { label: '类型' }, { label: '所属部门' }, { label: '院区' }, { label: '运营主体' }]}>
        {rows.map(({ role, u }, i) => (
          <DbRow key={i} className={cn(role === '后继' && 'font-medium')}>
            <DbCell className="text-fg-muted">{role}</DbCell>
            <DbCell>
              {String(u.name)} <span className="text-fg-muted font-mono text-caption">{String(u.code ?? '')}</span>
            </DbCell>
            <DbCell className="whitespace-nowrap">{formatValue('unit_type', u.unit_type, optionLabels)}</DbCell>
            <DbCell className="whitespace-nowrap">{formatValue('department', u.department)}</DbCell>
            <DbCell className="whitespace-nowrap">{formatValue('campus', u.campus)}</DbCell>
            <DbCell className="whitespace-nowrap">{formatValue('institution', u.institution)}</DbCell>
          </DbRow>
        ))}
      </DbTable>
    </div>
  )
}

function OutcomeDiff({ outcome }: { outcome: ItemOutcome }) {
  if (outcome.after && typeof outcome.after === 'object' && 'participants' in outcome.after) return <ReorgDiff outcome={outcome} />
  if (outcome.after && typeof outcome.after === 'object' && 'successors' in outcome.after) return <EvolveDiff outcome={outcome} />
  return <PlainDiff outcome={outcome} />
}

/** 部门组织变更：身份结论一张图，依据与随原部门结束的关联写在下面 */
function ReorgDiff({ outcome }: { outcome: ItemOutcome }) {
  type P = { code: string; name: string; role: 'SOURCE' | 'RESULT'; outcome: 'EXITS' | 'NEW' | 'CONTINUES'; scope_note: string | null }
  const after = outcome.after as {
    event_type: keyof typeof REORG_TITLE
    effective_date: string
    basis_note: string
    other_matters: string | null
    participants: P[]
    ended_links: string | null
  }
  const day = after.effective_date
  const label = { EXITS: '退出', NEW: '新设', CONTINUES: '存续' }
  const card = (p: P): FlowUnit => ({
    name: p.name,
    code: p.code,
    subtitle: p.scope_note ?? undefined,
    footer: p.outcome === 'EXITS' ? `最后有效日 ${dayBefore(day)}` : p.outcome === 'NEW' ? `自 ${day} 起` : '身份不变',
    tag: { label: label[p.outcome], tone: p.outcome === 'EXITS' ? 'retire' : p.outcome === 'NEW' ? 'new' : 'current' },
  })
  const sources = after.participants.filter((p) => p.role === 'SOURCE')
  return (
    <div className="grid gap-2">
      <EvolveFlow
        kind={sources.length > 1 ? 'merge' : 'split'}
        day={day}
        label={REORG_TITLE[after.event_type]}
        before={sources.map(card)}
        after={after.participants.filter((p) => p.role === 'RESULT').map(card)}
      />
      <p className="text-xs">
        依据：{after.basis_note}。
        {after.ended_links && <>随原部门结束（历史保留）：{after.ended_links}。</>}
        {after.other_matters && <>需其他系统办理：{after.other_matters}。</>}
        受影响的单元、下级部门与编码见本申请的其他变更项。
      </p>
    </div>
  )
}

function PlainDiff({ outcome }: { outcome: ItemOutcome }) {
  const { optionLabels } = useApp()
  const [showAll, setShowAll] = useState(false)
  const before = outcome.before as Record<string, unknown> | null
  const after = (outcome.after ?? {}) as Record<string, unknown>
  const versioned = 'version_no' in after
  // 版本类对象：期间单独用一句话说明；关系类对象：期间就是内容本身
  const meta = versioned ? ['version_no', 'valid_from', 'valid_to', 'id'] : ['id']
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter(
    (k) => k in FIELD_LABELS && !meta.includes(k),
  )
  const changedKeys = keys.filter((k) => (before ? before[k] !== after[k] : after[k] != null))
  const rows = showAll ? keys : changedKeys

  return (
    <div className="grid gap-2">
      {versioned && before && before.valid_from === after.valid_from && (
        <p className="text-xs">
          第 {String(before.version_no)} 版尚未生效，本次在其开始日 {String(after.valid_from)} 直接更正：原版本保留为“生效前已更正”（从未生效），新第{' '}
          {String(after.version_no)} 版自 {String(after.valid_from)} 起{after.valid_to ? `至 ${after.valid_to}` : '长期有效'}。
        </p>
      )}
      {versioned && before && before.valid_from !== after.valid_from && (
        <p className="text-xs">
          原第 {String(before.version_no)} 版期间变为 {String(before.valid_from)} ~ {dayBefore(String(after.valid_from))}；
          新第 {String(after.version_no)} 版自 {String(after.valid_from)} 起{after.valid_to ? `至 ${after.valid_to}` : '长期有效'}。
        </p>
      )}
      {versioned && !before && <p className="text-xs">新建，自 {String(after.valid_from)} 起生效。</p>}
      <DbTable columns={[{ label: '字段', className: 'w-36' }, ...(before ? [{ label: '变更前' }] : []), { label: before ? '变更后' : '内容' }]}>
        {rows.map((k) => {
          const changed = before && before[k] !== after[k]
          return (
            <DbRow key={k} className={cn(changed && 'bg-surface-subtle font-medium')}>
              <DbCell className="text-fg-muted whitespace-nowrap">{FIELD_LABELS[k]}</DbCell>
              {before && <DbCell className="text-fg-secondary">{formatValue(k, before[k], optionLabels)}</DbCell>}
              <DbCell>{formatValue(k, after[k], optionLabels)}</DbCell>
            </DbRow>
          )
        })}
      </DbTable>
      {before && keys.length > changedKeys.length && (
        <button className="text-fg-muted hover:text-fg justify-self-start text-xs hover:underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? '只看改动的字段' : `显示全部 ${keys.length} 个字段`}
        </button>
      )}
    </div>
  )
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function ReturnDialog({
  open,
  onOpenChange,
  onReturn,
  pending,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onReturn: (reason: string) => void
  pending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退回申请</DialogTitle>
          <DialogDescription>退回后申请结束，维护人可“复制为新草稿”修改后重新提交。</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退回原因（必填）" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || pending} onClick={() => onReturn(reason.trim())}>
            退回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


