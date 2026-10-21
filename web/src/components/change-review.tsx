// 变更申请的核对视图（方案 A 为框架，融合方案 B 的逐组核对）：
// 按业务把变更项分组（版式按原型 A），每组一句规则说明、可逐组“我已核对”；每行是名称标签与状态标签；
// 右侧电梯导航列出各组、问题标记与核对进度，全部核对后才能提交 / 确认。
// 分组按变更项的类型推出，对任何申请都适用；组织变更另有“随原部门自动结束”“需其他系统办理”两组说明。
import { ArrowDown01Icon, ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useState, type ReactNode } from 'react'
import type { ChangeRequestOut, ItemOutcome } from '@/api/generated/model'
import { Icon } from '@/components/kit/icon'
import { Tag, type Tone } from '@/components/kit/tag'
import { ProblemCard } from '@/components/problem-card'
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
    key: 'persons',
    title: '人员',
    rule: '人员身份不变；任用、归属按期间生效，调科的两端同一天一起成立',
    match: (k) => k.startsWith('person.'),
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

// 组织变更申请里，各组用更贴近业务的叫法（与原型一致）
const REORG_TEXT: Record<string, { title?: string; rule: string }> = {
  org: { rule: '谁退出、谁新设' },
  units: { title: '服务单元去向', rule: '单元身份不变，只换所属部门' },
  hierarchy: { title: '下级部门', rule: '上级退出，下级不跟着退出' },
  codes: { rule: '历史仍指向原部门，不改指向' },
  persons: { title: '人员去向', rule: '人员身份不变，只换归属部门；不按单元或名称自动迁人' },
}

export function groupItems(cr: ChangeRequestOut): ReviewGroup[] {
  const isReorg = cr.items.some((i) => i.kind === 'department.reorganize')
  const groups = GROUP_DEFS.map((g) => ({
    key: g.key,
    title: (isReorg && REORG_TEXT[g.key]?.title) || g.title,
    rule: (isReorg && REORG_TEXT[g.key]?.rule) || g.rule,
    indices: [] as number[],
  }))
  const other: ReviewGroup = { key: 'other', title: '其他', rule: '', indices: [] }
  cr.items.forEach((item, i) => {
    // 并进另一行显示的项（新设部门的主分类、隶属）不单独成行
    if (cr.item_views?.[i]?.covered_by != null) return
    const def = GROUP_DEFS.findIndex((g) => g.match(item.kind))
    ;(def >= 0 ? groups[def] : other).indices.push(i)
  })
  // 组织结构里先说谁退出（组织变更事件），再说谁新设
  const org = groups.find((g) => g.key === 'org')
  if (org) org.indices.sort((a, b) => Number(cr.items[b].kind === 'department.reorganize') - Number(cr.items[a].kind === 'department.reorganize'))
  return [...groups, other].filter((g) => g.indices.length > 0)
}

/** 某一行连同并进来的项（如新设部门的主分类）的序号 */
function rowIndices(cr: ChangeRequestOut, index: number): number[] {
  return [index, ...(cr.item_views ?? []).flatMap((v, i) => (v.covered_by === index ? [i] : []))]
}

type ReorgAfter = { event_type: string; basis_note: string; other_matters: string | null; ended_links: string | null; ended_items?: string[] }

function reorgInfo(cr: ChangeRequestOut) {
  const index = cr.items.findIndex((i) => i.kind === 'department.reorganize')
  if (index < 0) return null
  const item = cr.items[index] as { basis_note?: string; other_matters?: string | null }
  const after = cr.outcomes?.find((o) => o.index === index)?.after as ReorgAfter | undefined
  return {
    index,
    basis: after?.basis_note ?? item.basis_note ?? '',
    otherMatters: after?.other_matters ?? item.other_matters ?? null,
    // 新申请有逐条明细（ended_items）；旧申请只有汇总文字，退回到按“、”拆分
    ended: after?.ended_items ?? (after?.ended_links ?? '')
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

// ------------------------------------------------------------------ 一组（样式按原型 A：黑色序号圆、17px 级标题、一句规则；行内是名称标签与状态标签）
const PAGE = 50

const TAG_TONE: Record<string, Tone> = { green: 'green', brown: 'brown', yellow: 'yellow', blue: 'blue', gray: 'gray', red: 'red' }

function GroupHeader({ number, title, rule, muted, children }: { number: number; title: string; rule?: string; muted?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span
        className={cn(
          'flex size-5.5 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
          muted ? 'bg-surface-subtle text-fg-secondary' : 'bg-fg-strong text-surface-raised',
        )}
      >
        {number}
      </span>
      <h2 className="text-fg-strong text-sm font-semibold">{title}</h2>
      {rule && <span className="text-fg-muted text-caption">{rule}</span>}
      {children}
    </div>
  )
}

export function ReviewGroupSection({
  cr,
  group,
  number,
  checkable,
  checked,
  onCheck,
  renderDiff,
}: {
  cr: ChangeRequestOut
  group: ReviewGroup
  number: number
  checkable: boolean
  checked: boolean
  onCheck: () => void
  /** 某一项的前后对照（由页面提供，含拆分合并图、组织变更图、字段对照表） */
  renderDiff: (outcome: ItemOutcome) => ReactNode
}) {
  const [limit, setLimit] = useState(PAGE)
  const problems = group.indices.flatMap((i) => rowIndices(cr, i)).filter((i) => cr.problems.some((p) => p.item_index === i)).length
  return (
    <section id={`review-${group.key}`} aria-labelledby={`review-${group.key}-h`} className="grid scroll-mt-6 gap-2">
      <GroupHeader number={number} title={group.title} rule={group.rule}>
        {problems > 0 && <Tag tone="red">{problems} 个问题</Tag>}
        {checkable && (
          <button
            type="button"
            onClick={onCheck}
            aria-pressed={checked}
            className={cn(
              'ml-auto inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-caption transition-colors',
              checked ? 'border-success-text/30 bg-success-soft text-success-text' : 'border-line text-fg-secondary hover:bg-surface-hover',
            )}
          >
            <span className={cn('flex size-3.5 items-center justify-center rounded-sm border', checked ? 'border-success-text bg-success-text text-surface-raised' : 'border-fg-muted')}>
              {checked && <Icon icon={Tick02Icon} className="size-2.5" strokeWidth={3} />}
            </span>
            我已核对
          </button>
        )}
      </GroupHeader>
      <div className="grid">
        {group.indices.slice(0, limit).map((i) => (
          <ReviewRow key={i} cr={cr} index={i} renderDiff={renderDiff} />
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

function ReviewRow({ cr, index, renderDiff }: { cr: ChangeRequestOut; index: number; renderDiff: (outcome: ItemOutcome) => ReactNode }) {
  const view = cr.item_views?.[index]
  const all = rowIndices(cr, index)
  const problems = all.flatMap((i) => cr.problems.filter((p) => p.item_index === i))
  const outcomes = all.flatMap((i) => cr.outcomes?.filter((o) => o.index === i) ?? [])
  const [open, setOpen] = useState(false)
  return (
    <div id={`item-${index}`} className="grid scroll-mt-6 gap-2">
      <div className={cn('hover:bg-surface-sidebar flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg px-3 py-2.5 text-xs', problems.length > 0 && 'bg-danger-soft/50')}>
        {view ? view.parts.map((part, k) => <RowPart key={k} kind={part.kind} text={part.text} tone={part.tone ?? undefined} />) : <span className="text-fg">{cr.item_summaries?.[index]}</span>}
        <span className="ml-auto flex items-center gap-3">
          {view?.meta && <span className="text-fg-disabled font-mono text-caption">{view.meta}</span>}
          {outcomes.length > 0 && (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-fg-disabled hover:text-fg inline-flex items-center gap-0.5 text-caption">
              详情
              <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} className="size-3" strokeWidth={2} />
            </button>
          )}
        </span>
      </div>
      {problems.map((p, k) => (
        <div key={k} className="px-3">
          <ProblemCard problem={p} compact />
        </div>
      ))}
      {/* 提示：不阻止提交与确认（同名人员、部门筹备 / 暂停履职、暂未分配主部门…） */}
      {outcomes.flatMap((o) => o.notices ?? []).map((n, k) => (
        <p key={`n${k}`} className="text-warning-text px-3 text-caption">
          提示：{n}
        </p>
      ))}
      {open && <div className="grid gap-3 px-3 pb-2">{outcomes.map((o) => <div key={o.index}>{renderDiff(o)}</div>)}</div>}
    </div>
  )
}

/**
 * 行内片段，按“主语 → 谓语 → 宾语”分层（2026-10-21 Peter：名称和动作同色时分不清主次）：
 * - 主语（本项的对象，chip / new）：粗体正文色，不加底色；新设与否由后面的动作标签说明
 * - 退出的对象（out）：弱化色 + 删除线
 * - 谓语（动作、去向、状态，tag）：唯一着色的实底标签
 * - 宾语（关联对象，如隶属的上级部门，ref）：细边框、无底色
 */
function RowPart({ kind, text, tone }: { kind: string; text: string; tone?: string }) {
  switch (kind) {
    case 'chip':
    case 'new':
      return <span className="text-fg-strong text-sm font-semibold whitespace-nowrap">{text}</span>
    case 'ref':
      return <span className="border-line text-fg rounded-md border px-1.5 py-px text-xs whitespace-nowrap">{text}</span>
    case 'out':
      return <span className="text-fg-muted decoration-fg-disabled text-sm font-semibold whitespace-nowrap line-through">{text}</span>
    case 'tag':
      return (
        <Tag tone={TAG_TONE[tone ?? 'gray'] ?? 'gray'} className="text-caption">
          {text}
        </Tag>
      )
    case 'arrow':
      return <span className="text-fg-disabled">→</span>
    default:
      return <span className="text-fg-secondary">{text}</span>
  }
}

/** 组织变更的补充：随原部门自动结束（无需操作，灰色序号）、需其他系统办理 */
export function ReorgExtras({ cr, number }: { cr: ChangeRequestOut; number: number }) {
  const reorg = reorgInfo(cr)
  if (!reorg) return null
  const ev = cr.items[reorg.index] as { effective_date?: string }
  const last = ev.effective_date ? dayBefore(ev.effective_date) : ''
  return (
    <>
      {reorg.ended.length > 0 && (
        <section id="review-auto" aria-label="随原部门自动结束" className="grid scroll-mt-6 gap-2">
          <GroupHeader number={number} title="随原部门自动结束" rule={`无需操作，止于 ${last}，历史保留`} muted />
          <div className="flex flex-wrap gap-2 px-3">
            {reorg.ended.map((e) => (
              <span key={e} className="bg-surface-subtle text-fg-secondary rounded-md px-2 py-px text-xs">
                {e}
              </span>
            ))}
          </div>
        </section>
      )}
      {reorg.otherMatters && (
        <section id="review-other" aria-labelledby="review-other-h" className="grid scroll-mt-6 gap-1.5">
          <h2 id="review-other-h" className="text-fg-muted text-caption font-medium">
            需其他系统办理（本平台只登记）
          </h2>
          <p className="text-fg-secondary text-xs">{reorg.otherMatters}</p>
        </section>
      )}
    </>
  )
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
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
