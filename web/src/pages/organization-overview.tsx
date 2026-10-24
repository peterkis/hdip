// 组织总览（剧本 21）：全院组织与服务布局。只读，不改主数据。
// 三张图共用一批查询：服务布局桑基图（按分类 / 按院区）、部门 × 院区矩阵、编码治理图。
// 查看日期、视图与筛选都写在地址栏，复制链接即可恢复同一视角。口径见页面底部注释与设计文档剧本 21。
import {
  Building03Icon,
  Hospital01Icon,
  Link04Icon,
  ListViewIcon,
  Tag01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  useListCampuses,
  useListDepartments,
  useListInstitutions,
  useListServiceUnits,
  useListSourceSystems,
} from '@/api/generated/master/master'
import type { DepartmentRow, ServiceUnitRow, SourceSystemOut } from '@/api/generated/model'
import { DeptCampusMatrix } from '@/components/dept-campus-matrix'
import { FlowSankey } from '@/components/flow-sankey'
import { Callout } from '@/components/kit/callout'
import { DbToolbar, FilterPill, ToggleChip } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApp } from '@/lib/app-context'
import { isDate } from '@/components/kit/date-input'
import { UNIT_STATUS, type UnitStatus } from '@/lib/format'
import {
  BREAKDOWN,
  campusFlow,
  classFlow,
  governanceFlow,
  indexDepartments,
  LEDGER_STATUS,
  linkKey,
  matrixRows,
  NO_CLASS,
  summarize,
  unitsInScope,
  type BreakdownKey,
  type Flow,
  type Scope,
} from '@/lib/org-overview'
import { UNIT_STATUS_TONE, PLANNED_TONE } from '@/lib/tones'
import { cn } from '@/lib/utils'

type TabKey = 'layout' | 'matrix' | 'codes'
type Lens = 'class' | 'campus'

const SCOPE_KEYS = ['inst', 'campus', 'cls', 'type', 'dept', 'planned', 'suspended'] as const

/** 地址栏状态：tab、lens、筛选与查看日期（date）。查看日期与全局的“查看日期”双向同步。 */
function useOverviewParams() {
  const { asOf, setAsOf } = useApp()
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
  const set = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  // 打开链接时先采用地址栏里的日期（等全局查看日期换过来再写回地址栏），之后查看日期变了就写回地址栏
  const urlDate = params.get('date')
  const pending = useRef(urlDate && isDate(urlDate) && urlDate !== asOf ? urlDate : null)
  useEffect(() => {
    if (pending.current) setAsOf(pending.current)
  }, [setAsOf])
  useEffect(() => {
    if (pending.current) {
      if (asOf !== pending.current) return
      pending.current = null
    }
    if (params.get('date') !== asOf) set({ date: asOf })
  }, [asOf])

  const scope: Scope = {
    inst: get('inst'),
    campus: get('campus'),
    cls: get('cls'),
    type: get('type'),
    dept: get('dept'),
    planned: get('planned') === '1',
    suspended: get('suspended') === '1',
  }
  const tab = (['layout', 'matrix', 'codes'].includes(get('tab')) ? get('tab') : 'layout') as TabKey
  const lens = (get('lens') === 'campus' ? 'campus' : 'class') as Lens
  return {
    tab,
    lens,
    scope,
    set,
    filtered: SCOPE_KEYS.some((k) => params.has(k)),
    clear: () => set(Object.fromEntries(SCOPE_KEYS.map((k) => [k, '']))),
  }
}

/** 点选后在侧栏显示的内容 */
type Selection =
  | { key: string; title: string; note?: string; units: ServiceUnitRow[]; actions?: ReactNode }
  | { key: string; title: string; note?: string; depts: DepartmentRow[] }
  | { key: string; title: string; note?: string; codes: { label: string; count: number; to: string }[] }

export function OrganizationOverviewPage() {
  usePageFrame('canvas')
  const { asOf, unitTypeOptions } = useApp()
  const p = useOverviewParams()
  const [sel, setSel] = useState<Selection | null>(null)

  const { data: units = [], isPending } = useListServiceUnits({ as_of: asOf, include_future: true })
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf })
  const { data: systems = [] } = useListSourceSystems({ as_of: asOf })

  const idx = useMemo(() => indexDepartments(departments), [departments])
  const summary = useMemo(() => summarize(units, departments), [units, departments])
  const scoped = useMemo(() => unitsInScope(units, idx, p.scope), [units, idx, p.scope])
  const classNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of departments) if (d.main_class) m.set(d.main_class.code, d.main_class.name)
    m.set(NO_CLASS, '未分类')
    return m
  }, [departments])
  const sortedCampuses = useMemo(
    () => [...campuses].sort((a, b) => a.code.localeCompare(b.code)).filter((c) => !p.scope.campus || String(c.id) === p.scope.campus),
    [campuses, p.scope.campus],
  )
  const flow: Flow = useMemo(
    () => (p.lens === 'campus' ? campusFlow(scoped, idx, campuses) : classFlow(scoped, idx, classNames)),
    [p.lens, scoped, idx, campuses, classNames],
  )
  const rows = useMemo(() => matrixRows(scoped, idx), [scoped, idx])
  const gov = useMemo(() => governanceFlow(systems), [systems])
  const deptCount = useMemo(() => new Set(scoped.map((u) => u.version.department_id)).size, [scoped])

  // 筛选、日期、视图变了，旧的点选不再对应图上的东西
  const selReset = `${asOf}|${p.tab}|${p.lens}|${JSON.stringify(p.scope)}`
  const [lastReset, setLastReset] = useState(selReset)
  if (lastReset !== selReset) {
    setLastReset(selReset)
    setSel(null)
  }

  /** 服务单元列表的链接：带上当前的全部范围，列表与页内清单是同一批单元。
   *  点的是某个部门（院区视角的部门节点、矩阵格、院区 → 部门的带）时按该部门本身筛：
   *  它已在当前范围之内，比范围里的“部门（含下级）”“主分类”更窄；否则把范围里的部门（含下级）与主分类原样带上。
   *  含计划 / 含暂停按列表的筛选表达。 */
  const listLink = (extra: Record<string, string>) => {
    const q = new URLSearchParams()
    const s = p.scope
    if (s.inst) q.set('inst', s.inst)
    if (s.campus) q.set('campus', s.campus)
    if (s.type) q.set('type', s.type)
    if (!extra.dept) {
      if (s.dept) {
        q.set('dept', s.dept)
        q.set('sub', '1')
      }
      if (s.cls) q.set('cls', s.cls)
    }
    if (!s.planned) q.set('future', '0')
    if (!s.suspended) q.set('status', 'ACTIVE')
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    return `/service-units?${q}`
  }

  const selectLayout = (target: { node: string } | { source: string; target: string }) => {
    if ('node' in target) {
      const n = flow.nodes.find((x) => x.id === target.node)
      if (!n) return
      const [kind, id] = [n.id.slice(0, n.id.indexOf(':')), n.id.slice(n.id.indexOf(':') + 1)]
      const actions =
        kind === 'd' ? (
          <>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/departments/${id}`} />}>
              打开部门详情
            </Button>
            {p.lens === 'campus' && (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={listLink({ dept: id })} />}>
                在服务单元列表中查看
              </Button>
            )}
          </>
        ) : kind === 'c' ? (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to={listLink({ campus: id })} />}>
            在服务单元列表中查看
          </Button>
        ) : kind === 'u' ? (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/service-units/${id}`} />}>
            打开服务单元详情
          </Button>
        ) : undefined
      setSel({
        key: n.id,
        title: n.name,
        note: kind === 'd' && p.lens === 'class' ? '含其下级部门的单元' : n.column,
        units: flow.units.get(n.id) ?? [],
        actions,
      })
    } else {
      const key = linkKey(target.source, target.target)
      const [s, t] = [flow.nodes.find((x) => x.id === target.source), flow.nodes.find((x) => x.id === target.target)]
      const campusId = target.source.startsWith('c:') ? target.source.slice(2) : ''
      const deptId = target.target.startsWith('d:') ? target.target.slice(2) : ''
      setSel({
        key,
        title: `${s?.name ?? ''} → ${t?.name ?? ''}`,
        note: '这条带上的服务单元',
        units: flow.units.get(key) ?? [],
        actions:
          campusId && deptId ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link to={listLink({ campus: campusId, dept: deptId })} />}>
              在服务单元列表中查看
            </Button>
          ) : undefined,
      })
    }
  }

  const selectCodes = (target: { node: string } | { source: string; target: string }) => {
    const ledger = (ns?: string, status?: string) => {
      const q = new URLSearchParams()
      if (ns) q.set('ns', ns)
      if (status) q.set('status', status)
      return `/standards/code-mapping?${q}`
    }
    const nsOf = (id: string) => systems.flatMap((s) => s.namespaces).find((n) => `ns:${n.id}` === id)
    const sysOf = (id: string) => systems.find((s) => `sys:${s.id}` === id)
    const rowsFor = (namespaces: { id: number; breakdown?: Record<string, number> }[], only?: BreakdownKey) =>
      (Object.keys(BREAKDOWN) as BreakdownKey[])
        .filter((k) => !only || k === only)
        .map((k) => ({
          label: BREAKDOWN[k],
          count: namespaces.reduce((n, ns) => n + (ns.breakdown?.[k] ?? 0), 0),
          to: ledger(namespaces.length === 1 ? String(namespaces[0].id) : undefined, LEDGER_STATUS[k]),
        }))
        .filter((r) => r.count > 0)
    if ('node' in target) {
      const id = target.node
      if (id.startsWith('ns:')) {
        const ns = nsOf(id)
        if (ns) setSel({ key: id, title: ns.name, note: `共 ${ns.code_count} 条源记录`, codes: rowsFor([ns]) })
      } else if (id.startsWith('sys:')) {
        const sys = sysOf(id)
        if (sys) setSel({ key: id, title: sys.name, note: `${sys.namespaces.length} 本字典`, codes: rowsFor(sys.namespaces) })
      } else {
        const k = id.slice(3) as BreakdownKey
        setSel({ key: id, title: BREAKDOWN[k], note: '各字典合计', codes: rowsFor(systems.flatMap((s) => s.namespaces), k) })
      }
    } else if (target.source.startsWith('ns:')) {
      const ns = nsOf(target.source)
      const k = target.target.slice(3) as BreakdownKey
      if (ns) setSel({ key: linkKey(target.source, target.target), title: `${ns.name} → ${BREAKDOWN[k]}`, codes: rowsFor([ns], k) })
    } else {
      const ns = nsOf(target.target)
      if (ns) setSel({ key: target.target, title: ns.name, note: `共 ${ns.code_count} 条源记录`, codes: rowsFor([ns]) })
    }
  }

  return (
    <>
      <PageHeader
        title="全院组织与服务布局"
        description={`按查看日期 ${asOf} 的主数据生成。服务布局只计服务单元，行政上下级看部门层级树。`}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link to="/departments?view=tree" />}>
            <Icon icon={UserGroupIcon} inline="start" />
            部门层级树
          </Button>
        }
      />

      <SummaryStrip
        loading={isPending}
        items={[
          { label: '正式履职部门', value: summary.activeDepts },
          { label: '在用服务单元', value: summary.active },
          { label: '暂停', value: summary.suspended },
          { label: '计划中', value: summary.planned, hint: '查看日期之后才开始' },
          {
            label: '跨院区部门',
            value: summary.crossCampus.length,
            onClick: () => setSel({ key: 'cross', title: '跨院区部门', note: '当天在两个及以上院区有在运营单元（含暂停）', depts: summary.crossCampus }),
          },
          {
            label: '没有在运营单元的部门',
            value: summary.idle.length,
            onClick: () =>
              setSel({ key: 'idle', title: '没有在运营单元的部门', note: '正式履职、当天没有在运营的服务单元。行政、职能部门多半如此，不表示遗漏。', depts: summary.idle }),
          },
        ]}
      />

      <Tabs value={p.tab} onValueChange={(v) => p.set({ tab: v === 'layout' ? '' : String(v) })} className="mt-6">
        <TabsList variant="line">
          <TabsTrigger value="layout">服务布局</TabsTrigger>
          <TabsTrigger value="matrix">部门 × 院区</TabsTrigger>
          <TabsTrigger value="codes">编码治理</TabsTrigger>
        </TabsList>
      </Tabs>

      {p.tab !== 'codes' && (
        <div className="mt-3">
          <DbToolbar>
            <FilterPill
              label="运营主体"
              icon={Hospital01Icon}
              value={p.scope.inst}
              onChange={(v) => p.set({ inst: v })}
              options={institutions.map((i) => ({ value: String(i.id), label: i.version.name }))}
            />
            <FilterPill
              label="院区"
              icon={Building03Icon}
              value={p.scope.campus}
              onChange={(v) => p.set({ campus: v })}
              options={[...campuses].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ value: String(c.id), label: c.version.name }))}
            />
            <FilterPill
              label="主分类"
              icon={Tag01Icon}
              value={p.scope.cls}
              onChange={(v) => p.set({ cls: v })}
              options={[...classNames].map(([value, label]) => ({ value, label }))}
            />
            <FilterPill
              label="部门"
              icon={UserGroupIcon}
              value={p.scope.dept}
              onChange={(v) => p.set({ dept: v })}
              options={[...departments]
                .sort((a, b) => (idx.order.get(a.id) ?? 0) - (idx.order.get(b.id) ?? 0))
                .map((d) => ({ value: String(d.id), label: `${'　'.repeat(d.level - 1)}${d.version.name}` }))}
            />
            <FilterPill
              label="类型"
              icon={ListViewIcon}
              value={p.scope.type}
              onChange={(v) => p.set({ type: v })}
              options={unitTypeOptions.map((o) => ({ value: o.code, label: o.name }))}
            />
            <ToggleChip label="含计划中" checked={p.scope.planned} onChange={(v) => p.set({ planned: v ? '1' : '' })} />
            <ToggleChip label="含暂停" checked={p.scope.suspended} onChange={(v) => p.set({ suspended: v ? '1' : '' })} />
            {p.filtered && (
              <Button variant="ghost" size="sm" className="text-fg-muted" onClick={p.clear}>
                清除筛选
              </Button>
            )}
          </DbToolbar>
          <p className="text-fg-muted mt-2 text-caption">
            当前范围：<span className="text-fg-secondary">{scoped.length}</span> 个服务单元，分属{' '}
            <span className="text-fg-secondary">{deptCount}</span> 个部门
            {p.scope.dept && '（所选部门及其下级部门）'}
          </p>
        </div>
      )}

      {/* 统一规范 SC-10：没有点选时图占满宽度，不留一块空卡片；点选后面板在容器够宽时并列，否则在图下 */}
      {!sel && <p className="text-fg-secondary mt-4 text-caption">{SELECT_HINT[p.tab]}</p>}
      <div className="@container mt-4">
        <div className={cn('grid items-start gap-4', sel && '@5xl:grid-cols-(--hd-overview-columns)')}>
          <div className="min-w-0">
            {p.tab === 'layout' && (
              <LayoutView
                lens={p.lens}
                onLens={(v) => p.set({ lens: v === 'class' ? '' : v })}
                flow={flow}
                empty={!isPending && scoped.length === 0}
                onSelect={selectLayout}
                onMatrix={() => p.set({ tab: 'matrix' })}
              />
            )}
            {p.tab === 'matrix' &&
              (rows.length === 0 ? (
                !isPending && <EmptyScope />
              ) : (
                <>
                  <DeptCampusMatrix
                    rows={rows}
                    campuses={sortedCampuses}
                    selected={sel?.key}
                    onSelect={(r, c, list) =>
                      setSel({
                        key: `${r.dept.id}:${c.id}`,
                        title: `${r.dept.version.name} · ${c.version.name}`,
                        note: '本部门（不含下级部门）在该院区的单元',
                        units: list,
                        actions: (
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false} render={<Link to={listLink({ campus: String(c.id), dept: String(r.dept.id) })} />}
                          >
                            在服务单元列表中查看
                          </Button>
                        ),
                      })
                    }
                  />
                  <Footnote>
                    格子里是该部门本身（不含下级部门）在该院区登记的服务单元数与类型。“—”表示当前日期下未登记符合条件的单元，实际开展情况待核实，不等于院方确认不设。
                  </Footnote>
                </>
              ))}
            {p.tab === 'codes' && <CodesView gov={gov} systems={systems} onSelect={selectCodes} />}
          </div>
          <SelectionPanel sel={sel} onClose={() => setSel(null)} />
        </div>
      </div>
    </>
  )
}

const SELECT_HINT: Record<TabKey, string> = {
  layout: '点图上的节点或连带，查看背后的服务单元；概况里的“跨院区部门”等也可以点。',
  matrix: '点有数字的格子，查看该部门在该院区的服务单元。',
  codes: '点图上的系统、字典、状态或连带，查看数量并进入编码映射台账。',
}

// ------------------------------------------------------------------ 概况

function SummaryStrip({
  items,
  loading,
}: {
  items: { label: string; value: number; hint?: string; onClick?: () => void }[]
  loading: boolean
}) {
  return (
    <div className="border-line-subtle grid grid-cols-2 overflow-hidden rounded-md border sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => {
        const body = (
          <>
            <span className="text-fg-muted text-caption">{it.label}</span>
            <span className="text-fg-strong text-xl font-semibold tabular-nums">{loading ? '—' : it.value}</span>
          </>
        )
        const cls = 'border-line-subtle -mt-px -ml-px flex flex-col items-start gap-1 border-t border-l px-4 py-3 text-left'
        return it.onClick ? (
          <button key={it.label} type="button" className={cn(cls, 'hover:bg-surface-hover transition-colors duration-(--hd-duration-fast)')} onClick={it.onClick} title="点击查看名单">
            {body}
          </button>
        ) : (
          <div key={it.label} className={cls} title={it.hint}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ 服务布局

function LayoutView({
  lens,
  onLens,
  flow,
  empty,
  onSelect,
  onMatrix,
}: {
  lens: Lens
  onLens: (v: Lens) => void
  flow: Flow
  empty: boolean
  onSelect: (t: { node: string } | { source: string; target: string }) => void
  onMatrix: () => void
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-muted text-caption">视角</span>
        <ToggleChip label="按分类" checked={lens === 'class'} onChange={() => onLens('class')} />
        <ToggleChip label="按院区" checked={lens === 'campus'} onChange={() => onLens('campus')} />
        <span className="text-fg-muted text-caption">
          {lens === 'class' ? '主分类 → 部门 → 服务单元，单元挂在它所属的部门上' : '院区 → 单元所属的部门'}
        </span>
      </div>
      {empty ? (
        <EmptyScope />
      ) : (
        <>
          <div className="md:hidden">
            <Callout title="桑基图需要更宽的屏幕">
              在手机上请看“部门 × 院区”矩阵，内容与这张图一致。
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={onMatrix}>
                  看部门 × 院区
                </Button>
              </div>
            </Callout>
          </div>
          <div className="border-line-subtle bg-surface-page hidden rounded-md border p-2 md:block">
            <FlowSankey
              nodes={flow.nodes}
              links={flow.links}
              onSelect={onSelect}
              label={lens === 'class' ? '按主分类与部门的服务单元分布' : '按院区与部门的服务单元分布'}
              leftMargin={lens === 'class' ? 96 : 88}
              rightMargin={lens === 'class' ? 270 : 180}
            />
          </div>
        </>
      )}
      <Footnote>
        带宽按服务单元数计算，反映服务配置分布，不代表床位、人力或诊疗量。部门按单元所属的部门显示（二级部门的单元挂在二级部门上）；
        {lens === 'campus' ? '院区—部门的连线表示服务分布，不表示行政归属。' : '主分类取一级部门的部门管理主分类。'}
        图中只有存在符合条件单元的部门，没有出现的部门不等于遗漏。点节点或连带查看单元清单。
      </Footnote>
    </div>
  )
}

function EmptyScope() {
  return (
    <div className="border-line-subtle text-fg-muted rounded-md border px-4 py-10 text-center text-xs">
      当前日期与筛选条件下没有服务单元。换个筛选条件，或打开“含计划中”。
    </div>
  )
}

function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-fg-muted mt-2 text-caption">{children}</p>
}

// ------------------------------------------------------------------ 编码治理

function CodesView({
  gov,
  systems,
  onSelect,
}: {
  gov: ReturnType<typeof governanceFlow>
  systems: SourceSystemOut[]
  onSelect: (t: { node: string } | { source: string; target: string }) => void
}) {
  const keys = Object.keys(BREAKDOWN) as BreakdownKey[]
  const explained = gov.total - gov.counts.pending
  if (gov.total === 0)
    return (
      <div className="border-line-subtle text-fg-muted rounded-md border px-4 py-10 text-center text-xs">
        台账里还没有登记外部编码。
      </div>
    )
  return (
    <div className="grid gap-4">
      <p className="text-fg-secondary text-xs">
        已登记 <span className="text-fg-strong font-medium">{gov.total}</span> 条源记录，已解释{' '}
        <span className="text-fg-strong font-medium">{explained}</span> 条（
        {Math.round((explained / gov.total) * 100)}%），待裁决{' '}
        <span className="text-fg-strong font-medium">{gov.counts.pending}</span> 条。
      </p>
      <div className="border-line-subtle bg-surface-page hidden rounded-md border p-2 md:block">
        <FlowSankey nodes={gov.nodes} links={gov.links} onSelect={onSelect} label="来源系统、字典与编码解释状态" leftMargin={190} rightMargin={150} />
      </div>
      <div className="border-line-subtle overflow-x-auto rounded-md border">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-surface-subtle text-fg-muted">
              <th className="px-3 py-2 text-left font-normal">字典</th>
              <th className="border-line-subtle border-l px-3 py-2 text-right font-normal">源记录</th>
              {keys.map((k) => (
                <th key={k} className="border-line-subtle border-l px-3 py-2 text-right font-normal">
                  {BREAKDOWN[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {systems.flatMap((s) =>
              s.namespaces
                .filter((ns) => ns.code_count > 0)
                .map((ns) => (
                  <tr key={ns.id} className="border-line-subtle border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-fg-muted">{s.name} / </span>
                      <Link to={`/standards/code-mapping?ns=${ns.id}`} className="hover:underline">
                        {ns.name}
                      </Link>
                    </td>
                    <td className="border-line-subtle border-l px-3 py-2 text-right tabular-nums">{ns.code_count}</td>
                    {keys.map((k) => {
                      const n = ns.breakdown?.[k] ?? 0
                      return (
                        <td key={k} className="border-line-subtle border-l px-3 py-2 text-right tabular-nums">
                          {n ? (
                            <Link to={`/standards/code-mapping?ns=${ns.id}&status=${LEDGER_STATUS[k]}`} className="hover:underline">
                              {n}
                            </Link>
                          ) : (
                            <span className="text-fg-disabled">0</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
      <Footnote>
        按源记录去重计数：一条源记录按院区条件有多条解释时只算一次，部门与单元都有的单列“部门与单元都有”。分母是已登记到台账的源记录，不代表已覆盖各系统的全部字典。
      </Footnote>
    </div>
  )
}

// ------------------------------------------------------------------ 点选侧栏

function SelectionPanel({ sel, onClose }: { sel: Selection | null; onClose: () => void }) {
  const { optionLabels } = useApp()
  if (!sel) return null
  return (
    <aside aria-label={`选中：${sel.title}`} className="border-line-subtle bg-surface-raised grid gap-3 rounded-md border p-4 shadow-(--hd-elevation-card) @5xl:sticky @5xl:top-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-fg-strong text-sm font-semibold">{sel.title}</div>
          {sel.note && <div className="text-fg-muted mt-0.5 text-caption">{sel.note}</div>}
        </div>
        <Button variant="ghost" size="sm" className="text-fg-muted -mt-1 -mr-2" onClick={onClose}>
          关闭
        </Button>
      </div>

      {'units' in sel && (
        <>
          <TypeBreakdown units={sel.units} />
          <ul className="divide-line-subtle grid divide-y">
            {sel.units.map((u) => (
              <li key={u.id} className="grid gap-0.5 py-2 text-xs">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Link to={`/service-units/${u.id}`} className="text-fg-strong font-medium hover:underline">
                    {u.version.name}
                  </Link>
                  {u.not_yet_effective ? (
                    <Tag tone={PLANNED_TONE}>计划 {u.version.valid_from} 起</Tag>
                  ) : (
                    u.version.status !== 'ACTIVE' && (
                      <Tag tone={UNIT_STATUS_TONE[u.version.status]}>{UNIT_STATUS[u.version.status as UnitStatus] ?? u.version.status}</Tag>
                    )
                  )}
                </span>
                <span className="text-fg-muted text-caption">
                  <span className="font-mono">{u.code}</span> · {(optionLabels.unit_type?.[u.unit_type] ?? u.unit_type).replace(/单元$/, '')} ·{' '}
                  {u.version.department_name} · {u.version.campus_name}
                </span>
              </li>
            ))}
          </ul>
          {sel.actions && <div className="flex flex-wrap gap-2">{sel.actions}</div>}
        </>
      )}

      {'depts' in sel && (
        <ul className="divide-line-subtle grid divide-y">
          {sel.depts.length === 0 && <li className="text-fg-muted py-2 text-xs">没有。</li>}
          {sel.depts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <Link to={`/departments/${d.id}`} className="text-fg-strong hover:underline">
                {d.version.name}
              </Link>
              <span className="text-fg-muted text-caption">{d.main_class?.name ?? '未分类'}</span>
            </li>
          ))}
        </ul>
      )}

      {'codes' in sel && (
        <ul className="divide-line-subtle grid divide-y">
          {sel.codes.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span className="text-fg-secondary">{c.label}</span>
              <Link to={c.to} className="text-fg-strong inline-flex items-center gap-1 font-medium tabular-nums hover:underline">
                {c.count}
                <Icon icon={Link04Icon} className="text-fg-muted size-3.5" />
              </Link>
            </li>
          ))}
          <li className="text-fg-muted pt-2 text-caption">点数字进入编码映射台账（已对应的三类在台账里都是“已映射”）。</li>
        </ul>
      )}
    </aside>
  )
}

function TypeBreakdown({ units }: { units: ServiceUnitRow[] }) {
  const { optionLabels } = useApp()
  const counts = new Map<string, number>()
  for (const u of units) counts.set(u.unit_type, (counts.get(u.unit_type) ?? 0) + 1)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-caption">
      <span className="text-fg-strong font-semibold">{units.length} 个单元</span>
      {[...counts].map(([t, n]) => (
        <Tag key={t} tone="gray">
          {(optionLabels.unit_type?.[t] ?? t).replace(/单元$/, '')} {n}
        </Tag>
      ))}
    </div>
  )
}
