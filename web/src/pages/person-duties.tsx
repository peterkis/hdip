// 部门任职台账（A1，docs/人员域边界复审与实施计划.md 第 4 节）：全院部门负责人、副部长、主持工作、代管。
// 上半部分按部门看当天的负责人（与部门详情同一规则、同一组件），一眼看出空缺；
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
import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { period, today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { PLANNED_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

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
    active: ['dept', 'duty', 'mode', 'future'].some((k) => params.has(k)),
    clear: () => setParams(new URLSearchParams(), { replace: true }),
  }
}

type Dialog = { kind: 'assign' } | { kind: 'handover' | 'end'; row: DutyRegisterRow }

export function PersonDutiesPage() {
  const { asOf } = useApp()
  const { can } = useMe()
  const f = useDutyFilters()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<DbSort | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  // 台账与导出用同一组筛选
  const filters: Omit<ListPersonDutiesParams, 'as_of'> = {
    q: query.trim() || undefined,
    include_future: f.future,
    ...(f.dept && { department_id: Number(f.dept) }),
    ...(f.duty && { duty: f.duty as 'HEAD' | 'DEPUTY' }),
    ...(f.mode && { mode: f.mode as 'FORMAL' | 'ACTING' | 'CARETAKER' }),
  }
  const { data, isPending } = useListPersonDuties({ as_of: asOf, ...filters })
  const rows = useMemo(() => sortRows(data?.rows ?? [], sort), [data, sort])

  const exporting = useMutation({
    mutationFn: async () => downloadCsv('person-duties', asOf, filters),
    onSuccess: () => notify.success(`已导出 ${asOf} 的部门任职（${data?.rows.length ?? 0} 条）`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        icon={Briefcase01Icon}
        title="部门任职"
        description={`按 ${asOf} 当天登记已确定的任命结果：部长、副部长、主持工作与代管。不办理任命决策；职务不等于系统权限，也不是 HR 岗位或职级。`}
        actions={
          <>
            {can('person.export') && (
              <Button variant="ghost" disabled={exporting.isPending} onClick={() => exporting.mutate()} title="按当前筛选导出台账，一行一条职务">
                <Icon icon={Download01Icon} inline="start" />
                导出台账
              </Button>
            )}
            {can('person.change') && (
              <Button onClick={() => setDialog({ kind: 'assign' })}>
                <Icon icon={Add01Icon} inline="start" />
                任命职务
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-10">
        <Leaders rows={data?.leaders ?? []} />

        <Section title="任职台账">
          <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="姓名、拼音码、代码、工号或部门名称" />}>
            <FilterPill
              label="任职部门"
              icon={UserGroupIcon}
              value={f.dept}
              onChange={(v) => f.set('dept', v)}
              options={departments.map((d) => ({ value: String(d.id), label: d.version.name }))}
            />
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

          {!isPending && rows.length === 0 ? (
            <DbEmpty
              title={query || f.active ? '没有符合条件的职务' : `${asOf} 没有登记部门职务`}
              hint="职务在人员详情或部门详情“人员”标签里任命；这里统一查询。"
            />
          ) : (
            <DbTable
              columns={[
                { label: '任职部门', icon: UserGroupIcon, sortKey: 'dept', className: 'min-w-32' },
                { label: '职务', icon: Briefcase01Icon, sortKey: 'duty' },
                { label: '姓名', icon: TextFontIcon, sortKey: 'name', className: 'min-w-28' },
                { label: '主部门', icon: UserGroupIcon, sortKey: 'primary' },
                { label: '任用', icon: Hospital01Icon },
                { label: '任职期间', icon: Calendar03Icon, sortKey: 'from' },
                { label: '依据' },
                { label: '申请' },
              ]}
              sort={sort}
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              {rows.map((r) => (
                <DutyRow key={r.duty_id} r={r} onAction={can('person.change') ? (kind) => setDialog({ kind, row: r }) : undefined} />
              ))}
            </DbTable>
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
    <DbRow className={cn(r.not_yet_effective && 'text-fg-muted')}>
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
        <Link className="text-fg-strong hover:underline" to={`/persons/${r.person_id}`}>
          {r.person_name}
        </Link>
        <span className="text-fg-muted ml-1.5 font-mono text-caption">{r.person_code}</span>
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
      <DbCell className="max-w-56 truncate">
        <DutyBasis note={r.basis_note} />
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

/** 负责人一览：有负责人的部门一张小卡；空缺的部门收成一组虚线小标签，一眼能看出来 */
function Leaders({ rows }: { rows: DepartmentLeaderRow[] }) {
  const { asOf } = useApp()
  const filled = rows.filter((r) => r.heads.length > 0)
  const vacant = rows.filter((r) => r.heads.length === 0)
  const presiding = filled.filter((r) => r.heads.some((h) => h.mode !== 'FORMAL'))
  const stats = [
    { label: '部门', value: rows.length },
    { label: '有负责人', value: filled.length },
    { label: '由他人主持 / 代管', value: presiding.length },
    { label: '空缺', value: vacant.length, warn: vacant.length > 0 },
  ]
  return (
    <Section title={`部门负责人（${asOf}）`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="border-line-subtle rounded-md border px-3 py-2">
            <div className="text-fg-muted text-caption">{s.label}</div>
            <div className={cn('text-lg font-semibold tabular-nums', s.warn ? 'text-warning-text' : 'text-fg-strong')}>{s.value}</div>
          </div>
        ))}
      </div>
      {filled.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filled.map((r) => (
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
      {vacant.length > 0 && (
        <div className="grid gap-1.5">
          <div className="text-fg-muted text-caption">空缺（{vacant.length}）</div>
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
      {rows.length === 0 && <p className="text-fg-muted text-xs">当天没有正式履职的部门。</p>}
      <p className="text-fg-muted text-caption">
        列出当天正式履职的部门（及当天有部长职务的部门）。有主持工作或代管者时显示主持者并注明部长，与部门详情的“当前负责人”同一规则。空缺 = 没有登记部长职务，不等于院方确认不设。
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
