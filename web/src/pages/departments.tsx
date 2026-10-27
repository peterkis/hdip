// 部门：列表（Notion 数据库视图 + 部门数统计）与详情（页头属性 + 选项卡）。
// 部门数口径：查看日期当天已设立、且组织生命周期为“正式履职”的部门；筹备、暂停等不计入。
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Building03Icon,
  HierarchyIcon,
  Download01Icon,
  Hospital01Icon,
  Layers01Icon,
  ListViewIcon,
  Loading03Icon,
  Tag01Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useGetDepartment, useListClassificationSchemes, useListDepartments, useListOrgViews } from '@/api/generated/master/master'
import type { DepartmentAliasOut, DepartmentClassificationOut, DepartmentRelationOut, DepartmentRow, DepartmentVersionOut, ReorgEventOut, DepartmentDetail } from '@/api/generated/model'
import {
  DepartmentAffiliateDialog,
  DepartmentAliasCloseDialog,
  DepartmentAliasDialog,
  DepartmentClassifyDialog,
  DepartmentCreateDialog,
  DepartmentLifecycleDialog,
  DepartmentParentDialog,
  DepartmentRelationCloseDialog,
  DepartmentRelationDialog,
  DepartmentReviseDialog,
  DepartmentBatchClassifyDialog,
  DepartmentBatchParentDialog,
} from '@/components/forms/department-forms'
import { DepartmentReorgWizard, REORG_TITLE } from '@/components/forms/reorg-wizard'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
import { OrgFlow } from '@/components/org-flow'
import { Callout } from '@/components/kit/callout'
import { ChangeLink, InlineAction, InlineLink, Section } from '@/components/kit/section'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip, type DbColumn } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { PropertyList } from '@/components/kit/property-list'
import { Tag } from '@/components/kit/tag'
import { DetailFallback } from '@/components/kit/missing'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { MoreActions } from '@/components/kit/more-actions'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Segmented } from '@/components/kit/segmented'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useListDepartmentDuties, useListDepartmentPersons } from '@/api/generated/persons/persons'
import { DepartmentDuties, DepartmentLeader, DepartmentPersons } from '@/components/department-persons'
import { DutyAssignDialog, DutyEndDialog, DutyHandoverDialog, dutyRefFromDept } from '@/components/forms/person-forms'
import type { DepartmentDutyRow } from '@/api/generated/model'
import { ExternalCodeLinks } from '@/components/external-code-links'
import { ClassificationCloseDialog, ClassifyDialog } from '@/components/forms/code-forms'
import { UnitsTable } from '@/components/units-table'
import { VersionTimeline, type TimelineEvent } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { DEPARTMENT_LIFECYCLE, DEPT_RELATION, ESTABLISHMENT_FORM, levelName, period, versionNote, type DepartmentLifecycle, type DeptRelationKind } from '@/lib/format'
import { notify } from '@/lib/notify'
import { DEPARTMENT_LIFECYCLE_TONE, DEPT_RELATION_TONE, MAIN_CLASS_TONE, levelTone, PLANNED_TONE } from '@/lib/tones'
import { isNumberList, isString, useListReturn, useReturnState } from '@/lib/scroll-memory'
import { useCurrentUsername } from '@/lib/session'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

const MAIN_SCHEME = 'DEPT_MAIN_CLASS'
const EMPTY_PICK: Map<number, DepartmentRow> = new Map()

function LifecycleTag({ value }: { value: string }) {
  return <Tag tone={DEPARTMENT_LIFECYCLE_TONE[value] ?? 'gray'}>{DEPARTMENT_LIFECYCLE[value as DepartmentLifecycle] ?? value}</Tag>
}

function MainClassTag({ code, name }: { code: string; name: string }) {
  return <Tag tone={MAIN_CLASS_TONE[code] ?? 'gray'}>{name}</Tag>
}

/** 部门数口径：当天已设立且正式履职 */
const counted = (d: DepartmentRow) => !d.not_yet_effective && d.version.lifecycle === 'ACTIVE'

// ================================================================== 列表
// 统一规范 v1.0 SC-04：名称（管理编码在辅助行）/ 组织生命周期 / 部门管理主分类 / 行政上级（层级在辅助行）/
// 主体归属 / 服务单元数；设立形式等放“完整字段”（只记在本浏览器）
const COLUMNS: DbColumn[] = [
  { label: '名称', icon: TextFontIcon, className: 'min-w-48' },
  { label: '组织生命周期', icon: Loading03Icon },
  { label: '部门管理主分类', icon: Tag01Icon },
  { label: '行政上级', icon: Layers01Icon },
  { label: '主体归属', icon: Hospital01Icon },
  { label: '服务单元', icon: Building03Icon },
]
const FULL_COLUMNS: DbColumn[] = [...COLUMNS, { label: '设立形式', icon: ListViewIcon }]
const FULL_KEY = 'hdip.departments.full-fields'

export function DepartmentsPage() {
  usePageFrame('work')
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const [params, setParams] = useSearchParams()
  const set = (k: string, v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set(k, v)
        else next.delete(k)
        return next
      },
      { replace: true },
    )
  const cls = params.get('class') ?? ''
  const life = params.get('lifecycle') ?? ''
  const future = params.get('future') !== '0'
  const lvl = params.get('level') ?? ''
  const mode = params.get('view') === 'tree' ? 'tree' : 'table'
  // 检索词与树的折叠是本页状态：从详情返回时取回（U3R-05，lib/scroll-memory.ts）
  const [query, setQuery] = useReturnState('q', '', isString)
  const q = useDeferredValue(query.trim())
  const [creating, setCreating] = useState(false)
  const [full, setFull] = useState(() => {
    try {
      return localStorage.getItem(FULL_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleFull = (v: boolean) => {
    setFull(v)
    try {
      localStorage.setItem(FULL_KEY, v ? '1' : '')
    } catch {
      /* 只在本次有效 */
    }
  }
  const columns = full ? FULL_COLUMNS : COLUMNS
  // 批量操作的所选集合（统一规范 C-04 / SC-04，U3R-02）：存勾选时查询返回的部门行，所以搜索、筛选、表 / 树切换后
  // 仍能列出、计数并交给批量表单；选择条、名单、批量表单都只用这一份。绑定查看日期与当前身份：任一变化即清空
  // （渲染时就不再使用旧选择，effect 里再清掉并提示一次），不把旧日期的部门快照带进新日期的批量操作。
  const username = useCurrentUsername()
  const selKey = `${asOf}|${username}`
  const [sel, setSel] = useState<{ key: string; rows: Map<number, DepartmentRow> }>(() => ({ key: selKey, rows: new Map() }))
  const [batch, setBatch] = useState<'classify' | 'parent' | null>(null)
  const [showPicked, setShowPicked] = useState(false)
  const current = sel.key === selKey ? sel.rows : EMPTY_PICK
  useEffect(() => {
    if (sel.key === selKey) return
    if (sel.rows.size > 0) notify.info(`查看日期或身份已变，已清除之前选择的 ${sel.rows.size} 个部门`)
    setSel({ key: selKey, rows: new Map() })
    setBatch(null)
    setShowPicked(false)
  }, [selKey, sel])
  const updatePick = (fn: (m: Map<number, DepartmentRow>) => void) =>
    setSel((prev) => {
      const rows = new Map(prev.key === selKey ? prev.rows : [])
      fn(rows)
      return { key: selKey, rows }
    })
  const toggleCheck = (d: DepartmentRow) =>
    updatePick((m) => {
      if (m.has(d.id)) m.delete(d.id)
      else m.set(d.id, d)
    })

  // 读取状态（U3R-03）：统计、空态、计数只由当前范围读取成功的数据得出
  const list = useListDepartments({ as_of: asOf, ...(q && { q }) })
  const status = readStatus(list)
  const all = useMemo(() => list.data ?? [], [list.data])
  // 同一天的新查询再次返回已选部门时用最新的行；没返回的保留勾选时的样子（只是当前没列出）。
  // 部门读取被明确拒绝（401 / 403）时不再显示、不再交出旧选择，并清空（审查 F07）；普通刷新失败照常保留
  const denied = list.isError && isDenial(list.error)
  const picked = useMemo(() => {
    if (denied) return []
    const fresh = new Map(all.map((d) => [d.id, d]))
    return [...current.values()].map((d) => fresh.get(d.id) ?? d)
  }, [current, all, denied])
  useEffect(() => {
    if (!denied || sel.rows.size === 0) return
    notify.info(`部门读取被拒绝，已清除之前选择的 ${sel.rows.size} 个部门`)
    setSel({ key: selKey, rows: new Map() })
    setBatch(null)
  }, [denied, sel, selKey])
  if (picked.length === 0 && showPicked) setShowPicked(false)
  const schemeQuery = useListClassificationSchemes()
  const mainCodes = schemeQuery.data?.find((s) => s.code === MAIN_SCHEME)?.codes ?? []
  const filtered = !!(q || cls || life || lvl || !future)
  const clearFilters = () => {
    setQuery('')
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['class', 'lifecycle', 'level', 'future']) next.delete(k)
        return next
      },
      { replace: true },
    )
  }

  const rows = useMemo(
    () =>
      all.filter(
        (d) =>
          (future || !d.not_yet_effective) &&
          (!cls || (cls === '_none' ? !d.main_class : d.main_class?.code === cls)) &&
          (!life || d.version.lifecycle === life) &&
          (!lvl || String(d.level) === lvl),
      ),
    [all, future, cls, life, lvl],
  )
  // 层级树：按行政隶属深度优先排列，同级按代码；可折叠子树
  const [collapsedBefore] = useReturnState('collapsed', [] as number[], isNumberList)
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(collapsedBefore))
  const tree = useMemo(() => (mode === 'tree' ? treeOrder(rows, collapsed) : null), [rows, mode, collapsed])
  const ordered: (DepartmentRow & { tree?: TreeMeta })[] = tree ?? rows
  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 选择跨搜索、筛选保留：写明其中有几个当前没列出，可以一键清掉，避免批量时带上看不见的部门
  const visibleIds = useMemo(() => new Set(ordered.map((d) => d.id)), [ordered])
  const hiddenChecked = picked.filter((d) => !visibleIds.has(d.id)).length

  // 返回上下文：集合范围 = 查看日期 + 网址里的筛选与视图 + 检索词
  const back = useListReturn({
    scope: `${asOf}|${params.toString()}|${q}`,
    ready: status === 'ready',
    local: { q: query, collapsed: [...collapsed] },
  })

  const exporting = useMutation({
    mutationFn: () => downloadCsv('departments', asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的部门`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="部门"
        description="谁在医院组织体系内承担这组职责。部门身份不因院区、地点、负责人、服务形态或核算口径变化而改变。"
        actions={
          <>
            <Button
              variant="ghost"
              disabled={exporting.isPending}
              onClick={() => exporting.mutate()}
              title="导出查看日期当天的全部部门，不按页面上的筛选"
            >
              <Icon icon={Download01Icon} inline="start" />
              导出查看日期的部门
            </Button>
            {isMaintainer && (
              <Button onClick={() => setCreating(true)}>
                <Icon icon={Add01Icon} inline="start" />
                新建部门
              </Button>
            )}
          </>
        }
      />

      {!q && (
        <DeptStats
          rows={status === 'ready' ? all : null}
          codes={readStatus(schemeQuery) === 'ready' ? mainCodes : null}
          onPick={(c) => set('class', c)}
          active={cls}
        />
      )}

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称、拼音码、别名或代码" />}>
        <Segmented
          label="视图"
          value={mode}
          onChange={(v) => set('view', v === 'tree' ? 'tree' : '')}
          options={[
            { value: 'table', label: '表格' },
            { value: 'tree', label: '层级树' },
          ]}
        />
        <span aria-hidden className="bg-line mx-1 h-4 w-px" />
        <FilterPill
          label="主分类"
          icon={Tag01Icon}
          value={cls}
          onChange={(v) => set('class', v)}
          options={[...mainCodes.map((c) => ({ value: c.code, label: c.name })), { value: '_none', label: '未分类' }]}
        />
        <FilterPill
          label="生命周期"
          icon={Loading03Icon}
          value={life}
          onChange={(v) => set('lifecycle', v)}
          options={Object.entries(DEPARTMENT_LIFECYCLE).map(([value, label]) => ({ value, label }))}
        />
        <FilterPill
          label="层级"
          icon={HierarchyIcon}
          value={lvl}
          onChange={(v) => set('level', v)}
          options={[1, 2, 3].map((n) => ({ value: String(n), label: levelName(n) }))}
        />
        <ToggleChip label="含计划中" checked={future} onChange={(v) => set('future', v ? '' : '0')} />
        <ToggleChip label="完整字段" checked={full} onChange={toggleFull} />
      </DbToolbar>

      <StaleNotice what="部门" query={list} />
      {status === 'loading' ? (
        <ReadLoading label="正在读取部门…" />
      ) : status === 'error' ? (
        <ReadError what="部门" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty
          title={!filtered ? `${asOf} 没有部门` : q && all.length === 0 ? `没有找到“${q}”` : '当前条件下没有部门'}
          hint={!filtered ? '新建部门后经提交、确认才会出现在这里。' : '查看日期不变；清除搜索与筛选后再看。'}
          action={
            filtered && (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                清除搜索与筛选
              </Button>
            )
          }
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
        <DbTable columns={isMaintainer ? [{ label: '', className: 'w-8' }, ...columns] : columns}>
          {isMaintainer && (
            <tr className="border-line-subtle border-b">
              <td className="px-(--hd-cell-padding-x) py-1.5" colSpan={columns.length + 1}>
                <label className="text-fg-muted flex items-center gap-2 text-caption">
                  <input
                    type="checkbox"
                    className="accent-brand size-3.5"
                    checked={ordered.length > 0 && ordered.every((d) => current.has(d.id))}
                    onChange={(e) =>
                      updatePick((m) => {
                        for (const d of ordered) {
                          if (e.target.checked) m.set(d.id, d)
                          else m.delete(d.id)
                        }
                      })
                    }
                  />
                  全选当前列出的 {ordered.length} 个部门（可先用上方筛选缩小范围，再批量设置主分类或行政上级；取消只去掉当前列出的）
                </label>
              </td>
            </tr>
          )}
          {ordered.map((d) => (
            <DbRow key={d.id} returnId={d.id} className={cn(current.has(d.id) && 'bg-surface-selected')}>
              {isMaintainer && (
                <DbCell>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${d.version.name}`}
                    className="accent-brand size-3.5"
                    checked={current.has(d.id)}
                    onChange={() => toggleCheck(d)}
                  />
                </DbCell>
              )}
              <DbCell className={cn(d.tree && 'relative')}>
                {d.tree && <TreeGuides meta={d.tree} />}
                <span
                  className="flex items-center gap-2"
                  style={d.tree ? { paddingLeft: `calc(var(--hd-space-20) * ${d.tree.depth})` } : undefined}
                >
                  {d.tree &&
                    (d.tree.kids > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggle(d.id)}
                        className="text-fg-muted hover:text-fg hover:bg-surface-hover relative z-10 -mx-0.5 flex size-4 items-center justify-center rounded-sm"
                        title={d.tree.closed ? `展开 ${d.tree.kids} 个下级` : '收起下级'}
                      >
                        <Icon icon={d.tree.closed ? ArrowRight01Icon : ArrowDown01Icon} className="size-3" strokeWidth={2} />
                      </button>
                    ) : (
                      <span className="size-3" />
                    ))}
                  {/* 名称为主、管理编码为辅；层级树里编码跟在名称后（同一行，连线才对得上） */}
                  <span className={cn('min-w-0', d.tree ? 'flex items-center gap-2' : 'grid gap-0.5')}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Link
                        to={`/departments/${d.id}`}
                        className="text-fg-strong decoration-line-strong truncate font-medium underline-offset-4 hover:underline"
                      >
                        {d.version.name}
                      </Link>
                      {d.not_yet_effective && <Tag tone={PLANNED_TONE}>计划中</Tag>}
                      {d.tree?.closed && <span className="text-fg-muted text-caption">+{d.tree.descendants}</span>}
                    </span>
                    <span className="text-fg-muted font-mono text-caption whitespace-nowrap select-all">{d.code}</span>
                  </span>
                </span>
              </DbCell>
              <DbCell>
                <LifecycleTag value={d.version.lifecycle} />
              </DbCell>
              <DbCell>
                {d.main_class ? (
                  <MainClassTag code={d.main_class.code} name={d.main_class.name} />
                ) : (
                  <span className="text-fg-muted">未分类</span>
                )}
              </DbCell>
              <DbCell className="whitespace-nowrap">
                <span className="grid gap-0.5">
                  {d.parent ? (
                    <Link to={`/departments/${d.parent.id}`} className="hover:underline">
                      {d.parent.name}
                    </Link>
                  ) : (
                    <span className="text-fg-muted">无上级</span>
                  )}
                  <span className="text-fg-muted text-caption">{levelName(d.level)}</span>
                </span>
              </DbCell>
              <DbCell className="whitespace-nowrap">{d.institution_name ?? <span className="text-fg-muted">未登记</span>}</DbCell>
              <DbCell className="text-fg-secondary text-right tabular-nums">{d.unit_count || '—'}</DbCell>
              {full && (
                <DbCell className="whitespace-nowrap">
                  {ESTABLISHMENT_FORM[d.version.establishment_form]}
                  {d.version.temporary_until && <span className="text-fg-muted text-caption"> · 至 {d.version.temporary_until}</span>}
                </DbCell>
              )}
            </DbRow>
          ))}
        </DbTable>
        </div>
      )}
      <DbFooter>
        <span>
          列出 <span className="text-fg-secondary">{status === 'ready' ? rows.length : <Unknown reason="部门尚未读取成功" />}</span> 个部门（当前筛选）
        </span>
        <span>上方统计只计查看日期当天“正式履职”的部门；筹备、暂停履职、撤销与计划中不计入</span>
      </DbFooter>
      {picked.length > 0 && (
        <div className="bg-surface-raised border-line sticky bottom-3 z-20 mt-3 grid gap-2 rounded-lg border px-3 py-2 shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fg-secondary text-xs">
              已选 <span className="text-fg-strong font-medium">{picked.length}</span> 个部门
              {hiddenChecked > 0 && <>，其中当前列出 {picked.length - hiddenChecked} 个</>}
            </span>
            <Button size="sm" variant="ghost" aria-expanded={showPicked} onClick={() => setShowPicked(!showPicked)}>
              <Icon icon={showPicked ? ArrowDown01Icon : ArrowRight01Icon} inline="start" />
              {showPicked ? '收起名单' : `查看已选 ${picked.length} 个`}
            </Button>
            {hiddenChecked > 0 && (
              <Button size="sm" variant="ghost" onClick={() => updatePick((m) => picked.forEach((d) => !visibleIds.has(d.id) && m.delete(d.id)))}>
                清除没列出的 {hiddenChecked} 个
              </Button>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => updatePick((m) => m.clear())}>
                清除选择
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBatch('parent')}>
                调整行政上级…
              </Button>
              <Button size="sm" onClick={() => setBatch('classify')}>
                设置主分类…
              </Button>
            </span>
          </div>
          {showPicked && (
            <ul aria-label="已选部门" className="border-line-subtle grid max-h-60 overflow-y-auto border-t pt-1">
              {picked.map((d) => (
                <li key={d.id} className="flex min-h-(--hd-control-height) items-center gap-2 text-xs">
                  <span className="text-fg-strong min-w-0 truncate">{d.version.name}</span>
                  <span className="text-fg-muted font-mono text-caption">{d.code}</span>
                  {!visibleIds.has(d.id) && <span className="text-fg-muted text-caption">当前未列出</span>}
                  <InlineAction className="ml-auto" label={`取消选择 ${d.version.name}`} onClick={() => updatePick((m) => m.delete(d.id))}>
                    取消选择
                  </InlineAction>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {creating && <DepartmentCreateDialog open onOpenChange={setCreating} />}
      {batch === 'classify' && picked.length > 0 && (
        <DepartmentBatchClassifyDialog open onOpenChange={(o) => !o && setBatch(null)} rows={picked} />
      )}
      {batch === 'parent' && picked.length > 0 && (
        <DepartmentBatchParentDialog open onOpenChange={(o) => !o && setBatch(null)} rows={picked} />
      )}
    </>
  )
}

interface TreeMeta {
  /** 在当前树里的深度（0 = 根；筛选后上级不在列表里的部门也作为根） */
  depth: number
  /** 是否是同级最后一个：最后一个的连线在此转弯结束 */
  last: boolean
  /** 各层祖先下方是否还有兄弟：有则那一层的竖线继续往下 */
  guides: boolean[]
  kids: number
  descendants: number
  closed: boolean
}

/** 层级树顺序：一级部门按代码，其下级紧随其后（深度优先）；带上画连线所需的信息 */
function treeOrder(rows: DepartmentRow[], collapsed: Set<number>): (DepartmentRow & { tree: TreeMeta })[] {
  const ids = new Set(rows.map((r) => r.id))
  const kids = new Map<number, DepartmentRow[]>()
  const roots: DepartmentRow[] = []
  for (const r of rows) {
    if (r.parent && ids.has(r.parent.id)) kids.set(r.parent.id, [...(kids.get(r.parent.id) ?? []), r])
    else roots.push(r)
  }
  const count = (id: number): number => (kids.get(id) ?? []).reduce((n, k) => n + 1 + count(k.id), 0)
  const out: (DepartmentRow & { tree: TreeMeta })[] = []
  const walk = (list: DepartmentRow[], depth: number, guides: boolean[]) => {
    const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code))
    sorted.forEach((r, i) => {
      const last = i === sorted.length - 1
      const children = kids.get(r.id) ?? []
      const closed = collapsed.has(r.id)
      out.push({ ...r, tree: { depth, last, guides, kids: children.length, descendants: count(r.id), closed } })
      if (!closed) walk(children, depth + 1, [...guides, !last])
    })
  }
  walk(roots, 0, [])
  return out
}

/**
 * 层级连线（类似讨论区“回复”引线）：上级的竖线贯穿到最后一个下级，
 * 每个下级从竖线圆角转弯接到自己的名称前。坐标与展开按钮中心对齐。
 */
function TreeGuides({ meta }: { meta: TreeMeta }) {
  if (meta.depth === 0) return null
  // 第 k 层竖线的横坐标：单元格左内边距（规范样式 12）+ k 个缩进 + 展开按钮半宽
  const x = (k: number) => `calc(var(--hd-cell-padding-x) + var(--hd-space-20) * ${k} + var(--hd-space-6))`
  const self = meta.depth - 1
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {meta.guides.slice(1).map((on, k) =>
        on ? <span key={k} className="border-line-strong absolute top-0 bottom-0 border-l" style={{ left: x(k) }} /> : null,
      )}
      <span
        className="border-line-strong absolute top-0 h-1/2 rounded-bl-md border-b border-l"
        style={{ left: x(self), width: 'var(--hd-space-20)' }}
      />
      {!meta.last && <span className="border-line-strong absolute top-1/2 bottom-0 border-l" style={{ left: x(self) }} />}
    </span>
  )
}

/** 统计条：正式履职部门数、按主分类计数（每个部门只计一次）、不计入的筹备与暂停。点击按主分类筛选 */
function DeptStats({
  rows,
  codes,
  onPick,
  active,
}: {
  /** null = 部门尚未读取成功（读取中或失败），各格不写数字 */
  rows: DepartmentRow[] | null
  /** null = 分类方案尚未读取成功，按分类的格不列出 */
  codes: { code: string; name: string }[] | null
  onPick: (code: string) => void
  active: string
}) {
  const known = rows !== null
  const num = (n: number) => (known ? n : <Unknown reason="部门尚未读取成功" />)
  const inCount = (rows ?? []).filter(counted)
  const byClass = (code: string) => inCount.filter((d) => d.main_class?.code === code).length
  const unclassified = inCount.filter((d) => !d.main_class).length
  // 不计入：尚未设立（计划中）或仍在筹备的部门
  const preparing = (rows ?? []).filter((d) => d.not_yet_effective || d.version.lifecycle === 'PREPARING').length
  const suspended = (rows ?? []).filter((d) => !d.not_yet_effective && d.version.lifecycle === 'SUSPENDED').length
  const cell = 'grid gap-0.5 px-3 py-2 text-left transition-colors duration-(--hd-duration-fast)'
  return (
    <div className="border-line-subtle mb-4 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4 lg:grid-cols-9">
      <div className={cn(cell, 'bg-surface-subtle')}>
        <span className="text-fg-strong text-lg font-semibold tabular-nums">{num(inCount.length)}</span>
        <span className="text-fg-muted text-caption">正式履职部门数</span>
      </div>
      {codes === null && (
        <div className={cn(cell, 'col-span-2 sm:col-span-2 lg:col-span-7')}>
          <span className="text-fg-muted text-lg font-semibold">
            <Unknown reason="分类方案尚未读取成功" />
          </span>
          <span className="text-fg-muted text-caption">按主分类（分类方案尚未读取）</span>
        </div>
      )}
      {[...(codes ?? []).map((c) => ({ code: c.code, name: c.name, n: byClass(c.code) })), ...(codes ? [{ code: '_none', name: '未分类', n: unclassified }] : [])].map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => onPick(active === c.code ? '' : c.code)}
          className={cn(cell, 'hover:bg-surface-hover', active === c.code && 'bg-brand-muted')}
        >
          <span className="text-fg-strong text-lg font-semibold tabular-nums">{num(c.n)}</span>
          <span className="text-fg-muted text-caption">{c.name}</span>
        </button>
      ))}
      <div className={cell} title="筹备中、尚未正式履职的部门不进入正式统计">
        <span className="text-fg-muted text-lg font-semibold tabular-nums">
          {num(preparing)}
          {known && suspended > 0 && <span className="text-caption font-normal"> · 暂停 {suspended}</span>}
        </span>
        <span className="text-fg-muted text-caption">筹备 / 计划中（不计入）</span>
      </div>
    </div>
  )
}

// ================================================================== 详情
const VERSION_FIELDS: (keyof DepartmentVersionOut)[] = [
  'name',
  'short_name',
  'lifecycle',
  'establishment_form',
  'temporary_until',
  'admin_grade',
  'duties',
  'description',
  'basis_note',
]

type Dialog = 'revise' | 'lifecycle' | 'classify' | 'otherClass' | 'affiliate' | 'alias' | 'unit' | 'parent' | 'relation' | 'reorg'
type TabKey = 'props' | 'class' | 'org' | 'units' | 'persons' | 'history' | 'codes'
const TAB_KEYS: TabKey[] = ['props', 'class', 'org', 'units', 'persons', 'history', 'codes']

export function DepartmentDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer, can, permsKnown } = useMe()
  const query = useGetDepartment(id, { as_of: asOf }, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  // 人员、职务是独立读取（U3R-03）：无 person.view 不发请求、写“无权查看”；权限未读到时既不发请求也不说无权；
  // 读取中、失败时不写 0 人、不写“未登记负责人”
  const canPersons = can('person.view')
  const personsQuery = useListDepartmentPersons(
    id,
    { as_of: asOf, include_future: true },
    { query: { enabled: canPersons && Number.isInteger(id) } },
  )
  const dutiesQuery = useListDepartmentDuties(
    id,
    { as_of: asOf, include_future: true },
    { query: { enabled: canPersons && Number.isInteger(id) } },
  )
  const persons = useMemo(() => personsQuery.data ?? [], [personsQuery.data])
  const duties = dutiesQuery.data ?? []
  const personsStatus = permsKnown ? (canPersons ? readStatus(personsQuery) : 'denied') : 'loading'
  const dutiesStatus = permsKnown ? (canPersons ? readStatus(dutiesQuery) : 'denied') : 'loading'
  const [dutyDialog, setDutyDialog] = useState<{ kind: 'assign' } | { kind: 'handover' | 'end'; duty: DepartmentDutyRow } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [closingAlias, setClosingAlias] = useState<DepartmentAliasOut | null>(null)
  const [closingRelation, setClosingRelation] = useState<DepartmentRelationOut | null>(null)
  const [closingClass, setClosingClass] = useState<DepartmentClassificationOut | null>(null)
  const viewsQuery = useListOrgViews()
  const views = viewsQuery.data ?? []
  // 当前标签写在网址里（?tab=），返回、刷新、转发链接都回到同一标签（统一规范 0.2）
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') as TabKey | null
  const tab: TabKey = asked && TAB_KEYS.includes(asked) && (asked !== 'persons' || canPersons || !permsKnown) ? asked : 'props'
  const setTab = (v: TabKey) =>
    setParams(
      (p) => {
        if (v === 'props') p.delete('tab')
        else p.set('tab', v)
        return p
      },
      { replace: true },
    )
  useCrumb(data && !isDenial(query.error) ? `${data.code} ${data.versions[0].name}` : null)
  if (!data || isDenial(query.error)) return <DetailFallback what="部门" back={{ to: '/departments', label: '返回部门列表' }} query={query} invalid={!Number.isInteger(id)} />

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? data.versions.at(-1)!
  const on = <T extends { valid_from: string; valid_to: string | null }>(rows: T[]) =>
    rows.find((r) => r.valid_from <= asOf && (r.valid_to === null || r.valid_to >= asOf))
  const mainClass = on(data.classifications.filter((c) => c.scheme_code === MAIN_SCHEME))
  const affiliation = on(data.affiliations.filter((a) => a.is_primary))
  const terminal = latest.lifecycle === 'REVOKED' || latest.lifecycle === 'SUPERSEDED'
  const formerNames = data.versions.filter((v, i, arr) => v.name !== shown.name && arr.findIndex((x) => x.name === v.name) === i)
  const close = (o: boolean) => !o && setDialog(null)
  const edit = (label: string, d: Dialog) => (isMaintainer && !terminal ? <InlineAction onClick={() => setDialog(d)}>{label}</InlineAction> : null)
  // 人员数按人员去重，计划调入另计（统一规范 SC-05）；无人员查看权时不查也不显示 0
  const personNow = new Set(persons.filter((p) => !p.not_yet_effective).map((p) => p.person_id))

  // 统一规范 SC-05：名称 / 管理编码 / 版本 → 关键事实（生命周期、行政隶属、主体归属、主分类、负责人、承担职责、设立形式与级别）
  // → 标签页 → 当前分区。“修订属性”是页头主动作；组织变更、变更生命周期是低频动作，收进“更多”
  return (
    <>
      <PageHeader
        title={shown.name}
        meta={
          <>
            管理编码 <span className="font-mono">{data.code}</span> · {versionNote(data.versions, asOf)}
            <> · 内部 ID {data.id}</>
          </>
        }
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to={`/organization-overview?tab=matrix&dept=${data.id}&planned=1`} />}>
              查看跨院区布局
            </Button>
            {isMaintainer && !terminal && (
              <>
                <MoreActions
                  items={[
                    { label: '组织变更（拆分、合并等）…', onClick: () => setDialog('reorg') },
                    { label: '变更生命周期…', onClick: () => setDialog('lifecycle') },
                  ]}
                />
                <Button onClick={() => setDialog('revise')}>修订属性</Button>
              </>
            )}
          </>
        }
      />
      <StaleNotice what="这个部门" query={query} />

      <PropertyList
        items={[
          {
            label: '组织生命周期',
            value: (
              <>
                <LifecycleTag value={shown.lifecycle} />
                <span className="text-fg-secondary ml-2 text-caption">自 {shown.valid_from}</span>
              </>
            ),
          },
          {
            label: '行政隶属',
            value: (
              <span className="flex flex-wrap items-center gap-1">
                {data.path.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-fg-muted">›</span>}
                    {p.id === data.id ? (
                      <span className="text-fg-strong">{p.name}</span>
                    ) : (
                      <Link to={`/departments/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    )}
                  </span>
                ))}
                <Tag tone={levelTone(data.level)} className="ml-1">
                  {levelName(data.level)}
                </Tag>
                {edit('调整', 'parent')}
              </span>
            ),
          },
          {
            label: '主体归属',
            value: affiliation ? (
              <>
                {/* T7.2（U3R-08）：主体名称进入主体详情；“调整”是独立的动作 */}
                <Link className="hover:underline" to={`/institutions/${affiliation.institution_id}`}>
                  {affiliation.institution_name}
                </Link>
                {edit('调整', 'affiliate')}
              </>
            ) : isMaintainer && !terminal ? (
              <>
                <span className="text-fg-muted">未登记</span>
                {edit('设置', 'affiliate')}
              </>
            ) : null,
          },
          {
            label: '部门管理主分类',
            value: (
              <>
                {mainClass ? <MainClassTag code={mainClass.code} name={mainClass.name} /> : <span className="text-fg-muted">尚未分类</span>}
                {edit(mainClass ? '调整' : '设置', 'classify')}
              </>
            ),
          },
          {
            label: '当前负责人',
            value:
              dutiesStatus === 'denied' ? (
                <span className="text-fg-muted">无权查看人员</span>
              ) : dutiesStatus === 'ready' ? (
                <DepartmentLeader duties={duties} />
              ) : dutiesStatus === 'loading' ? (
                <Unknown reason="正在读取部门职务" />
              ) : (
                <span className="text-fg-muted">职务没有读取成功，见“人员”标签</span>
              ),
          },
          {
            label: '承担职责',
            value: shown.duties.length ? (
              <span className="flex flex-wrap gap-1">
                {shown.duties.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
            ) : null,
          },
          {
            label: '设立形式',
            value: `${ESTABLISHMENT_FORM[shown.establishment_form]}${shown.temporary_until ? `，期限至 ${shown.temporary_until}` : ''}`,
          },
          { label: '行政级别', value: shown.admin_grade },
        ]}
      />

      {terminal && (
        <div className="mt-6">
          <Callout tone="warning" title={`该部门已${DEPARTMENT_LIFECYCLE[latest.lifecycle as DepartmentLifecycle]}`}>
            终态，不能再调整，历史仍可查看；代码 {data.code} 永久绑定，不会被复用。
          </Callout>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList variant="line" className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="props">名称与说明</TabsTrigger>
          <TabsTrigger value="class">分类与归属</TabsTrigger>
          <TabsTrigger value="org">隶属与管理关系</TabsTrigger>
          <TabsTrigger value="units">服务单元（{data.units.length}）</TabsTrigger>
          {personsStatus !== 'denied' && (
            <TabsTrigger value="persons">人员（{personsStatus === 'ready' ? personNow.size : '—'}）</TabsTrigger>
          )}
          <TabsTrigger value="codes">外部编码（{data.external_codes.length}）</TabsTrigger>
          <TabsTrigger value="history">版本与事件</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-6">
        {tab === 'props' && (
          <>
            <Section title="名称">
              <PropertyList
                items={[
                  { label: '正式名称', value: shown.name },
                  { label: '简称', value: shown.short_name },
                  { label: '拼音码', value: shown.pinyin && <span className="font-mono">{shown.pinyin}</span> },
                  {
                    label: '曾用名',
                    value: formerNames.length ? formerNames.map((v) => `${v.name}（${period(v.valid_from, v.valid_to)}）`).join('；') : null,
                  },
                  {
                    label: '别名',
                    value: (
                      <span className="grid gap-1">
                        {data.aliases.map((a) => (
                          <span key={a.id} className="flex flex-wrap items-center gap-1.5">
                            <Tag tone="gray">
                              {a.kind === 'SEARCH_CODE' ? '检索码 ' : ''}
                              {a.value}
                            </Tag>
                            {a.valid_to ? (
                              <span className="text-fg-secondary text-caption">{a.valid_to < asOf ? `已于 ${a.valid_to} 停用` : `至 ${a.valid_to}`}</span>
                            ) : (
                              isMaintainer && !terminal && <InlineAction onClick={() => setClosingAlias(a)}>停用</InlineAction>
                            )}
                          </span>
                        ))}
                        {data.aliases.length === 0 && !(isMaintainer && !terminal) && <span className="text-fg-muted">未登记</span>}
                        {isMaintainer && !terminal && (
                          <span>
                            <InlineAction className="-ml-2" onClick={() => setDialog('alias')}>
                              添加别名
                            </InlineAction>
                          </span>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
              <p className="text-fg-secondary text-caption">名称不是身份。更名产生新版本，旧名称即曾用名；别名只用于检索，添加、停用别名不改名称。</p>
            </Section>
            <Section title="职责与依据">
              <PropertyList
                items={[
                  { label: '职责说明', value: shown.description },
                  { label: '依据', value: shown.basis_note },
                ]}
              />
            </Section>
          </>
        )}

        {tab === 'class' && (
          <>
            <Section title="部门管理主分类" action={edit(mainClass ? '调整' : '设置', 'classify')}>
              <PeriodTable
                head={['分类', '期间', '来源申请']}
                rows={data.classifications
                  .filter((c) => c.scheme_code === MAIN_SCHEME)
                  .map((c) => ({
                    key: c.id,
                    current: c === mainClass,
                    ended: c.valid_to !== null && c.valid_to < asOf,
                    cells: [<MainClassTag code={c.code} name={c.name} />, period(c.valid_from, c.valid_to), <ChangeLink id={c.change_id} />],
                  }))}
                empty="尚未分类"
              />
              <p className="text-fg-muted text-caption">同一时点只有一个主分类；承担的多项职责放在“承担职责”。成本分类另设，允许与管理主分类有依据地不同。</p>
            </Section>
            <Section title="其他分类" action={edit('设置分类', 'otherClass')}>
              <PeriodTable
                head={['分类方案', '期间', '来源申请', '']}
                rows={data.classifications
                  .filter((c) => c.scheme_code !== MAIN_SCHEME)
                  .map((c) => ({
                    key: c.id,
                    current: c.valid_from <= asOf && (c.valid_to === null || c.valid_to >= asOf),
                    ended: c.valid_to !== null && c.valid_to < asOf,
                    cells: [
                      <span>
                        <span className="text-fg-secondary">{c.scheme_name}：</span>
                        <Tag tone="blue">
                          {c.code} {c.name}
                        </Tag>
                      </span>,
                      period(c.valid_from, c.valid_to),
                      <ChangeLink id={c.change_id} />,
                      isMaintainer && !terminal && c.valid_to === null ? (
                        <Button size="sm" variant="ghost" onClick={() => setClosingClass(c)}>
                          结束
                        </Button>
                      ) : null,
                    ],
                  }))}
                empty="没有其他分类"
              />
              <p className="text-fg-muted text-caption">如病案科室分类、诊疗科目。部门分类不会自动下发给它的服务单元。</p>
            </Section>
            <Section title="主体归属" action={edit(affiliation ? '调整' : '设置', 'affiliate')}>
              <PeriodTable
                head={['主体', '期间', '来源申请']}
                rows={data.affiliations.map((a) => ({
                  key: a.id,
                  current: a === affiliation,
                  ended: a.valid_to !== null && a.valid_to < asOf,
                  cells: [
                    <Link className="hover:underline" to={`/institutions/${a.institution_id}`}>
                      {a.institution_name}
                    </Link>,
                    period(a.valid_from, a.valid_to),
                    <ChangeLink id={a.change_id} />,
                  ],
                }))}
                empty="未登记主体归属"
              />
            </Section>
          </>
        )}

        {tab === 'org' && (
          <>
            {readStatus(viewsQuery) === 'error' && <ReadError what="组织视图列表" query={viewsQuery} compact />}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="组织视图">
              {views.map((v) => (
                <Tag key={v.code} tone={v.status === 'ACTIVE' ? 'blue' : 'gray'} className={cn(v.status !== 'ACTIVE' && 'opacity-60')}>
                  {v.name}
                  {v.status !== 'ACTIVE' && ' · 占位'}
                </Tag>
              ))}
            </div>
            <Section title={`隶属与管理关系图（${asOf}）`}>
              <OrgFlow
                self={{ id: data.id, code: data.code, name: shown.name }}
                level={data.level}
                path={data.path}
                children={data.children}
                relations={data.relations}
                asOf={asOf}
              />
            </Section>
            <Section title="行政隶属（行政视图）" action={edit('调整上级', 'parent')}>
              <PeriodTable
                head={['直接上级', '期间', '来源申请']}
                rows={data.parents.map((e) => ({
                  key: e.id,
                  current: e.valid_from <= asOf && (e.valid_to === null || e.valid_to >= asOf),
                  ended: e.valid_to !== null && e.valid_to < asOf,
                  cells: [
                    <Link to={`/departments/${e.parent.id}`} className="hover:underline">
                      {e.parent.name}
                    </Link>,
                    period(e.valid_from, e.valid_to),
                    <ChangeLink id={e.change_id} />,
                  ],
                }))}
                empty="一直是一级部门（无上级）"
              />
              <p className="text-fg-muted text-caption">
                下级部门（{asOf}）：
                {data.children.length
                  ? data.children.map((c) => (
                      <Link key={c.id} to={`/departments/${c.id}`} className="text-fg ml-1.5 hover:underline">
                        {c.name}
                      </Link>
                    ))
                  : ' 无'}
                。同一视图同一时点一个直接上级，不能成环；一级 / 二级部门由隶属关系计算。
              </p>
            </Section>
            <Section
              title="管理关系"
              action={isMaintainer && !terminal ? <InlineAction onClick={() => setDialog('relation')}>建立管理关系</InlineAction> : null}
            >
              <RelationsTable
                deptId={data.id}
                relations={data.relations}
                asOf={asOf}
                onClose={isMaintainer ? setClosingRelation : undefined}
              />
              <p className="text-fg-muted text-caption">
                专业管理按事项记录，不构成行政上级（如医务部对临床医疗工作、护理部对护理专业）；关系由院内制度确认，系统不从名称推断。
              </p>
            </Section>
          </>
        )}

        {tab === 'units' && (
          <Section
            title={`服务单元（${asOf}）`}
            action={isMaintainer && latest.lifecycle === 'ACTIVE' ? <InlineAction onClick={() => setDialog('unit')}>新建服务单元</InlineAction> : null}
          >
            <UnitsTable rows={data.units} hide={['department']} />
            <p className="text-fg-muted text-caption">部门在新院区开展服务 = 新建或重新绑定服务单元，部门身份不变。</p>
          </Section>
        )}

        {tab === 'persons' && (
          <div className="grid gap-8">
            <Section
              title="部门职务"
              action={can('person.change') ? <InlineAction onClick={() => setDutyDialog({ kind: 'assign' })}>任命职务</InlineAction> : null}
            >
              {dutiesStatus === 'ready' && <StaleNotice what="部门职务" query={dutiesQuery} />}
              {dutiesStatus === 'ready' ? (
                <DepartmentDuties rows={duties} onAction={can('person.change') ? (kind, duty) => setDutyDialog({ kind, duty }) : undefined} />
              ) : dutiesStatus === 'error' ? (
                <ReadError what="部门职务" query={dutiesQuery} compact />
              ) : (
                <ReadLoading label={permsKnown ? '正在读取部门职务…' : '正在确认查看人员的权限…'} rows={2} />
              )}
              <p className="text-fg-muted text-caption">负责人由职务按日期带出，不写在部门上；代管者可以不归属本部门；职务不等于系统权限。</p>
            </Section>
            <Section title={`人员归属（${asOf}）`}>
              {personsStatus === 'ready' && <StaleNotice what="人员归属" query={personsQuery} />}
              {personsStatus === 'ready' ? (
                <DepartmentPersons rows={persons} suspended={onDay?.lifecycle === 'SUSPENDED'} />
              ) : personsStatus === 'error' ? (
                <ReadError what="人员归属" query={personsQuery} compact />
              ) : (
                <ReadLoading label={permsKnown ? '正在读取人员归属…' : '正在确认查看人员的权限…'} rows={3} />
              )}
            </Section>
          </div>
        )}

        {dutyDialog?.kind === 'assign' && (
          <DutyAssignDialog open onOpenChange={(o) => !o && setDutyDialog(null)} departmentCode={data.code} departmentName={latest.name} />
        )}
        {dutyDialog?.kind === 'handover' && (
          <DutyHandoverDialog open onOpenChange={(o) => !o && setDutyDialog(null)} duty={dutyRefFromDept(dutyDialog.duty, latest.name)} />
        )}
        {dutyDialog?.kind === 'end' && (
          <DutyEndDialog open onOpenChange={(o) => !o && setDutyDialog(null)} duty={dutyRefFromDept(dutyDialog.duty, latest.name)} />
        )}

        {tab === 'codes' && (
          <>
            <Section
              title="本部门的外部代码"
              action={<InlineLink to="/standards/code-mapping">到编码映射台账维护</InlineLink>}
            >
              <ExternalCodeLinks rows={data.external_codes} asOf={asOf} empty="没有外部代码的解释指向本部门" />
              <p className="text-fg-muted text-caption">
                这些代码标识的就是本部门。行政隶属、主分类调整都不改动身份映射；编辑统一在编码映射台账进行。
              </p>
            </Section>
            <Section title={`关联单元编码（${asOf}，经服务单元得到）`}>
              <ExternalCodeLinks rows={data.unit_external_codes} asOf={asOf} empty="本部门的服务单元当天没有外部代码" showUnit />
              <p className="text-fg-muted text-caption">只读：这些代码标识的是服务单元，不是本部门的身份标识；按部门汇总时沿单元的所属部门得出。</p>
            </Section>
          </>
        )}

        {tab === 'history' && data.reorganizations.length > 0 && (
          <Section title="沿革（组织变更）">
            <ReorgHistory events={data.reorganizations} selfCode={data.code} />
          </Section>
        )}
        {tab === 'history' && (
          <Section title="版本与事件">
            <VersionTimeline
              versions={data.versions}
              fields={VERSION_FIELDS}
              asOf={asOf}
              first={{
                title: '设立',
                detail: (v) => `${ESTABLISHMENT_FORM[v.establishment_form]}，${DEPARTMENT_LIFECYCLE[v.lifecycle as DepartmentLifecycle]}`,
              }}
              extra={departmentEvents(data)}
              order="desc"
            />
          </Section>
        )}
      </div>

      {dialog === 'revise' && <DepartmentReviseDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'lifecycle' && <DepartmentLifecycleDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'classify' && (
        <DepartmentClassifyDialog open onOpenChange={close} code={data.code} name={latest.name} currentCode={mainClass?.code} />
      )}
      {dialog === 'otherClass' && <ClassifyDialog open onOpenChange={close} owner="department" code={data.code} name={latest.name} />}
      {closingClass && (
        <ClassificationCloseDialog open onOpenChange={(o) => !o && setClosingClass(null)} owner="department" classification={closingClass} />
      )}
      {dialog === 'affiliate' && <DepartmentAffiliateDialog open onOpenChange={close} code={data.code} name={latest.name} />}
      {dialog === 'alias' && <DepartmentAliasDialog open onOpenChange={close} code={data.code} name={latest.name} />}
      {dialog === 'unit' && <UnitCreateDialog open onOpenChange={close} departmentCode={data.code} />}
      {closingAlias && <DepartmentAliasCloseDialog open alias={closingAlias} onOpenChange={(o) => !o && setClosingAlias(null)} />}
      {dialog === 'parent' && (
        <DepartmentParentDialog
          open
          onOpenChange={close}
          code={data.code}
          name={latest.name}
          currentParent={data.path.length > 1 ? data.path[data.path.length - 2] : null}
        />
      )}
      {dialog === 'relation' && <DepartmentRelationDialog open onOpenChange={close} code={data.code} name={latest.name} />}
      {dialog === 'reorg' && (
        <DepartmentReorgWizard
          open
          onOpenChange={close}
          source={{
            id: data.id,
            code: data.code,
            name: latest.name,
            institutionCode: affiliation?.institution_code ?? null,
            parentCode: data.path.length > 1 ? data.path[data.path.length - 2].code : null,
            mainClass: mainClass?.code ?? null,
          }}
        />
      )}
      {closingRelation && (
        <DepartmentRelationCloseDialog open relation={closingRelation} onOpenChange={(o) => !o && setClosingRelation(null)} />
      )}
    </>
  )
}

// ------------------------------------------------------------------ 小件
function RelationsTable({
  deptId,
  relations,
  asOf,
  onClose,
}: {
  deptId: number
  relations: DepartmentRelationOut[]
  asOf: string
  onClose?: (r: DepartmentRelationOut) => void
}) {
  if (relations.length === 0) return <p className="text-fg-secondary text-xs">没有专业管理、协作或院区管理关系</p>
  return (
    <DbTable
      columns={[
        { label: '类型' },
        { label: '关系' },
        { label: '事项 / 范围', className: 'min-w-40' },
        { label: '关系期间' },
        { label: '' },
      ]}
    >
      {relations.map((r) => {
        const current = r.valid_from <= asOf && (r.valid_to === null || r.valid_to >= asOf)
        const dept = (x: { id: number; name: string }) =>
          x.id === deptId ? (
            <span className="text-fg-strong">本部门</span>
          ) : (
            <Link to={`/departments/${x.id}`} className="hover:underline">
              {x.name}
            </Link>
          )
        return (
          <DbRow key={r.id} className={cn(!current && 'text-fg-muted')}>
            <DbCell>
              <Tag tone={DEPT_RELATION_TONE[r.kind]}>{DEPT_RELATION[r.kind as DeptRelationKind]}</Tag>
            </DbCell>
            <DbCell className="whitespace-nowrap">
              {dept(r.from_department)}
              <span className="text-fg-disabled mx-1.5">→</span>
              {r.to_department ? dept(r.to_department) : <span className="text-fg-muted">整个院区</span>}
              {r.campus_name && <span className="text-fg-muted ml-1.5 text-caption">@ {r.campus_name}</span>}
            </DbCell>
            <DbCell className="whitespace-normal">{r.scope}</DbCell>
            <DbCell className="whitespace-nowrap">{period(r.valid_from, r.valid_to)}</DbCell>
            <DbCell className="text-right">
              {onClose && r.valid_to === null && (
                <Button size="sm" variant="ghost" onClick={() => onClose(r)}>
                  结束
                </Button>
              )}
            </DbCell>
          </DbRow>
        )
      })}
    </DbTable>
  )
}
/** 部门时间线上版本之外的事件：分类赋值、行政隶属调整、管理关系、组织变更 */
function departmentEvents(d: DepartmentDetail): TimelineEvent[] {
  const created = d.versions.at(-1)?.valid_from
  return [
    ...d.classifications.map((c) => ({
      key: `c${c.id}`,
      date: c.valid_from,
      title: c.scheme_code === MAIN_SCHEME ? '主分类赋值' : '分类赋值',
      detail: `${c.scheme_name}：${c.name}`,
      changeId: c.change_id,
    })),
    ...d.parents
      .filter((e) => e.valid_from !== created || e.parent)
      .map((e) => ({
        key: `p${e.id}`,
        date: e.valid_from,
        title: '调整行政隶属',
        detail: `${e.view_name}：隶属${e.parent.name}`,
        changeId: e.change_id,
      })),
    ...d.relations.map((r) => ({
      key: `r${r.id}`,
      date: r.valid_from,
      title: `建立${DEPT_RELATION[r.kind as DeptRelationKind]}关系`,
      detail: `${r.from_department.name}${r.to_department ? ` → ${r.to_department.name}` : ''}：${r.scope}`,
      changeId: r.change_id,
    })),
    ...d.reorganizations.map((e) => {
      const names = (role: string) => e.participants.filter((p) => p.role === role).map((p) => p.department.name).join('、')
      return {
        key: `e${e.id}`,
        date: e.effective_date,
        title: `组织变更：${REORG_TITLE[e.event_type]}`,
        detail: `${names('SOURCE')} → ${names('RESULT')}（依据：${e.basis_note}）`,
        changeId: e.change_id,
      }
    }),
  ]
}

/** 沿革：每个组织变更事件一张图，写明依据、身份结论与承接范围；点部门跳到它 */
function ReorgHistory({ events, selfCode }: { events: ReorgEventOut[]; selfCode: string }) {
  const OUTCOME = { EXITS: '退出', NEW: '新设', CONTINUES: '存续' } as const
  return (
    <div className="grid gap-4">
      {events.map((e) => {
        const last = dayBefore(e.effective_date)
        const card = (p: ReorgEventOut['participants'][number]): FlowUnit => ({
          name: p.department.name,
          code: p.department.code,
          subtitle: p.scope_note ?? undefined,
          footer: p.outcome === 'EXITS' ? `最后有效日 ${last}` : p.outcome === 'NEW' ? `自 ${e.effective_date} 起` : '身份不变',
          tag: {
            label: p.department.code === selfCode ? `本部门 · ${OUTCOME[p.outcome]}` : OUTCOME[p.outcome],
            tone: p.outcome === 'EXITS' ? 'retire' : p.outcome === 'NEW' ? 'new' : 'current',
          },
          href: p.department.code === selfCode ? undefined : `/departments/${p.department.id}`,
        })
        const sources = e.participants.filter((p) => p.role === 'SOURCE')
        return (
          <div key={e.id} className="grid gap-1.5">
            <EvolveFlow
              kind={sources.length > 1 ? 'merge' : 'split'}
              day={e.effective_date}
              label={REORG_TITLE[e.event_type]}
              before={sources.map(card)}
              after={e.participants.filter((p) => p.role === 'RESULT').map(card)}
            />
            <p className="text-fg-muted text-caption">
              依据：{e.basis_note}；来源申请 <ChangeLink id={e.change_id} />
              {e.other_matters && <>；需其他系统办理：{e.other_matters}</>}。演变关系不是行政上下级。
            </p>
          </div>
        )
      })}
    </div>
  )
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** 按期间的关系表：当前与计划的行先列出，已结束的行收起，点开再看（统一规范 SC-05：当前值先展示，历史期间展开） */
function PeriodTable({
  head,
  rows,
  empty,
}: {
  head: string[]
  rows: { key: number; current: boolean; ended: boolean; cells: React.ReactNode[] }[]
  empty: string
}) {
  const [showEnded, setShowEnded] = useState(false)
  if (rows.length === 0) return <p className="text-fg-secondary text-xs">{empty}</p>
  const ended = rows.filter((r) => r.ended).length
  const visible = rows.filter((r) => showEnded || !r.ended)
  return (
    <div className="grid gap-1">
      {visible.length > 0 ? (
        <DbTable columns={head.map((label) => ({ label }))}>
          {visible.map((r) => (
            <DbRow key={r.key} className={cn(!r.current && 'text-fg-muted')}>
              {r.cells.map((c, i) => (
                <DbCell key={i} className="whitespace-nowrap">
                  {c}
                </DbCell>
              ))}
            </DbRow>
          ))}
        </DbTable>
      ) : (
        <p className="text-fg-secondary text-xs">查看日期当天及以后没有记录。</p>
      )}
      {ended > 0 && (
        <span>
          <InlineAction className="-ml-2" onClick={() => setShowEnded(!showEnded)}>{showEnded ? '收起已结束的记录' : `显示已结束的 ${ended} 条`}</InlineAction>
        </span>
      )}
    </div>
  )
}
