import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
import type { ChangeRequestOut, ItemOutcome, ListChangeRequestsStatus } from '@/api/generated/model'
import { ChangeStatusBadge } from '@/components/badges'
import {
  CampusCreateDialog,
  InstitutionCreateDialog,
  RelationCreateDialog,
} from '@/components/forms/change-forms'
import { DepartmentCreateDialog } from '@/components/forms/department-forms'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { REORG_TITLE } from '@/components/forms/reorg-wizard'
import { Callout } from '@/components/kit/callout'
import { Missing } from '@/components/kit/missing'
import { Steps, type StepItem } from '@/components/kit/steps'
import { QuoteDownIcon } from '@hugeicons/core-free-icons'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    <>
      <PageHeader title="变更申请" description="所有写入都经变更申请：草稿 → 提交 → 确认后生效。" />
      <Tabs value={status} onValueChange={(v) => setStatus(String(v))} className="mb-3">
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          {Object.entries(CHANGE_STATUS).map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>没有变更申请</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>变更内容</TableHead>
              <TableHead>说明</TableHead>
              <TableHead>创建</TableHead>
              <TableHead>提交</TableHead>
              <TableHead>确认</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link className="font-medium hover:underline" to={`/changes/${r.id}`}>
                    #{r.id}
                  </Link>
                </TableCell>
                <TableCell>
                  <ChangeStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="whitespace-normal">{r.item_labels.join('、') || '（空）'}</TableCell>
                <TableCell className="max-w-48 truncate">{r.note ?? ''}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.created_by.display_name} · {stamp(r.created_at)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{stamp(r.submitted_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{stamp(r.confirmed_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

// ------------------------------------------------------------------ 详情
export function ChangeDetailPage() {
  const id = Number(useParams().id)
  const { data: cr, isError } = useGetChangeRequest(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [returning, setReturning] = useState(false)
  const [adding, setAdding] = useState<'institution' | 'campus' | 'relation' | 'department' | 'unit' | null>(null)
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
  const removeItem = (index: number) =>
    run(() => updateChangeRequest(id, { items: cr.items.filter((_, i) => i !== index), note: cr.note }))
  const noteDirty = (note.trim() || null) !== (cr.note ?? null)
  const saveNote = () => run(() => updateChangeRequest(id, { items: cr.items, note: note.trim() || null }), '变更说明已保存')
  const closeAdd = (o: boolean) => !o && setAdding(null)

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            变更申请 #{cr.id} <ChangeStatusBadge status={cr.status} />
          </span>
        }
        description={cr.copied_from_id ? <>复制自 <Link className="underline" to={`/changes/${cr.copied_from_id}`}>#{cr.copied_from_id}</Link></> : undefined}
        actions={
          <>
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
            {p.can_submit && (
              <Button disabled={action.isPending} onClick={() =>
                  run(async () => {
                    // 填了说明却没点“保存说明”就提交时，先把说明存上，免得丢失
                    if (noteDirty) await updateChangeRequest(id, { items: cr.items, note: note.trim() || null })
                    return submitChangeRequest(id)
                  }, `申请 #${id} 已提交，等待确认`)
                }>
                提交
              </Button>
            )}
            {cr.status === 'submitted' && (
              <Button
                disabled={!p.can_confirm || action.isPending}
                title={p.confirm_hint ?? undefined}
                onClick={() => run(() => confirmChangeRequest(id), `申请 #${id} 已确认生效`)}
              >
                确认生效
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4">
        {action.error && (
          <Alert variant="destructive">
            <AlertTitle>操作未成功</AlertTitle>
            <AlertDescription>{action.error.message}</AlertDescription>
          </Alert>
        )}
        {cr.problem_message && (
          <Alert variant="destructive">
            <AlertTitle>按当前数据校验未通过，{cr.status === 'draft' ? '暂不能提交' : '暂不能确认'}</AlertTitle>
            <AlertDescription>{cr.problem_message}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-md border px-4 py-4">
          <Steps steps={progress(cr)} />
        </div>

        {p.can_edit ? (
          <Card>
            <CardHeader>
              <CardTitle>
                变更说明
                <span className="text-muted-foreground ml-2 font-normal">选填；提交后确认人会在页面上方看到</span>
              </CardTitle>
              <CardAction>
                <Button size="sm" variant="outline" disabled={!noteDirty || action.isPending} onClick={() => saveNote()}>
                  保存说明
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="为什么做这次变更（提交时会一并保存）" />
            </CardContent>
          </Card>
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
              className="border-l-2 border-brand"
            >
              <p className="text-fg text-sm whitespace-pre-wrap">{cr.note}</p>
            </Callout>
          )
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              变更项（{cr.items.length}）
              <span className="text-muted-foreground ml-2 font-normal">
                {cr.status === 'confirmed' ? '确认时记录的前后内容' : '按当前数据预演，确认时会重新校验'}
              </span>
            </CardTitle>
            {p.can_edit && (
              <CardAction className="flex flex-wrap justify-end gap-1">
                <Button size="sm" variant="outline" onClick={() => setAdding('institution')}>
                  + 新建主体
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding('campus')}>
                  + 新建院区
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding('relation')}>
                  + 建立运营关系
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding('department')}>
                  + 新建部门
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding('unit')}>
                  + 新建服务单元
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {cr.items.length === 0 && <p className="text-muted-foreground text-xs">没有变更项</p>}
            {cr.items.map((item, i) => {
              const outcome = cr.outcomes?.find((o) => o.index === i)
              const problem = cr.problems.find((x) => x.item_index === i)
              return (
                <div key={i} className={cn('rounded-md border p-3', problem && 'border-destructive')}>
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">第 {i + 1} 项</span>
                    <span className="font-medium">{cr.item_labels[i]}</span>
                    <span>{outcome?.target ?? describeItem(item)}</span>
                    {p.can_edit && (
                      <Button size="xs" variant="ghost" className="ml-auto" onClick={() => removeItem(i)}>
                        移除
                      </Button>
                    )}
                  </div>
                  {problem && <p className="text-destructive mb-2 text-xs">{problem.message}</p>}
                  {outcome && <OutcomeDiff outcome={outcome} />}
                </div>
              )
            })}
          </CardContent>
        </Card>
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
      {adding === 'institution' && <InstitutionCreateDialog open onOpenChange={closeAdd} fixedTarget={id} />}
      {adding === 'campus' && <CampusCreateDialog open onOpenChange={closeAdd} fixedTarget={id} />}
      {adding === 'department' && <DepartmentCreateDialog open onOpenChange={closeAdd} fixedTarget={id} />}
      {adding === 'unit' && (
        <UnitCreateDialog
          open
          onOpenChange={closeAdd}
          fixedTarget={id}
          departmentCode={lastCode(cr, 'department.create')}
          campusCode={lastCode(cr, 'campus.create')}
        />
      )}
      {adding === 'relation' && (
        <RelationCreateDialog
          open
          onOpenChange={closeAdd}
          fixedTarget={id}
          campusCode={lastCode(cr, 'campus.create')}
          institutionCode={lastCode(cr, 'institution.create')}
        />
      )}
    </>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16"></TableHead>
            <TableHead>单元</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>所属部门</TableHead>
            <TableHead>院区</TableHead>
            <TableHead>运营主体</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ role, u }, i) => (
            <TableRow key={i} className={cn(role === '后继' && 'font-medium')}>
              <TableCell className="text-muted-foreground">{role}</TableCell>
              <TableCell>
                {String(u.name)} <span className="text-muted-foreground font-mono text-caption">{String(u.code ?? '')}</span>
              </TableCell>
              <TableCell>{formatValue('unit_type', u.unit_type, optionLabels)}</TableCell>
              <TableCell>{formatValue('department', u.department)}</TableCell>
              <TableCell>{formatValue('campus', u.campus)}</TableCell>
              <TableCell>{formatValue('institution', u.institution)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">字段</TableHead>
            {before && <TableHead>变更前</TableHead>}
            <TableHead>{before ? '变更后' : '内容'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((k) => {
            const changed = before && before[k] !== after[k]
            return (
              <TableRow key={k} className={cn(changed && 'bg-muted/60 font-medium')}>
                <TableCell className="text-muted-foreground">{FIELD_LABELS[k]}</TableCell>
                {before && <TableCell>{formatValue(k, before[k], optionLabels)}</TableCell>}
                <TableCell>{formatValue(k, after[k], optionLabels)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {before && keys.length > changedKeys.length && (
        <button className="text-muted-foreground justify-self-start text-xs hover:underline" onClick={() => setShowAll(!showAll)}>
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

function describeItem(item: ChangeRequestOut['items'][number]): string {
  if ('code' in item) return item.code
  if (item.kind === 'operator_relation.create') return `${item.institution_code} → ${item.campus_code}`
  if (item.kind === 'operator_relation.close') return `运营关系 #${item.relation_id}`
  if ('external_code' in item) return `${item.system_code}/${item.namespace_code} ${item.external_code}`
  if (item.kind === 'external_code.assignment_close') return `解释 #${item.assignment_id}`
  if (item.kind === 'department.reorganize')
    return `${REORG_TITLE[item.event_type]}：${item.sources.map((p) => p.code).join('、')} → ${item.results.map((p) => p.code).join('、')}`
  return ''
}

function lastCode(cr: ChangeRequestOut, kind: string): string | undefined {
  const found = [...cr.items].reverse().find((i) => i.kind === kind)
  return found && 'code' in found ? found.code : undefined
}
