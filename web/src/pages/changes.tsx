import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  cancelChangeRequest,
  confirmChangeRequest,
  copyChangeRequest,
  returnChangeRequest,
  submitChangeRequest,
  updateChangeRequest,
  getGetChangeRequestQueryKey,
  useGetChangeRequest,
  useListChangeRequests,
} from '@/api/generated/changes/changes'
import type { ChangeRequestOut, ChangeRequestSummary, ItemOutcome } from '@/api/generated/model'
import { ChangeStatusBadge } from '@/components/badges'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { DepartmentReorgWizard, REORG_TITLE } from '@/components/forms/reorg-wizard'
import { useListDepartments } from '@/api/generated/master/master'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, SearchBox } from '@/components/kit/database'
import { Segmented } from '@/components/kit/segmented'
import { DetailFallback } from '@/components/kit/missing'
import { isDenial, ReadError, readStatus, StaleNotice } from '@/components/kit/read-state'
import { ProblemCard } from '@/components/problem-card'
import { groupItems, locateItem, REVIEW_PAGE, ReorgExtras, ReviewGroupSection, ReviewNav, useReviewChecks, type FocusRequest } from '@/components/change-review'
import { InlineAction, Section } from '@/components/kit/section'
import { Steps, type StepItem } from '@/components/kit/steps'
import { QuoteDownIcon } from '@hugeicons/core-free-icons'
import { PageHeader, usePageFrame } from '@/components/layout'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/app-context'
import { CHANGE_STATUS, FIELD_LABELS, formatValue, relStamp, SENSITIVE_FIELD, stamp } from '@/lib/format'
import { useListReturn } from '@/lib/scroll-memory'
import { cn, scrollBehavior } from '@/lib/utils'
import { notify } from '@/lib/notify'

// ------------------------------------------------------------------ 列表

/** 敏感字段的中文名（后端 PERSON_FIELD_PERMISSIONS 登记的字段） */
// 变更申请列表（统一规范 v1.0 SC-02 的版式 + 2026-10-24 Peter 选定的组合）：
// 规范版的 work 外框、24px 标题、单选导航、三列双行工作列表；第一行用服务端的“对象 · 变化”摘要（headline，
// 与详情的一句话说明同源、同规则脱敏）；导航加“待我确认”（按 approval_rule）、“我的草稿”；处理时间写相对说法，
// 精确时间在详情页。
type View = 'all' | 'waiting' | 'mine' | 'draft' | 'submitted' | 'confirmed' | 'returned' | 'cancelled'
const VIEWS: { value: View; label: string; test: (r: ChangeRequestSummary) => boolean; accent?: boolean; divider?: boolean }[] = [
  { value: 'all', label: '全部', test: () => true },
  { value: 'waiting', label: '待我确认', test: (r) => r.waiting_for_me, accent: true },
  { value: 'mine', label: '我的草稿', test: (r) => r.is_mine && r.status === 'draft' },
  ...(['draft', 'submitted', 'confirmed', 'returned', 'cancelled'] as const).map((k, i) => ({
    value: k,
    label: CHANGE_STATUS[k],
    test: (r: ChangeRequestSummary) => r.status === k,
    divider: i === 0,
  })),
]

const MASKED = '（已隐去）'

/** 说明能不能显示：空的、只剩遮蔽提示的不显示 */
function usableNote(note: string | null | undefined): string | null {
  const t = note?.trim()
  if (!t) return null
  return t.replaceAll(MASKED, '').replace(/[\s，。、；：,.;:]/g, '') ? t : null
}

const ACTION: Record<ChangeRequestSummary['last_step']['action'], string> = {
  create: '创建',
  submit: '提交',
  confirm: '确认',
  return: '退回',
  cancel: '撤销',
}

export function ChangesPage() {
  usePageFrame('work')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view: View = VIEWS.some((v) => v.value === params.get('view')) ? (params.get('view') as View) : 'all'
  const query = params.get('q') ?? ''
  const setParam = (k: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v && !(k === 'view' && v === 'all')) next.set(k, v)
        else next.delete(k)
        return next
      },
      { replace: true },
    )
  // 一次取全部：各状态的计数是完整口径；筛选在页面里做，不逐行取详情
  // 读取状态（U3R-03）：首次读取、失败时计数不写 0；同一范围刷新失败时照常显示上次结果并标出
  const list = useListChangeRequests()
  const listStatus = readStatus(list)
  const isPending = listStatus === 'loading'
  const rows = useMemo(() => list.data ?? [], [list.data])
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.value, rows.filter(v.test).length])), [rows])
  const current = VIEWS.find((v) => v.value === view)!
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '')
    return rows
      .filter(current.test)
      .filter(
        (r) =>
          !q ||
          [String(r.id), r.headline.subject ?? '', r.headline.change, r.note ?? '', r.created_by.display_name, ...r.item_labels].some((t) =>
            t.toLowerCase().includes(q),
          ),
      )
  }, [rows, current, query])
  // 返回上下文（lib/scroll-memory.ts）：从详情返回时回到原范围、位置与刚才打开的那一行
  const back = useListReturn({ scope: params.toString(), ready: !isPending && listStatus !== 'error' })
  const remember = (id: number) => back.leave(id, `/changes/${id}`)

  return (
    <>
      <PageHeader title="变更申请" description="登记与核对主数据变化。本页列出全部申请，不按查看日期筛选。" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="申请范围"
          value={view}
          onChange={(v) => setParam('view', v)}
          options={VIEWS.map((v) => ({ value: v.value, label: v.label, count: listStatus === 'ready' ? counts[v.value] : undefined, accent: v.accent, divider: v.divider }))}
        />
        <span className="flex-1" />
        <SearchBox value={query} onChange={(v) => setParam('q', v)} placeholder="对象名称、编号、说明或申请人" />
      </div>

      <StaleNotice what="变更申请" query={list} />
      {listStatus === 'error' ? (
        <ReadError what="变更申请" query={list} />
      ) : (
        <div className="overflow-x-auto" aria-busy={isPending || undefined}>
          <div className="min-w-2xl">
            <div className="bg-surface-subtle text-fg-muted grid h-(--hd-row-header-height) grid-cols-(--hd-work-list-columns) items-center gap-3 px-(--hd-cell-padding-x) text-xs">
              <span>变更概要</span>
              <span>状态</span>
              <span>最近处理</span>
            </div>
            {isPending ? (
              <ListSkeleton />
            ) : shown.length === 0 ? (
              rows.length === 0 ? (
                <DbEmpty title="还没有变更申请" hint="在各对象页面发起变更，保存后会出现在这里。" />
              ) : (
                <DbEmpty
                  title={
                    query
                      ? `没有符合“${query}”的申请`
                      : view === 'waiting'
                        ? '没有等你确认的申请'
                        : view === 'mine'
                          ? '你没有草稿'
                          : `没有${current.label}的申请`
                  }
                  hint={`全部共 ${rows.length} 份申请。`}
                  action={
                    <Button size="sm" variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                      清除筛选，查看全部
                    </Button>
                  }
                />
              )
            ) : (
              shown.map((r) => (
                <WorkRow key={r.id} r={r} onOpen={() => remember(r.id)} onRowClick={() => (remember(r.id), navigate(`/changes/${r.id}`))} />
              ))
            )}
          </div>
        </div>
      )}
      {listStatus === 'ready' && (
        <DbFooter>
          <span>
            {shown.length} 份申请 · 当前范围：{current.label}
            {query && <> · 检索“{query}”</>}
          </span>
        </DbFooter>
      )}
    </>
  )
}

/** 双行工作列表的一行（R-ROW 5.1：≥64 = 12 + 20 + 4 + 16 + 12；标题两行时自然增高） */
function WorkRow({ r, onOpen, onRowClick }: { r: ChangeRequestSummary; onOpen: () => void; onRowClick: () => void }) {
  const h = r.headline
  const note = usableNote(r.note)
  const quiet = r.status === 'cancelled'
  const kinds =
    r.item_count > 1
      ? `（${h.kind_counts
          .slice(0, 3)
          .map((k) => `${k.label} ${k.count}`)
          .join('、')}${h.kind_counts.length > 3 ? ' 等' : ''}）`
      : ''
  const at = r.last_step.at
  return (
    <div
      // 整行可点是额外入口；摘要链接才是主入口（键盘、新标签页、复制链接都靠它）。选中文字或点到链接时不跳转
      onClick={(e) => {
        if (window.getSelection()?.toString() || (e.target as HTMLElement).closest('a, button')) return
        onRowClick()
      }}
      className="border-line-subtle hover:bg-surface-hover grid min-h-(--hd-work-row-min-height) cursor-pointer grid-cols-(--hd-work-list-columns) items-start gap-3 border-b px-(--hd-cell-padding-x) py-(--hd-work-row-padding-y) transition-colors duration-(--hd-duration-fast)"
    >
      <div className="grid min-w-0 gap-1">
        <Link
          to={`/changes/${r.id}`}
          data-change-id={r.id}
          data-return-id={r.id}
          onClick={onOpen}
          className={cn(
            'line-clamp-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hd-focus-ring)',
            quiet ? 'text-fg-secondary font-medium' : 'text-fg-strong font-semibold',
          )}
        >
          {h.subject && (
            <>
              {h.subject}
              <span className="text-fg-muted font-normal"> · </span>
            </>
          )}
          <span className={cn('font-medium', !quiet && 'text-fg')}>{h.change}</span>
        </Link>
        <span className="text-fg-muted truncate text-caption">
          #{r.id} · {r.created_by.display_name} · {r.item_count} 项变更{kinds}
          {r.status === 'returned' && r.return_reason && <span className="text-tag-orange-text"> · 退回原因：{r.return_reason}</span>}
          {note && <> · 说明：{note}</>}
        </span>
      </div>
      <span className="pt-0.5">
        <ChangeStatusBadge status={r.status} />
      </span>
      <span className="grid gap-1">
        <span className="text-fg-secondary truncate">
          {r.last_step.by.display_name} {ACTION[r.last_step.action]}
        </span>
        <span className="text-fg-muted text-caption whitespace-nowrap">
          {/* 相对说法一眼看远近；精确时间悬停可见，详情页的处理步骤里也有 */}
          <time dateTime={at} title={stamp(at)}>
            {relStamp(at)}
          </time>
          {r.waiting_for_me && <span className="text-brand-text font-semibold"> · 待你确认</span>}
        </span>
      </span>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="正在加载变更申请">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="border-line-subtle grid min-h-(--hd-work-row-min-height) grid-cols-(--hd-work-list-columns) items-start gap-3 border-b px-(--hd-cell-padding-x) py-(--hd-work-row-padding-y)"
        >
          <span className="grid gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </span>
          <Skeleton className="h-5 w-12" />
          <span className="grid gap-1">
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-4 w-24" />
          </span>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ 详情
export function ChangeDetailPage() {
  usePageFrame('work')
  const id = Number(useParams().id)
  const query = useGetChangeRequest(id)
  const { data: cr } = query
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [returning, setReturning] = useState(false)
  const [reorgEditing, setReorgEditing] = useState(false)
  const groups = useMemo(() => (cr ? groupItems(cr) : []), [cr])
  const checks = useReviewChecks(cr ? `${cr.id}-${cr.updated_at}` : null, groups)
  // 大批量申请（如初始导入上千项）每组先显示 REVIEW_PAGE 行；可见行数按组记在这里，换一张申请时重置
  const [view, setView] = useState<{ id: number; limits: Record<string, number>; focus: FocusRequest | null }>({ id, limits: {}, focus: null })
  if (view.id !== id) setView({ id, limits: {}, focus: null })
  const limitOf = (g: string) => view.limits[g] ?? REVIEW_PAGE
  // 从顶部问题清单跳到对应的显示行：只把目标所在组展开到目标为止（其他组不动），行挂载后由该行滚动、聚焦并闪一下
  const jumpSeq = useRef(0)
  const jumpTo = (index: number) => {
    if (!cr) return
    const loc = locateItem(cr, groups, index)
    if (!loc) return
    const seq = ++jumpSeq.current
    setView((v) => ({
      ...v,
      limits: loc.position >= (v.limits[loc.group] ?? REVIEW_PAGE) ? { ...v.limits, [loc.group]: loc.position + 1 } : v.limits,
      focus: { owner: loc.owner, seq, key: `${cr.id}-${cr.updated_at}` },
    }))
  }
  const clearFocus = () => setView((v) => (v.focus ? { ...v, focus: null } : v))
  useCrumb(Number.isInteger(id) ? `#${id}` : '地址无效')
  const [note, setNote] = useState('')
  // 说明输入框的基准：载入它时的申请、说明与版本。保存说明以这个版本为前提（PR #1 评审）——
  // 页面刷新会带来新版本号，但输入框里是基于旧版本的编辑，不能用新版本号放行。
  // 换到另一张申请时重置；没改过说明时跟随刷新同步到最新内容与版本
  const [noteBase, setNoteBase] = useState<{ id: number; note: string; version: string } | null>(null)
  if (cr && (noteBase?.id !== cr.id || (note === noteBase.note && cr.updated_at !== noteBase.version))) {
    const text = cr.note ?? ''
    setNoteBase({ id: cr.id, note: text, version: cr.updated_at })
    setNote(text)
  }

  /** 说明写入成功：立刻把服务端返回的草稿写进详情缓存，并把说明基准前移到这次写入（PR #1 评审）。
   *  不等之后的整体刷新——刷新前旧缓存会把基准“回退”成保存前的版本；提交前自动保存后提交失败时，
   *  也不会走到刷新。两种情况下一次保存都会带着旧版本被自己挡成 412 */
  const adoptNoteWrite = (next: ChangeRequestOut) => {
    qc.setQueryData(getGetChangeRequestQueryKey(next.id), next)
    const text = next.note ?? ''
    setNoteBase({ id: next.id, note: text, version: next.updated_at })
    setNote(text)
  }

  const action = useMutation({
    mutationFn: (fn: () => Promise<ChangeRequestOut>) => fn(),
    onSuccess: async (next) => {
      await qc.invalidateQueries()
      if (next.id !== id) navigate(`/changes/${next.id}`)
    },
  })

  if (!cr || isDenial(query.error))
    return <DetailFallback what="变更申请" back={{ to: '/changes', label: '返回变更申请列表' }} query={query} invalid={!Number.isInteger(id)} />
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
  // 主动作只在页头（统一规范 R-ACT 7.4 / C-02）：草稿“提交申请”，已提交“确认申请”；文案对应真实后果（R-ACT 7.1）
  const primary = p.can_submit ? (
    <Button
      id="change-primary-action"
      disabled={action.isPending || (checkable && !checks.all)}
      title={gateTitle}
      onClick={() =>
        run(async () => {
          // 填了说明却没点“保存说明”就提交时，先把说明存上，免得丢失
          if (noteDirty)
            adoptNoteWrite(await updateChangeRequest(id, { items: cr.items, note: note.trim() || null, expected_updated_at: noteBase?.version ?? cr.updated_at }))
          return submitChangeRequest(id)
        }, `申请 #${id} 已提交，等待确认`)
      }
    >
      提交申请
    </Button>
  ) : cr.status === 'submitted' ? (
    <Button
      id="change-primary-action"
      disabled={!p.can_confirm || action.isPending || (checkable && !checks.all)}
      title={gateTitle ?? p.confirm_hint ?? undefined}
      onClick={() => run(() => confirmChangeRequest(id), `申请 #${id} 已确认：已正式登记，各项按自己的业务日期适用`)}
    >
      确认申请
    </Button>
  ) : null
  const noteDirty = (note.trim() || null) !== (cr.note ?? null)
  // 带读取时的 updated_at：草稿此后在别处被改过，服务端拒绝（412），不用页面上的旧变更项覆盖
  const saveNote = () =>
    run(async () => {
      const next = await updateChangeRequest(id, { items: cr.items, note: note.trim() || null, expected_updated_at: noteBase?.version ?? cr.updated_at })
      adoptNoteWrite(next)
      return next
    }, '变更说明已保存')

  // 统一规范 SC-03：页头（编号、状态、动作）→ 处理步骤 → 阻塞信息（问题、权限、隐去说明）→ 变更说明 → 逐组核对 + 目录 → 结束提醒。
  // 净内容宽 ≥1040 时目录在右侧（200px），更窄时在上方并可展开
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            变更申请 #{cr.id} <ChangeStatusBadge status={cr.status} />
          </span>
        }
        description="本页不按查看日期筛选；申请里的各项按各自的业务日期生效。"
        meta={
          <>
            {cr.created_by.display_name} 起草 · {cr.items.length} 项变更
            {cr.copied_from_id && (
              <>
                {' '}
                · 复制自{' '}
                <Link className="underline" to={`/changes/${cr.copied_from_id}`}>
                  #{cr.copied_from_id}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            {p.can_edit && reorg && (
              <Button variant="outline" disabled={action.isPending} onClick={() => setReorgEditing(true)}>
                回到向导调整
              </Button>
            )}
            {p.can_cancel && (
              <Button variant="ghost" disabled={action.isPending} onClick={() => run(() => cancelChangeRequest(id), `申请 #${id} 已撤销`)}>
                撤销申请
              </Button>
            )}
            {p.can_copy && (
              <Button variant="outline" disabled={action.isPending} onClick={() => run(() => copyChangeRequest(id), '已复制为新草稿')}>
                复制为新草稿
              </Button>
            )}
            {p.can_return && (
              <Button variant="outline" disabled={action.isPending} onClick={() => setReturning(true)}>
                退回申请
              </Button>
            )}
            {primary}
          </>
        }
      />

      <div className="grid gap-4">
        <div className="border-line-subtle border-b pb-4">
          <Steps steps={progress(cr, groups.length)} />
        </div>
        {action.error && (
          <Callout tone="danger" title="操作未成功">
            {action.error.message}
          </Callout>
        )}
        {cr.status === 'submitted' && !p.can_confirm && p.confirm_hint && (
          <Callout tone="neutral" title="你不能确认这张申请">
            {p.confirm_hint}
          </Callout>
        )}
        {(cr.masked_fields ?? []).length > 0 && (
          <Callout tone="neutral" title="部分敏感信息已隐去">
            你没有“查看人员敏感信息”的权限，本申请里的{(cr.masked_fields ?? []).map((f) => SENSITIVE_FIELD[f] ?? f).join('、')}显示为“（已隐去）”；这张申请也不能由你编辑。
          </Callout>
        )}
        <div className="@container">
          <div className="grid items-start gap-6 @review:grid-cols-(--hd-review-columns)">
            <div className="grid min-w-0 gap-8">
              {cr.problems.length > 0 && (
                <section className="grid gap-2" aria-label="需要处理的问题">
                  <h2 className="text-danger-text text-section font-semibold">
                    还有 {cr.problems.length} 个问题，{cr.status === 'draft' ? '处理后才能提交' : '处理后才能确认'}
                  </h2>
                  {cr.problems.map((pr, k) => {
                    // 没有对应项的问题（整张申请的）只留在这里；有序号但找不到显示行时写明，不猜一个对象
                    const at = pr.item_index
                    const located = at != null && locateItem(cr, groups, at) !== null
                    const label = at != null ? (cr.item_summaries?.[at] ?? cr.item_labels[at]) : undefined
                    return (
                      <ProblemCard
                        key={k}
                        problem={pr}
                        title={
                          at == null
                            ? '整张申请'
                            : `第 ${at + 1} 项 · ${label ?? '（未找到这一项）'}${located ? '' : '（无法定位到下方的行）'}`
                        }
                        onJump={located ? () => jumpTo(at!) : undefined}
                      />
                    )
                  })}
                </section>
              )}

              {p.can_edit ? (
                <Section
                  title={
                    <>
                      变更说明
                      <span className="text-fg-secondary text-caption font-normal">选填；提交后确认人会在页面上方看到</span>
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
                        <span className="text-fg-secondary font-normal">
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

              {cr.items.length === 0 && <p className="text-fg-secondary text-xs">没有变更项</p>}
              {groups.map((g, k) => (
                <ReviewGroupSection
                  key={g.key}
                  cr={cr}
                  group={g}
                  number={k + 1}
                  checkable={checkable}
                  checked={checks.checked.has(g.key)}
                  onCheck={() => checks.toggle(g.key)}
                  limit={limitOf(g.key)}
                  onShowAll={() => setView((v) => ({ ...v, limits: { ...v.limits, [g.key]: g.indices.length } }))}
                  focus={view.focus}
                  onFocused={clearFocus}
                  renderDiff={(o) => <OutcomeDiff outcome={o} />}
                />
              ))}
              <ReorgExtras cr={cr} number={groups.length + 1} />

              {primary && (
                <div className="border-line-subtle flex flex-wrap items-center gap-4 border-t pt-6">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="text-fg-strong text-sm font-semibold">
                      {checks.all || !checkable ? '看完了？' : `还有 ${checks.total - checks.done} 组没核对`}
                    </div>
                    <div className="text-fg-secondary text-xs">
                      {cr.status === 'draft'
                        ? '提交后不能再改；确认人确认时会按当天的数据再预演一次。'
                        : '确认后整张申请在一个事务里正式登记，不能撤回；每一项按它自己的业务日期适用，未来日期的变化到那天才生效。'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      document.querySelector('main')?.scrollTo({ top: 0, behavior: scrollBehavior() })
                      document.getElementById('change-primary-action')?.focus({ preventScroll: true })
                    }}
                  >
                    回到页头操作
                  </Button>
                </div>
              )}
            </div>
            <ReviewNav cr={cr} groups={groups} checks={checks} checkable={checkable} />
          </div>
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
    </>
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
      draft={{ id: cr.id, note: cr.note ?? null, items: cr.items, updated_at: cr.updated_at }}
    />
  )
}

/** 申请的三步：起草 → 提交 → 确认生效；节点名称后括号里是操作人，第二行是时间或提示。退回、撤销停在发生的那一步 */
function progress(cr: ChangeRequestOut, groupCount: number): StepItem[] {
  // 详情页写精确时间（YYYY-MM-DD HH:mm，统一规范 R-DAT 8.1；列表上才用相对说法）
  const at = (t?: string | null) => (t ? <time dateTime={t}>{stamp(t)}</time> : undefined)
  const name = (u?: { display_name: string } | null) => u?.display_name
  const draft: StepItem = { label: '起草', state: 'done', who: name(cr.created_by), detail: at(cr.created_at) }
  let submit: StepItem
  let confirm: StepItem
  if (cr.status === 'draft') {
    submit = { label: '提交', state: 'current', detail: groupCount > 1 ? `看完下面 ${groupCount} 组后提交` : '核对后提交' }
    confirm = { label: '确认', state: 'upcoming', detail: '由确认人确认' }
  } else if (cr.status === 'cancelled' && !cr.submitted_at) {
    submit = { label: '已撤销', state: 'stopped', who: name(cr.cancelled_by), detail: <>未提交即撤销 · {at(cr.cancelled_at)}</> }
    confirm = { label: '确认', state: 'skipped' }
  } else {
    submit = { label: '提交', state: 'done', who: name(cr.submitted_by), detail: at(cr.submitted_at) }
    confirm =
      cr.status === 'confirmed'
        ? { label: '确认', state: 'done', who: name(cr.confirmed_by), detail: at(cr.confirmed_at) }
        : cr.status === 'returned'
          ? { label: '已退回', state: 'stopped', who: name(cr.returned_by), detail: <>{at(cr.returned_at)} · 原因：{cr.return_reason}</> }
          : cr.status === 'cancelled'
            ? { label: '已撤销', state: 'stopped', who: name(cr.cancelled_by), detail: at(cr.cancelled_at) }
            : { label: '确认', state: 'current', detail: cr.permissions.confirm_hint ?? (groupCount > 1 ? `看完下面 ${groupCount} 组后确认` : '等待确认人确认') }
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
          原第 {String(before.version_no)} 版期间变为 {String(before.valid_from)} 至 {dayBefore(String(after.valid_from))}；
          新第 {String(after.version_no)} 版自 {String(after.valid_from)} 起{after.valid_to ? `至 ${after.valid_to}` : '长期有效'}。
        </p>
      )}
      {versioned && !before && <p className="text-xs">新建，自 {String(after.valid_from)} 起生效。</p>}
      <DbTable
        variant="compare"
        columns={[{ label: '字段', className: 'w-36' }, ...(before ? [{ label: '变更前' }] : []), { label: before ? '变更后' : '内容' }]}
      >
        {rows.map((k) => {
          const changed = before && before[k] !== after[k]
          return (
            <DbRow key={k} className={cn(changed && 'bg-surface-subtle font-medium')}>
              <DbCell className="text-fg-secondary whitespace-nowrap">{FIELD_LABELS[k]}</DbCell>
              {before && <DbCell className="text-fg-secondary">{formatValue(k, before[k], optionLabels)}</DbCell>}
              <DbCell>{formatValue(k, after[k], optionLabels)}</DbCell>
            </DbRow>
          )
        })}
      </DbTable>
      {before && keys.length > changedKeys.length && (
        <span>
          <InlineAction className="-ml-2" onClick={() => setShowAll(!showAll)}>
            {showAll ? '只看改动的字段' : `显示全部 ${keys.length} 个字段`}
          </InlineAction>
        </span>
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
            退回申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


