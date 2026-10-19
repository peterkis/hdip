// 变更申请的核对视图（方案 A 为框架，融合方案 B 的逐组核对）：
// 先用一段“这张申请做什么”给结论，再按业务把变更项分组，每组一句规则说明、可逐组“我已核对”；
// 右侧电梯导航列出各组、问题标记与核对进度，全部核对后才能提交 / 确认。
// 分组按变更项的类型推出，对任何申请都适用；组织变更另有“随原部门自动结束”“需其他系统办理”两组说明。
import { ArrowDown01Icon, ArrowRight01Icon, CheckmarkCircle02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useState, type ReactNode } from 'react'
import type { ChangeRequestOut, ItemOutcome, ProblemItem } from '@/api/generated/model'
import { Icon } from '@/components/kit/icon'
import { Tag } from '@/components/kit/tag'
import { ProblemCard } from '@/components/problem-card'
import { stamp } from '@/lib/format'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ 分组
interface GroupDef {
  key: string
  title: string
  /** 一句话规则：这一组的变更遵循什么，帮助读者判断“对不对” */
  rule: string
  match: (kind: string) => boolean
}

const GROUP_DEFS: GroupDef[] = [
  {
    key: 'org',
    title: '组织结构',
    rule: '谁退出、谁新设、属性怎么变',
    match: (k) =>
      ['department.create', 'department.reorganize', 'department.revise', 'department.change_lifecycle', 'department.affiliate', 'department.alias_add', 'department.alias_close', 'department.rename', 'department.change_status'].includes(k),
  },
  {
    key: 'units',
    title: '服务单元',
    rule: '单元身份不变；换部门、换院区或退出，都从生效日起',
    match: (k) => k.startsWith('service_unit.') && !k.includes('classif'),
  },
  {
    key: 'hierarchy',
    title: '隶属与管理关系',
    rule: '上级变了，下级不跟着退出；管理关系各自独立',
    match: (k) => ['department.set_parent', 'department.relation_create', 'department.relation_close'].includes(k),
  },
  {
    key: 'classes',
    title: '分类',
    rule: '分类只作用在被赋值的对象上，不下发给下级或单元',
    match: (k) => k.includes('classif'),
  },
  {
    key: 'codes',
    title: '外部编码',
    rule: '历史解释仍指向原对象；结束后不改指向，之后待裁决',
    match: (k) => k.startsWith('external_code.'),
  },
  {
    key: 'base',
    title: '主体、院区与运营关系',
    rule: '院区不等于法人；同一主体与同一院区同一时期只有一条关系',
    match: (k) => k.startsWith('institution.') || k.startsWith('campus.') || k.startsWith('operator_relation.'),
  },
]

export interface ReviewGroup {
  key: string
  title: string
  rule: string
  indices: number[]
}

export function groupItems(cr: ChangeRequestOut): ReviewGroup[] {
  const groups = GROUP_DEFS.map((g) => ({ key: g.key, title: g.title, rule: g.rule, indices: [] as number[] }))
  const other: ReviewGroup = { key: 'other', title: '其他', rule: '', indices: [] }
  cr.items.forEach((item, i) => {
    const def = GROUP_DEFS.findIndex((g) => g.match(item.kind))
    ;(def >= 0 ? groups[def] : other).indices.push(i)
  })
  return [...groups, other].filter((g) => g.indices.length > 0)
}

type ReorgAfter = { event_type: string; basis_note: string; other_matters: string | null; ended_links: string | null }

function reorgInfo(cr: ChangeRequestOut) {
  const index = cr.items.findIndex((i) => i.kind === 'department.reorganize')
  if (index < 0) return null
  const item = cr.items[index] as { basis_note?: string; other_matters?: string | null }
  const after = cr.outcomes?.find((o) => o.index === index)?.after as ReorgAfter | undefined
  return {
    index,
    basis: after?.basis_note ?? item.basis_note ?? '',
    otherMatters: after?.other_matters ?? item.other_matters ?? null,
    ended: (after?.ended_links ?? '')
      .split('；')
      .map((x) => x.replace(/^\S+：/, ''))
      .flatMap((x) => x.split('、'))
      .filter(Boolean),
  }
}

// ------------------------------------------------------------------ 逐组核对（只记在本浏览器）
/** 核对状态是本人的阅读进度，记在 sessionStorage（随申请内容的更新时间失效）；读写失败时只在内存里记 */
export function useReviewChecks(storeKey: string | null, groups: ReviewGroup[]) {
  const key = storeKey ? `hdip-review-${storeKey}` : null
  const read = (k: string | null): Set<string> => {
    if (!k) return new Set()
    try {
      return new Set(JSON.parse(sessionStorage.getItem(k) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  }
  const [state, setState] = useState<{ key: string | null; checked: Set<string> }>(() => ({ key, checked: read(key) }))
  // 申请加载完成或内容更新（更新时间变了）时，按新的键重新读取
  if (state.key !== key) setState({ key, checked: read(key) })
  const checked = state.key === key ? state.checked : read(key)
  const toggle = (g: string) => {
    const next = new Set(checked)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    try {
      if (key) sessionStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* 无痕模式等：只在内存里记 */
    }
    setState({ key, checked: next })
  }
  const done = groups.filter((g) => checked.has(g.key)).length
  return { checked, toggle, done, total: groups.length, all: done === groups.length }
}

// ------------------------------------------------------------------ 概览：这张申请做什么
export function ReviewOverview({ cr, groups }: { cr: ChangeRequestOut; groups: ReviewGroup[] }) {
  const reorg = reorgInfo(cr)
  const headline =
    reorg !== null
      ? cr.item_summaries?.[reorg.index]
      : cr.items.length === 1
        ? cr.item_summaries?.[0]
        : `共 ${cr.items.length} 项变更：${groups.map((g) => `${g.title} ${g.indices.length}`).join('、')}`
  const tiles = [
    ...groups.map((g) => ({ n: g.indices.length, label: g.title })),
    ...(reorg?.ended.length ? [{ n: reorg.ended.length, label: '自动结束，无需操作' }] : []),
  ].slice(0, 4)
  return (
    <section id="review-overview" aria-labelledby="review-overview-h" className="border-line-subtle grid scroll-mt-6 gap-4 rounded-xl border p-5 sm:p-6">
      <h2 id="review-overview-h" className="text-fg-muted text-xs font-medium">
        这张申请做什么
      </h2>
      <p className="text-fg-strong text-lg leading-relaxed font-semibold break-words">{headline}</p>
      {(reorg?.basis || cr.note) && (
        <p className="text-fg-secondary text-xs">
          {reorg?.basis && <>依据：{reorg.basis}。</>}
          {!reorg && cr.note}
        </p>
      )}
      {tiles.length > 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="bg-surface-sidebar rounded-lg px-3.5 py-3">
              <div className="text-fg-strong text-lg font-bold tabular-nums">{t.n}</div>
              <div className="text-fg-muted text-caption">{t.label}</div>
            </div>
          ))}
        </div>
      )}
      {cr.status === 'confirmed' ? (
        <StatusLine tone="success">已于 {stamp(cr.confirmed_at)} 确认生效，下面是确认时记录的前后内容。</StatusLine>
      ) : cr.problems.length === 0 && (cr.status === 'draft' || cr.status === 'submitted') ? (
        <StatusLine tone="success">预演通过：{cr.items.length} 项都能按当前数据生效。</StatusLine>
      ) : null}
    </section>
  )
}

function StatusLine({ tone, children }: { tone: 'success'; children: ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-xs', tone === 'success' && 'bg-success-soft text-success-text')}>
      <Icon icon={CheckmarkCircle02Icon} className="size-4 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </div>
  )
}

// ------------------------------------------------------------------ 一组
const PAGE = 50

export function ReviewGroupSection({
  cr,
  group,
  number,
  checkable,
  checked,
  onCheck,
  renderDiff,
  describe,
}: {
  cr: ChangeRequestOut
  group: ReviewGroup
  number: number
  checkable: boolean
  checked: boolean
  onCheck: () => void
  /** 某一项的前后对照（由页面提供，含拆分合并图、组织变更图、字段对照表） */
  renderDiff: (outcome: ItemOutcome) => ReactNode
  /** 变更项的代码摘要（弱化显示） */
  describe: (index: number) => string
}) {
  const [limit, setLimit] = useState(PAGE)
  const problems = group.indices.filter((i) => cr.problems.some((p) => p.item_index === i)).length
  return (
    <section id={`review-${group.key}`} aria-labelledby={`review-${group.key}-h`} className="grid scroll-mt-6 gap-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span
          className={cn(
            'flex size-5.5 items-center justify-center rounded-full text-caption font-semibold',
            checked ? 'bg-success-text text-surface-raised' : 'bg-fg-strong text-surface-raised',
          )}
        >
          {checked ? <Icon icon={Tick02Icon} className="size-3" strokeWidth={2.5} /> : number}
        </span>
        <h2 id={`review-${group.key}-h`} className="text-fg-strong text-base font-semibold">
          {group.title}
          <span className="text-fg-muted ml-1.5 text-xs font-normal tabular-nums">{group.indices.length}</span>
        </h2>
        {group.rule && <span className="text-fg-muted text-xs">{group.rule}</span>}
        {problems > 0 && <Tag tone="red">{problems} 个问题</Tag>}
        {checkable && (
          <button
            type="button"
            onClick={onCheck}
            aria-pressed={checked}
            className={cn(
              'ml-auto inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs transition-colors',
              checked ? 'border-success-text/30 bg-success-soft text-success-text' : 'border-line text-fg hover:bg-surface-hover',
            )}
          >
            <span
              className={cn(
                'flex size-3.5 items-center justify-center rounded-sm border',
                checked ? 'border-success-text bg-success-text text-surface-raised' : 'border-fg-muted',
              )}
            >
              {checked && <Icon icon={Tick02Icon} className="size-2.5" strokeWidth={3} />}
            </span>
            我已核对
          </button>
        )}
      </div>
      <div className={cn('grid', checked && 'opacity-80')}>
        {group.indices.slice(0, limit).map((i) => (
          <ReviewItem
            key={i}
            index={i}
            summary={cr.item_summaries?.[i] || cr.item_labels[i]}
            label={cr.item_labels[i]}
            code={describe(i)}
            outcome={cr.outcomes?.find((o) => o.index === i)}
            problem={cr.problems.find((p) => p.item_index === i)}
            renderDiff={renderDiff}
          />
        ))}
        {group.indices.length > limit && (
          <button type="button" onClick={() => setLimit(group.indices.length)} className="text-fg-secondary hover:text-fg justify-self-start px-3 py-2 text-xs hover:underline">
            显示这一组的全部 {group.indices.length} 项
          </button>
        )}
      </div>
    </section>
  )
}

function ReviewItem({
  index,
  summary,
  label,
  code,
  outcome,
  problem,
  renderDiff,
}: {
  index: number
  summary: string
  label: string
  code: string
  outcome?: ItemOutcome
  problem?: ProblemItem
  renderDiff: (outcome: ItemOutcome) => ReactNode
}) {
  // 前后对照默认收起：先读一句话，需要时再展开；组织变更这类整体变更默认展开图示
  const [open, setOpen] = useState(!!outcome && outcome.kind === 'department.reorganize')
  return (
    <div id={`item-${index}`} className={cn('hover:bg-surface-sidebar grid scroll-mt-6 gap-2 rounded-lg px-3 py-2.5', problem && 'bg-danger-soft/40')}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-fg-disabled w-5 shrink-0 text-caption tabular-nums">{index + 1}</span>
        <span className="text-fg-strong min-w-0 flex-1 text-sm break-words">{summary}</span>
        <span className="text-fg-disabled hidden font-mono text-caption sm:inline">{label}</span>
        {outcome && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-fg-muted hover:text-fg inline-flex items-center gap-0.5 text-caption">
            前后对照
            <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} className="size-3" strokeWidth={2} />
          </button>
        )}
      </div>
      <p className="text-fg-disabled pl-7.5 font-mono text-caption break-all">{code}</p>
      {problem && (
        <div className="pl-7.5">
          <ProblemCard problem={problem} compact />
        </div>
      )}
      {open && outcome && <div className="pl-7.5">{renderDiff(outcome)}</div>}
    </div>
  )
}

/** 组织变更的两组补充说明：随原部门自动结束（无需操作）、需其他系统办理 */
export function ReorgExtras({ cr }: { cr: ChangeRequestOut }) {
  const reorg = reorgInfo(cr)
  if (!reorg) return null
  return (
    <>
      {reorg.ended.length > 0 && (
        <section id="review-auto" aria-labelledby="review-auto-h" className="grid scroll-mt-6 gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="bg-surface-subtle text-fg-secondary flex size-5.5 items-center justify-center rounded-full text-caption">·</span>
            <h2 id="review-auto-h" className="text-fg-strong text-base font-semibold">
              随原部门自动结束
            </h2>
            <span className="text-fg-muted text-xs">无需操作，止于生效日前一天，历史保留</span>
          </div>
          <div className="flex flex-wrap gap-2 px-3">
            {reorg.ended.map((e) => (
              <Tag key={e} tone="gray">
                {e}
              </Tag>
            ))}
          </div>
        </section>
      )}
      {reorg.otherMatters && (
        <section id="review-other" aria-labelledby="review-other-h" className="grid scroll-mt-6 gap-1">
          <h2 id="review-other-h" className="text-fg-muted text-xs font-medium">
            需其他系统办理（本平台只登记）
          </h2>
          <p className="text-fg-secondary text-sm">{reorg.otherMatters}</p>
        </section>
      )}
    </>
  )
}

// ------------------------------------------------------------------ 电梯导航 + 核对进度
export function ReviewNav({
  cr,
  groups,
  checks,
  checkable,
}: {
  cr: ChangeRequestOut
  groups: ReviewGroup[]
  checks: { checked: Set<string>; done: number; total: number; all: boolean }
  checkable: boolean
}) {
  const reorg = reorgInfo(cr)
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const pct = checks.total ? Math.round((checks.done / checks.total) * 100) : 0
  return (
    <aside aria-label="本页目录与核对进度" className="order-first grid gap-3 lg:sticky lg:top-6 lg:order-none">
      {checkable && (
        <div className="grid gap-2 px-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-strong text-sm font-semibold tabular-nums">
              已核对 {checks.done} / {checks.total} 组
            </span>
            <span className="text-fg-muted text-caption">{checks.all ? '可以继续了' : `还差 ${checks.total - checks.done} 组`}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={checks.total} aria-valuenow={checks.done} className="bg-surface-subtle h-1.5 overflow-hidden rounded-full">
            <div className="bg-success-text h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <nav className="border-line-subtle grid gap-0.5 border-l pl-1.5">
        <NavLink onClick={() => jump('review-overview')}>概览</NavLink>
        {groups.map((g) => {
          const problems = g.indices.filter((i) => cr.problems.some((p) => p.item_index === i)).length
          const done = checks.checked.has(g.key)
          return (
            <NavLink key={g.key} onClick={() => jump(`review-${g.key}`)}>
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', problems ? 'bg-danger' : done ? 'bg-success-text' : 'bg-line-strong')}
              />
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span className="text-fg-disabled tabular-nums">{g.indices.length}</span>
            </NavLink>
          )
        })}
        {reorg?.ended.length ? <NavLink onClick={() => jump('review-auto')}>自动结束</NavLink> : null}
        {reorg?.otherMatters ? <NavLink onClick={() => jump('review-other')}>其他系统</NavLink> : null}
      </nav>
      <p className="bg-surface-sidebar text-fg-secondary rounded-lg px-3 py-2.5 text-caption">
        共 {cr.items.length} 项变更
        {cr.problems.length ? <span className="text-danger-text"> · {cr.problems.length} 个问题</span> : cr.status !== 'confirmed' ? ' · 预演通过' : ''}
        <br />
        绿点 = 已核对，红点 = 有问题
      </p>
    </aside>
  )
}

function NavLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-fg-secondary hover:bg-surface-hover hover:text-fg flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs">
      {children}
    </button>
  )
}
