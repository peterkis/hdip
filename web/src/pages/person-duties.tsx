// 部门任职台账（A1，docs/人员域边界复审与实施计划.md 第 4 节）：全院部门负责人、副部长、主持工作、代管。
// 上半部分按部门看当天的负责人（与部门详情同一规则、同一组件），一眼看出哪些部门未登记负责人；
// 下半部分一行一条职务，附此人当天的主部门（代管时两者不同）。导出与台账同日期、同筛选。
// 登记的是已确定的任命结果；不办理任命决策，职务不等于系统权限。
import {
  Add01Icon,
  Briefcase01Icon,
  Calendar03Icon,
  Download01Icon,
  Hospital01Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useListDepartments } from '@/api/generated/master/master'
import type { DepartmentLeaderRow, DutyRegisterRow, ListPersonDutiesParams } from '@/api/generated/model'
import { useListPersonDuties } from '@/api/generated/persons/persons'
import { DepartmentLeader, DutyBasis } from '@/components/department-persons'
import { EngagementTypeTag } from '@/components/engagement-type-tag'
import { DutyAssignDialog, DutyEndDialog, DutyHandoverDialog, dutyRefFromDept } from '@/components/forms/person-forms'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, nextSort, SearchBox, ToggleChip, type DbSort } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { ChangeLink, InlineAction, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { period, today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { PLANNED_TONE } from '@/lib/tones'
import { isSort, isString, useListReturn, useReturnState } from '@/lib/scroll-memory'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'
import { ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'

const DUTY = { HEAD: '部长', DEPUTY: '副部长' } as const
const MODE = { FORMAL: '正式', ACTING: '主持工作 / 代理', CARETAKER: '代管' } as const

function useDutyFilters() {
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
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
  return {
    dept: get('dept'),
    duty: get('duty'),
    mode: get('mode'),
    future: get('future') === '1',
    set,
    key: params.toString(),
    // 任职部门是负责人一览与台账的共同范围，台账的“清除筛选”不改它（U3R-05）
    active: ['duty', 'mode', 'future'].some((k) => params.has(k)),
    clear: () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams()
          if (prev.get('dept')) next.set('dept', prev.get('dept')!)
          return next
        },
        { replace: true },
      ),
  }
}

type Dialog = { kind: 'assign' } | { kind: 'handover' | 'end'; row: DutyRegisterRow }

export function PersonDutiesPage() {
  usePageFrame('work')
  const { asOf } = useApp()
  const { can } = useMe()
  const f = useDutyFilters()
  // 检索词与排序是本页状态：从详情返回时取回，不写进网址（U3R-05）
  const [query, setQuery] = useReturnState('q', '', isString)
  const [sort, setSort] = useReturnState<DbSort | null>('sort', null, isSort)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const deptQuery = useListDepartments({ as_of: asOf })
  const departments = deptQuery.data ?? []
  // 台账与导出用同一组筛选
  const filters: Omit<ListPersonDutiesParams, 'as_of'> = {
    q: query.trim() || undefined,
    include_future: f.future,
    ...(f.dept && { department_id: Number(f.dept) }),
    ...(f.duty && { duty: f.duty as 'HEAD' | 'DEPUTY' }),
    ...(f.mode && { mode: f.mode as 'FORMAL' | 'ACTING' | 'CARETAKER' }),
  }
  // 读取状态（U3R-03）：负责人一览与台账同一次读取；未成功时不写 0、不列“未登记负责人”
  const list = useListPersonDuties({ as_of: asOf, ...filters })
  const status = readStatus(list)
  const data = status === 'ready' ? list.data : undefined
  const rows = useMemo(() => sortRows(data?.rows ?? [], sort), [data, sort])
  // 返回上下文：集合范围 = 查看日期 + 共同范围与筛选 + 检索词
  const back = useListReturn({ scope: `${asOf}|${f.key}|${query.trim()}`, ready: status === 'ready', local: { q: query, sort } })
  const pendingBody =
    status === 'loading' ? <ReadLoading label="正在读取部门任职…" /> : status === 'error' ? <ReadError what="部门任职" query={list} /> : null

  const exporting = useMutation({
    mutationFn: async () => downloadCsv('person-duties', asOf, filters),
    onSuccess: () => notify.success(`已导出 ${asOf} 的部门任职（${data?.rows.length ?? 0} 条）`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="部门任职"
        description={`按 ${asOf} 当天登记已确定的任命结果：部长、副部长、主持工作与代管。不办理任命决策；职务不等于系统权限，也不是 HR 岗位或职级。`}
        actions={
          <>
            {can('person.export') && (
              <Button variant="ghost" disabled={exporting.isPending || status !== 'ready'} onClick={() => exporting.mutate()} title="按当前筛选导出台账，一行一条职务">
                <Icon icon={Download01Icon} inline="start" />
                导出台账
              </Button>
            )}
            {can('person.change') && (
              <Button onClick={() => setDialog({ kind: 'assign' })}>
                <Icon icon={Add01Icon} inline="start" />
                登记任职
              </Button>
            )}
          </>
        }
      />

      {/* SC-15：任职部门同时影响负责人一览与台账，放在两区之前作为共同范围 */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-fg-secondary">共同范围</span>
        <FilterPill
          label="任职部门"
          icon={UserGroupIcon}
          value={f.dept}
          onChange={(v) => f.set('dept', v)}
          options={departments.map((d) => ({ value: String(d.id), label: d.version.name }))}
          optionsStatus={readStatus(deptQuery)}
        />
        <span className="text-fg-muted text-caption">查看日期 {asOf}；任职部门同时作用于负责人一览和台账，不含下级部门</span>
      </div>
      <StaleNotice what="部门任职" query={list} />
      <div className="grid gap-8">
        <Leaders rows={data ? data.leaders : null} department={f.dept ? departments.find((d) => String(d.id) === f.dept)?.version.name : undefined} />

        <Section title="任职台账">
          <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="姓名、拼音码、代码、工号或部门名称" />}>
            <FilterPill
              label="职务"
              icon={Briefcase01Icon}
              value={f.duty}
              onChange={(v) => f.set('duty', v)}
              options={Object.entries(DUTY).map(([value, label]) => ({ value, label }))}
            />
            <FilterPill label="方式" value={f.mode} onChange={(v) => f.set('mode', v)} options={Object.entries(MODE).map(([value, label]) => ({ value, label }))} />
            <ToggleChip label="含计划中" checked={f.future} onChange={(v) => f.set('future', v ? '1' : '')} />
            {f.active && (
              <Button variant="ghost" size="sm" className="text-fg-muted" onClick={f.clear}>
                清除筛选
              </Button>
            )}
          </DbToolbar>

          {pendingBody ? (
            pendingBody
          ) : rows.length === 0 ? (
            <DbEmpty
              title={query || f.active ? '没有符合条件的职务' : `${asOf} 没有登记部门职务`}
              hint="职务在人员详情或部门详情“人员”标签里任命；这里统一查询。"
            />
          ) : (
            <div onClickCapture={back.onClickCapture}>
            <DbTable
              columns={[
                // SC-15：任职部门 / 职务与方式 / 人员（代码在辅助行）/ 当前主部门 / 任用主体与类型 / 任职期间 / 依据 / 来源申请与行内动作
                { label: '任职部门', icon: UserGroupIcon, sortKey: 'dept', className: 'min-w-32' },
                { label: '职务与方式', icon: Briefcase01Icon, sortKey: 'duty' },
                { label: '人员', icon: TextFontIcon, sortKey: 'name', className: 'min-w-28' },
                { label: '当前主部门', icon: UserGroupIcon, sortKey: 'primary' },
                { label: '任用主体与类型', icon: Hospital01Icon },
                { label: '任职期间', icon: Calendar03Icon, sortKey: 'from' },
                { label: '依据', className: 'min-w-40' },
                { label: '来源申请' },
              ]}
              sort={sort}
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              {rows.map((r) => (
                <DutyRow key={r.duty_id} r={r} onAction={can('person.change') ? (kind) => setDialog({ kind, row: r }) : undefined} />
              ))}
            </DbTable>
            </div>
          )}
          {data && (
            <DbFooter>
              <span>
                当天 <span className="text-fg-secondary">{data.record_count}</span> 条职务、
                <span className="text-fg-secondary">{data.person_count}</span> 人
                {data.planned_count > 0 && <>；计划中 {data.planned_count} 条（不计入当天）</>}
              </span>
              <span>一人兼两职记两条、算一人；按任职部门筛选不含下级部门</span>
            </DbFooter>
          )}
        </Section>
      </div>

      {dialog?.kind === 'assign' && <DutyAssignDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === 'handover' && (
        <DutyHandoverDialog open onOpenChange={(o) => !o && setDialog(null)} duty={dutyRefFromDept(dialog.row, dialog.row.department.name)} />
      )}
      {dialog?.kind === 'end' && <DutyEndDialog open onOpenChange={(o) => !o && setDialog(null)} duty={dutyRefFromDept(dialog.row, dialog.row.department.name)} />}
    </>
  )
}

function DutyRow({ r, onAction }: { r: DutyRegisterRow; onAction?: (kind: 'handover' | 'end') => void }) {
  // 代管或兼任：任职部门不是此人的主部门，标清楚
  const elsewhere = r.primary_department && r.primary_department.id !== r.department.id
  return (
    <DbRow returnId={r.duty_id} className={cn(r.not_yet_effective && 'text-fg-muted')}>
      <DbCell>
        <Link className="text-fg-strong font-medium hover:underline" to={`/departments/${r.department.id}`}>
          {r.department.name}
        </Link>
      </DbCell>
      <DbCell className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <Tag tone={r.mode === 'FORMAL' ? 'blue' : 'orange'}>{r.label}</Tag>
          {r.not_yet_effective && <Tag tone={PLANNED_TONE}>{r.valid_from} 起</Tag>}
        </span>
      </DbCell>
      <DbCell className="whitespace-nowrap">
        <span className="grid gap-0.5">
          <Link className="text-fg-strong hover:underline" to={`/persons/${r.person_id}`}>
            {r.person_name}
          </Link>
          <span className="text-fg-muted font-mono text-caption select-all">{r.person_code}</span>
        </span>
      </DbCell>
      <DbCell className="whitespace-nowrap">
        {r.primary_department ? (
          <span className={cn('inline-flex items-center gap-1.5', elsewhere ? 'text-fg-secondary' : 'text-fg-muted')}>
            <Link className="hover:underline" to={`/departments/${r.primary_department.id}`}>
              {r.primary_department.name}
            </Link>
            {elsewhere && <Tag tone="gray">非任职部门</Tag>}
          </span>
        ) : (
          <Tag tone="yellow">暂未分配</Tag>
        )}
      </DbCell>
      <DbCell className="text-fg-secondary whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          {r.institution_name}
          <EngagementTypeTag code={r.engagement_type} />
        </span>
      </DbCell>
      <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">{period(r.valid_from, r.valid_to)}</DbCell>
      <DbCell className="max-w-56">
        <DutyBasis note={r.basis_note} expandable />
      </DbCell>
      <DbCell className="whitespace-nowrap">
        <ChangeLink id={r.change_id} />
        {onAction && (!r.valid_to || r.valid_to >= today()) && (
          <>
            <InlineAction onClick={() => onAction('handover')}>交接</InlineAction>
            <InlineAction onClick={() => onAction('end')}>结束</InlineAction>
          </>
        )}
      </DbCell>
    </DbRow>
  )
}

/** 负责人一览：有负责人的部门一张小卡；未登记负责人的部门收成一组虚线小标签。
 *  只受“任职部门”筛选影响（职务、方式、检索词、含计划只作用于下方台账） */
const LEADER_FOLD = 9

/** rows 为 null：任职尚未读取成功——统计写“—”，不列有负责人 / 未登记负责人（读取状态在下方台账里说明） */
function Leaders({ rows, department }: { rows: DepartmentLeaderRow[] | null; department?: string }) {
  const { asOf } = useApp()
  // 部门多时负责人卡片默认折叠，不把台账挤出几屏；折叠只影响展示，统计不变（SC-15）
  const [allShown, setAllShown] = useState(false)
  const known = rows !== null
  const filled = (rows ?? []).filter((r) => r.heads.length > 0)
  const vacant = (rows ?? []).filter((r) => r.heads.length === 0)
  const presiding = filled.filter((r) => r.heads.some((h) => h.mode !== 'FORMAL'))
  const stats = [
    { label: '部门', value: (rows ?? []).length },
    { label: '有负责人', value: filled.length },
    { label: '由他人主持 / 代管', value: presiding.length },
    { label: '未登记负责人', value: vacant.length, warn: known && vacant.length > 0 },
  ]
  return (
    <Section
      title={`部门负责人（${asOf}）`}
      action={<span className="text-fg-muted text-caption">{department ? `范围：${department}` : '范围：全院'} · 只看当天，不受职务、方式、检索与“含计划”影响</span>}
    >
      {/* 一个容器、分隔线隔开的连续统计条（R-VIS 03） */}
      <div className="border-line-subtle divide-line-subtle grid grid-cols-2 divide-x rounded-lg border sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <div className="text-fg-muted text-caption">{s.label}</div>
            <div className={cn('text-lg font-semibold tabular-nums', s.warn ? 'text-warning-text' : 'text-fg-strong')}>
              {known ? s.value : <Unknown reason="部门任职尚未读取成功" />}
            </div>
          </div>
        ))}
      </div>
      {filled.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(allShown ? filled : filled.slice(0, LEADER_FOLD)).map((r) => (
            <div key={r.department.id} className="border-line-subtle bg-surface-subtle grid gap-1 rounded-md border px-3 py-2">
              <Link className="text-fg-strong truncate text-xs font-medium hover:underline" to={`/departments/${r.department.id}`}>
                {r.department.name}
              </Link>
              <div className="text-xs">
                <DepartmentLeader duties={r.heads} />
              </div>
            </div>
          ))}
        </div>
      )}
      {filled.length > LEADER_FOLD && (
        <Button variant="ghost" size="sm" className="text-fg-muted justify-self-start" onClick={() => setAllShown(!allShown)}>
          {allShown ? '收起' : `展开全部 ${filled.length} 个有负责人的部门`}
        </Button>
      )}
      {vacant.length > 0 && (
        <div className="grid gap-1.5">
          <div className="text-fg-muted text-caption">未登记负责人（{vacant.length}）</div>
          <div className="flex flex-wrap gap-1.5">
            {vacant.map((r) => (
              <Link
                key={r.department.id}
                to={`/departments/${r.department.id}`}
                className="border-line-strong text-fg-secondary hover:bg-surface-hover rounded-md border border-dashed px-2 py-0.5 text-xs"
              >
                {r.department.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {known && rows.length === 0 && <p className="text-fg-muted text-xs">当天没有正式履职的部门。</p>}
      {!known && <p className="text-fg-muted text-xs">负责人一览与下方台账同一次读取，读取成功后显示。</p>}
      <p className="text-fg-muted text-caption">
        列出当天正式履职的部门（及当天有部长职务的部门）。有主持工作或代管者时显示主持者并注明部长，与部门详情的“当前负责人”同一规则。未登记负责人 = 平台里没有登记当天的部长职务，不等于院方确认不设。
      </p>
    </Section>
  )
}

const zh = new Intl.Collator('zh-Hans-CN')

function sortRows(rows: DutyRegisterRow[], sort: DbSort | null): DutyRegisterRow[] {
  if (!sort) return rows
  const key: Record<string, (r: DutyRegisterRow) => string | undefined> = {
    dept: (r) => r.department.name,
    duty: (r) => r.label,
    name: (r) => r.person_name,
    primary: (r) => r.primary_department?.name,
    from: (r) => r.valid_from,
  }
  const get = key[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1
    return sign * zh.compare(x, y)
  })
}
