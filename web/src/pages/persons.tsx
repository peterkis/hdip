// 人员名册与人员详情（人员设计第 7.2 节）。
// 名册每人一行（按人去重），任用与当天的主部门、工号作为子项；状态由查看日期的任用派生。
// 详情按任用分段显示工号与部门归属的历史；姓名版本单独一条时间线（更名、更正误录分开标出）。
import {
  Add01Icon,
  Briefcase01Icon,
  Calendar03Icon,
  Download01Icon,
  HashtagIcon,
  Loading03Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useListDepartments } from '@/api/generated/master/master'
import type {
  EngagementEndChange,
  PersonAssignmentOut,
  PersonDetail,
  PersonDutyOut,
  PersonEngagementOut,
  PersonRow,
} from '@/api/generated/model'
import { useGetPerson, useListPersons } from '@/api/generated/persons/persons'
import {
  AssignDialog,
  AssignmentEndDialog,
  DutyAssignDialog,
  DutyEndDialog,
  DutyHandoverDialog,
  dutyRefFromPerson,
  EngagementEndDialog,
  PersonEngageDialog,
  PersonNameDialog,
  PersonRegisterDialog,
  TransferDialog,
  WorkNoDialog,
} from '@/components/forms/person-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, nextSort, SearchBox, ToggleChip, type DbSort } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { DetailFallback } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { ChangeLink, InlineAction, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Segmented } from '@/components/kit/segmented'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Timeline, type TimelineEvent } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { DEPARTMENT_LIFECYCLE, period, SENSITIVE_FIELD, stamp, today } from '@/lib/format'
import { notify } from '@/lib/notify'
import { NAME_REASON, PERSON_STATUS, PERSON_STATUS_TONE, primaryOn, WORK_NO_REASON } from '@/lib/person'
import { DEPARTMENT_LIFECYCLE_TONE, PLANNED_TONE } from '@/lib/tones'
import { EngagementTypeTag } from '@/components/engagement-type-tag'
import { DutyBasis } from '@/components/department-persons'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

// ================================================================== 名册
const ALL_NO_EXPORT = '“全部人员”是查重视图，不按日期，不能导出；取消后按查看日期导出'

function useRosterFilters() {
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
    status: get('status'),
    // 含仅有计划任用的人（下月入职等）
    future: get('future') === '1',
    // 全部人员：含已离开、未来入职、无有效任用的人（查重、回查用）
    all: get('scope') === 'all',
    set,
    active: ['dept', 'status', 'future', 'scope'].some((k) => params.has(k)),
    clear: () => setParams(new URLSearchParams(), { replace: true }),
  }
}

export function PersonsPage() {
  usePageFrame('work')
  const { asOf, optionLabels } = useApp()
  const { can } = useMe()
  const f = useRosterFilters()
  const [query, setQuery] = useState('')
  const [registering, setRegistering] = useState(false)
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  // 名册与导出用同一组筛选：导出的行与页面一致
  const filters = {
    q: query.trim() || undefined,
    include_future: f.future,
    ...(f.status && { status: f.status as PersonRow['status'] }),
    ...(f.dept && { department_id: Number(f.dept) }),
  }
  const { data: rows = [], isPending } = useListPersons({ as_of: asOf, scope: f.all ? 'all' : 'as_of', ...filters })
  const types = optionLabels.engagement_type ?? {}
  const [sort, setSort] = useState<DbSort | null>(null)
  const sorted = useMemo(() => sortRows(rows, sort, types), [rows, sort, types])

  const exporting = useMutation({
    mutationFn: async (dataset: 'persons' | 'person-relations') => downloadCsv(dataset, asOf, filters),
    onSuccess: () => notify.success(`已导出 ${asOf} 的人员数据（${f.active || query.trim() ? '按当前筛选，' : ''}${rows.length} 人）`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="人员名册"
        description={`人员 × 任用 × 部门归属。按 ${asOf} 当天的任用显示，一人一行；不含账号、资质与执业信息。`}
        actions={
          <>
            {can('person.export') && (
              <>
                <Button
                  variant="ghost"
                  disabled={exporting.isPending || f.all}
                  onClick={() => exporting.mutate('persons')}
                  title={f.all ? ALL_NO_EXPORT : '按当前筛选导出，与页面同一批人，一人一行'}
                >
                  <Icon icon={Download01Icon} inline="start" />
                  导出名册（一人一行）
                </Button>
                <Button
                  variant="ghost"
                  disabled={exporting.isPending || f.all}
                  onClick={() => exporting.mutate('person-relations')}
                  title={f.all ? ALL_NO_EXPORT : '按当前筛选导出页面上的任用与主部门，一行一项任用'}
                >
                  <Icon icon={Download01Icon} inline="start" />
                  导出任用与归属（一项任用一行）
                </Button>
              </>
            )}
            {can('person.change') && (
              <Button onClick={() => setRegistering(true)}>
                <Icon icon={Add01Icon} inline="start" />
                登记人员
              </Button>
            )}
          </>
        }
      />

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="姓名、曾用名、拼音码、代码或工号" />}>
        {/* SC-13：按日期的名册与不看日期的查重是两种互斥视角 */}
        <Segmented
          label="视角"
          value={f.all ? 'all' : 'roster'}
          onChange={(v) => f.set('scope', v === 'all' ? 'all' : '')}
          options={[
            { value: 'roster', label: `按日期名册（${asOf}）` },
            { value: 'all', label: '全部人员（查重，不看日期）' },
          ]}
        />
        <span aria-hidden className="bg-line mx-1 h-4 w-px" />
        <FilterPill
          label="主部门"
          icon={UserGroupIcon}
          value={f.dept}
          onChange={(v) => f.set('dept', v)}
          options={departments.map((d) => ({ value: String(d.id), label: d.version.name }))}
        />
        {!f.all && (
          <FilterPill
            label="状态"
            icon={Loading03Icon}
            value={f.status}
            onChange={(v) => f.set('status', v)}
            options={Object.entries(PERSON_STATUS).map(([value, label]) => ({ value, label }))}
          />
        )}
        {!f.all && <ToggleChip label="含计划中" checked={f.future} onChange={(v) => f.set('future', v ? '1' : '')} />}
        {f.active && (
          <Button variant="ghost" size="sm" className="text-fg-muted" onClick={f.clear}>
            清除筛选
          </Button>
        )}
      </DbToolbar>

      {!isPending && rows.length === 0 ? (
        <DbEmpty
          title={query || f.active ? '没有符合条件的人员' : `${asOf} 没有有效任用的人员`}
          hint={
            query && !f.all ? (
              <button type="button" className="hover:text-fg underline" onClick={() => f.set('scope', 'all')}>
                在全部人员（含已离开、未来入职）里查找
              </button>
            ) : (
              '登记人员后经提交、确认才会出现在这里。'
            )
          }
        />
      ) : (
        <DbTable
          columns={[
            // SC-13：姓名（人员代码在辅助行）/ 任用 / 主部门 / 业务工号 / 任用期间；多项任用在各列逐项对齐
            { label: '姓名', icon: TextFontIcon, className: 'min-w-36', sortKey: 'name' },
            { label: '任用', icon: Briefcase01Icon, sortKey: 'type' },
            { label: '主部门', icon: UserGroupIcon, sortKey: 'dept' },
            { label: '业务工号', icon: HashtagIcon, sortKey: 'work_no' },
            { label: '任用期间', icon: Calendar03Icon, sortKey: 'from' },
          ]}
          sort={sort}
          onSort={(key) => setSort(nextSort(sort, key))}
        >
          {sorted.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline" to={`/persons/${r.id}`}>
                      {r.name}
                    </Link>
                    {r.status !== 'ENGAGED' && <Tag tone={PERSON_STATUS_TONE[r.status]}>{PERSON_STATUS[r.status]}</Tag>}
                  </span>
                  <span className="text-fg-muted text-caption">
                    <span className="font-mono select-all">{r.code}</span>
                    {r.matched && <> · 命中 {r.matched}</>}
                  </span>
                </span>
              </DbCell>
              <Stacked rows={r} render={(e) => <EngagementTypeTag code={e.engagement_type} />} />
              <Stacked
                rows={r}
                render={(e) =>
                  e.department ? (
                    <Link className="hover:underline" to={`/departments/${e.department.id}`}>
                      {e.department.name}
                    </Link>
                  ) : (
                    <Tag tone="yellow">暂未分配</Tag>
                  )
                }
              />
              <Stacked rows={r} mono render={(e) => e.work_no ?? <span className="text-fg-muted font-sans">未登记</span>} />
              <Stacked rows={r} render={(e) => period(e.valid_from, e.valid_to)} />
            </DbRow>
          ))}
        </DbTable>
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{rows.length}</span> 人
        </span>
        <span>
          {f.all ? '全部人员，不看日期，不能导出' : `${asOf} 当天有效任用的人${f.future ? '，含计划中' : ''}`}；一人多项任用仍算一人
        </span>
      </DbFooter>
      {registering && <PersonRegisterDialog open onOpenChange={setRegistering} />}
    </>
  )
}

const zh = new Intl.Collator('zh-Hans-CN')

/** 名册按表头排序：多项任用时按第一项（与格子里第一行一致）；空值排在最后 */
function sortRows(rows: PersonRow[], sort: DbSort | null, types: Record<string, string>): PersonRow[] {
  if (!sort) return rows
  const first = (r: PersonRow) => r.engagements[0]
  const key: Record<string, (r: PersonRow) => string | undefined> = {
    name: (r) => r.name,
    code: (r) => r.code,
    type: (r) => (first(r) ? (types[first(r).engagement_type] ?? first(r).engagement_type) : undefined),
    dept: (r) => first(r)?.department?.name,
    work_no: (r) => first(r)?.work_no ?? undefined,
    from: (r) => first(r)?.valid_from,
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

/** 一人多项任用时，在同一格里上下排列 */
function Stacked({
  rows,
  render,
  mono,
}: {
  rows: PersonRow
  render: (e: PersonRow['engagements'][number]) => React.ReactNode
  mono?: boolean
}) {
  if (rows.engagements.length === 0) return <DbCell className="text-fg-disabled">—</DbCell>
  return (
    <DbCell className={cn('text-fg-secondary whitespace-nowrap', mono && 'font-mono text-caption')}>
      <span className="grid gap-1">
        {rows.engagements.map((e) => (
          <span key={e.id} className={cn(e.not_yet_effective && 'text-fg-muted')}>
            {render(e)}
          </span>
        ))}
      </span>
    </DbCell>
  )
}

// ================================================================== 详情
const covers = (from: string, to: string | null | undefined, day: string) => from <= day && (!to || to >= day)

export function PersonDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { can } = useMe()
  const query = useGetPerson(id, { as_of: asOf })
  const { data } = query
  const [engaging, setEngaging] = useState(false)
  const [dialog, setDialog] = useState<PersonDialog | null>(null)
  useCrumb(data && `${data.code} ${data.name}`)
  if (!data) return <DetailFallback what="人员" back={{ to: '/persons', label: '返回人员名册' }} query={query} invalid={!Number.isInteger(id)} />

  const close = (o: boolean) => !o && setDialog(null)
  const live = data.engagements.filter((e) => !e.void)
  const current = live.filter((e) => covers(e.valid_from, e.valid_to, asOf))
  const formerNames = data.versions.filter((v, i) => !v.void && i > 0 && data.versions[i - 1].revise_reason === 'RENAME')
  // 没有任用记录与查看日期当天没有有效任用分开说（统一规范 SC-14）
  const noCurrent = (
    <span className="text-fg-muted">{live.length ? '查看日期当天没有有效任用' : '没有任用记录'}</span>
  )

  // 统一规范 SC-14：姓名 / 人员代码 → 当前身份与关系摘要 → 每项任用一个分区 → 姓名历史。
  // 页头只有两个次级动作（改姓名、建立任用），不强推主按钮；任用级动作在任用分区标题右侧，调科、结束、交接在对应行
  return (
    <>
      <PageHeader
        title={data.name}
        description={
          <>
            人员代码 <span className="font-mono">{data.code}</span>（系统分配、永不改变，与业务工号无关）· 按查看日期 {asOf} 显示
          </>
        }
        actions={
          can('person.change') && (
            <>
              <Button variant="outline" onClick={() => setDialog({ kind: 'name' })}>
                改姓名
              </Button>
              <Button variant="outline" onClick={() => setEngaging(true)}>
                建立任用（再次任用）
              </Button>
            </>
          )
        }
      />
      <PropertyList
        items={[
          { label: '状态', value: <Tag tone={PERSON_STATUS_TONE[data.status]}>{PERSON_STATUS[data.status]}</Tag> },
          {
            label: '当前任用',
            value: current.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {current.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1.5">
                    {e.institution_name}
                    <EngagementTypeTag code={e.engagement_type} />
                  </span>
                ))}
              </span>
            ) : (
              noCurrent
            ),
          },
          {
            label: '当前主部门',
            value: current.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {current.map((e) => {
                  const a = primaryOn(e.assignments, asOf)
                  return a ? (
                    <Link key={e.id} className="hover:underline" to={`/departments/${a.department.id}`}>
                      {a.department.name}
                    </Link>
                  ) : (
                    <Tag key={e.id} tone="yellow">
                      暂未分配
                    </Tag>
                  )
                })}
              </span>
            ) : (
              noCurrent
            ),
          },
          {
            label: '当前业务工号',
            value: current.length
              ? current
                  .map((e) => e.work_nos.find((n) => !n.void && covers(n.valid_from, n.valid_to, asOf))?.work_no)
                  .filter(Boolean)
                  .join('、') || null
              : noCurrent,
          },
          { label: '曾用名', value: formerNames.map((v) => v.name).join('、') || null },
          { label: '拼音码', value: data.pinyin && <span className="font-mono">{data.pinyin}</span> },
        ]}
      />
      {(data.masked_fields ?? []).length > 0 && (
        <div className="mt-4">
          <Callout tone="neutral" title="部分信息无权查看">
            你没有“查看人员敏感信息”的权限，{(data.masked_fields ?? []).map((f) => SENSITIVE_FIELD[f] ?? f).join('、')}不显示。
          </Callout>
        </div>
      )}

      <div className="mt-8 grid gap-8">
        <Section title={`任用与部门归属（${live.length}）`}>
          {data.engagements.length === 0 ? (
            <p className="text-fg-secondary text-xs">没有任用记录。人员身份保留；建立任用后再登记部门归属与工号。</p>
          ) : (
            <div className="grid gap-4">
              {data.engagements.map((e) => (
                <EngagementCard key={e.id} e={e} asOf={asOf} onAction={can('person.change') ? setDialog : undefined} />
              ))}
            </div>
          )}
        </Section>
        <Section title="姓名历史">
          <Timeline events={nameEvents(data)} asOf={asOf} order="desc" />
        </Section>
      </div>
      {engaging && <PersonEngageDialog open onOpenChange={setEngaging} personCode={data.code} name={data.name} />}
      {dialog?.kind === 'name' && <PersonNameDialog open onOpenChange={close} person={data} />}
      {dialog?.kind === 'work_no' && <WorkNoDialog open onOpenChange={close} engagement={dialog.engagement} />}
      {dialog?.kind === 'duty_assign' && <DutyAssignDialog open onOpenChange={close} engagement={dialog.engagement} />}
      {dialog?.kind === 'duty_handover' && <DutyHandoverDialog open onOpenChange={close} duty={dutyRefFromPerson(dialog.duty, data.name)} />}
      {dialog?.kind === 'duty_end' && <DutyEndDialog open onOpenChange={close} duty={dutyRefFromPerson(dialog.duty, data.name)} />}
      {dialog?.kind === 'engagement_end' && <EngagementEndDialog open onOpenChange={close} person={data.name} engagement={dialog.engagement} />}
      {dialog?.kind === 'assign' && <AssignDialog open onOpenChange={close} engagement={dialog.engagement} />}
      {dialog?.kind === 'transfer' && <TransferDialog open onOpenChange={close} person={data.name} assignment={dialog.assignment} />}
      {dialog?.kind === 'end' && <AssignmentEndDialog open onOpenChange={close} person={data.name} assignment={dialog.assignment} />}
    </>
  )
}

type PersonDialog =
  | { kind: 'name' }
  | { kind: 'work_no' | 'assign' | 'engagement_end' | 'duty_assign'; engagement: PersonEngagementOut }
  | { kind: 'duty_handover' | 'duty_end'; duty: PersonDutyOut }
  | { kind: 'transfer' | 'end'; assignment: PersonAssignmentOut }

/** 还能调整的一段：未撤销，结束日为空或尚未过去（结束日到达前可改，人员设计 P-3） */
const adjustable = (r: { void: boolean; valid_to?: string | null }) => !r.void && (!r.valid_to || r.valid_to >= today())

/** 一项任用一个分区：标题写任用主体、类型、状态、期间与来源申请，右侧是任用级动作；
 *  正文依次是主部门、附加归属、部门职务、业务工号，各段的开始 / 结束日分开写；已结束、已撤销的段收起 */
function EngagementCard({ e, asOf, onAction }: { e: PersonEngagementOut; asOf: string; onAction?: (d: PersonDialog) => void }) {
  const state = e.void
    ? { label: '生效前已撤销', tone: 'gray' as const }
    : e.valid_from > asOf
      ? { label: '计划中', tone: PLANNED_TONE }
      : e.valid_to && e.valid_to < asOf
        ? { label: '已结束', tone: 'gray' as const }
        : { label: '有效', tone: 'green' as const }
  const duties = e.duties ?? []
  // 任用本身已结束或已撤销时，它下面的段都是历史，全部列出，不再收起
  const fold = !e.void && !(e.valid_to && e.valid_to < asOf)
  return (
    <section className="border-line rounded-lg border" aria-label={`${e.institution_name} 任用`}>
      <header className="border-line-subtle flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-4 py-3">
        <div className="grid min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn('font-semibold', e.void ? 'text-fg-secondary' : 'text-fg-strong')}>{e.institution_name}</span>
            <EngagementTypeTag code={e.engagement_type} />
            <Tag tone={state.tone}>{state.label}</Tag>
          </span>
          <span className="text-fg-secondary flex flex-wrap items-center gap-x-2 text-caption">
            <span className="tabular-nums">任用期间 {e.void ? `${e.valid_from} 起（生效前已撤销，未生效）` : period(e.valid_from, e.valid_to)}</span>
            <span>
              来源申请 <ChangeLink id={e.change_id} />
              {e.closed_change_id && (
                <>
                  ，结束登记 <ChangeLink id={e.closed_change_id} />
                </>
              )}
            </span>
            {e.note && <span>· {e.note}</span>}
          </span>
        </div>
        {onAction && adjustable(e) && (
          <span className="ml-auto flex flex-wrap items-center gap-0.5">
            <InlineAction onClick={() => onAction({ kind: 'work_no', engagement: e })}>
              {e.work_nos.some((n) => !n.void) ? '换工号' : '登记工号'}
            </InlineAction>
            <InlineAction onClick={() => onAction({ kind: 'assign', engagement: e })}>添加归属</InlineAction>
            <InlineAction onClick={() => onAction({ kind: 'duty_assign', engagement: e })}>任命职务</InlineAction>
            <InlineAction onClick={() => onAction({ kind: 'engagement_end', engagement: e })}>{e.valid_to ? '调整期限' : '结束任用'}</InlineAction>
          </span>
        )}
      </header>
      <div className="grid gap-3 px-4 py-3">
        <SegmentList
          title="主部门"
          empty="这项任用没有部门归属（暂未分配）"
          rows={e.assignments
            .filter((a) => a.kind === 'PRIMARY')
            .map((a) => ({
              key: a.id,
              void: a.void,
              from: a.valid_from,
              to: a.valid_to,
              label: (
                <>
                  <Link className="hover:underline" to={`/departments/${a.department.id}`}>
                    {a.department.name}
                  </Link>
                  {a.department_lifecycle && a.department_lifecycle !== 'ACTIVE' && (
                    <Tag tone={DEPARTMENT_LIFECYCLE_TONE[a.department_lifecycle]}>
                      {DEPARTMENT_LIFECYCLE[a.department_lifecycle as keyof typeof DEPARTMENT_LIFECYCLE]}
                    </Tag>
                  )}
                </>
              ),
              actions: onAction && adjustable(a) && (
                <>
                  <InlineAction onClick={() => onAction({ kind: 'transfer', assignment: a })}>调科</InlineAction>
                  <InlineAction onClick={() => onAction({ kind: 'end', assignment: a })}>结束</InlineAction>
                </>
              ),
            }))}
          asOf={asOf}
          fold={fold}
        />
        {e.assignments.some((a) => a.kind === 'ADDITIONAL') && (
          <SegmentList
            title="附加归属"
            empty=""
            rows={e.assignments
              .filter((a) => a.kind === 'ADDITIONAL')
              .map((a) => ({
                key: a.id,
                void: a.void,
                from: a.valid_from,
                to: a.valid_to,
                label: (
                  <Link className="hover:underline" to={`/departments/${a.department.id}`}>
                    {a.department.name}
                  </Link>
                ),
                actions: onAction && adjustable(a) && <InlineAction onClick={() => onAction({ kind: 'end', assignment: a })}>结束</InlineAction>,
              }))}
            asOf={asOf}
            fold={fold}
          />
        )}
        {duties.length > 0 && (
          <SegmentList
            title="部门职务"
            empty=""
            rows={duties.map((d) => ({
              key: d.id,
              void: d.void,
              from: d.valid_from,
              to: d.valid_to,
              label: (
                <>
                  <Link className="hover:underline" to={`/departments/${d.department.id}`}>
                    {d.department.name}
                  </Link>
                  <Tag tone={d.mode === 'FORMAL' ? 'blue' : 'orange'}>{d.label}</Tag>
                </>
              ),
              actions: onAction && adjustable(d) && (
                <>
                  <InlineAction onClick={() => onAction({ kind: 'duty_handover', duty: d })}>交接</InlineAction>
                  <InlineAction onClick={() => onAction({ kind: 'duty_end', duty: d })}>结束</InlineAction>
                </>
              ),
              extra: <DutyBasis note={d.basis_note} expandable />,
            }))}
            asOf={asOf}
            fold={fold}
          />
        )}
        <SegmentList
          title="业务工号"
          empty="未登记工号"
          rows={e.work_nos.map((n) => ({
            key: n.id,
            void: n.void,
            from: n.valid_from,
            to: n.valid_to,
            label: (
              <>
                <span className="font-mono">{n.work_no ?? '（无权查看）'}</span>
                {n.revise_reason !== 'INITIAL' && <span className="text-fg-secondary text-caption">{WORK_NO_REASON[n.revise_reason]}</span>}
              </>
            ),
          }))}
          asOf={asOf}
          fold={fold}
        />
        {(e.end_changes ?? []).length > 0 && <EndChanges changes={e.end_changes ?? []} />}
      </div>
    </section>
  )
}

const END_ACTION: Record<string, string> = {
  REGISTER: '登记时填写',
  END: '结束任用',
  EARLIER: '提前结束',
  LATER: '推后结束日',
  CLEAR: '撤回结束日',
  CANCEL: '撤销计划',
}

/** 任用结束日的逐次登记与调整：原结束日 → 新结束日，每次对应一张已确认的申请（PERS-06）；默认收起，点开看 */
function EndChanges({ changes }: { changes: EngagementEndChange[] }) {
  const [open, setOpen] = useState(false)
  const show = (d?: string | null) => d ?? '长期'
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <div className="text-fg-secondary text-xs">结束日调整</div>
      <div className="grid gap-1">
        <span>
          <InlineAction className="-ml-2" onClick={() => setOpen(!open)}>
            {open ? '收起调整记录' : `查看 ${changes.length} 次登记与调整`}
          </InlineAction>
        </span>
        {open &&
          changes.map((c) => (
            <div key={`${c.change_id}-${c.action}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="text-fg-strong">{END_ACTION[c.action]}</span>
              <span className="text-fg-secondary tabular-nums">
                {c.action === 'REGISTER' ? show(c.to_valid_to) : `${show(c.from_valid_to)} → ${c.action === 'CANCEL' ? '从未生效' : show(c.to_valid_to)}`}
              </span>
              <ChangeLink id={c.change_id} className="text-caption" />
              {c.confirmed_at && <span className="text-fg-secondary text-caption">{stamp(c.confirmed_at)} 确认</span>}
              {(c.handled ?? []).length > 0 && <span className="text-fg-secondary w-full text-caption">随之：{(c.handled ?? []).join('；')}</span>}
            </div>
          ))}
      </div>
    </div>
  )
}

type Segment = {
  key: number
  void: boolean
  from: string
  to: string | null
  label: React.ReactNode
  actions?: React.ReactNode
  extra?: React.ReactNode
}

/** 任用里的一类关系：左列名称，右列逐段写“开始 至 结束”；fold 时当前与计划的段先列，已结束、生效前已撤销的段收起
 *  （有文字标识，不只靠变淡） */
function SegmentList({ title, empty, rows, asOf, fold }: { title: string; empty: string; rows: Segment[]; asOf: string; fold: boolean }) {
  const [showPast, setShowPast] = useState(false)
  const past = (r: Segment) => fold && (r.void || (r.to !== null && r.to < asOf))
  const hidden = rows.filter(past).length
  const visible = rows.filter((r) => showPast || !past(r))
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <div className="text-fg-secondary text-xs">{title}</div>
      <div className="grid content-start gap-1.5">
        {rows.length === 0 && <div className="text-fg-muted text-xs">{empty}</div>}
        {rows.length > 0 && visible.length === 0 && <div className="text-fg-muted text-xs">查看日期当天及以后没有</div>}
        {visible.map((r) => {
          const now = !r.void && covers(r.from, r.to, asOf)
          return (
            <div key={r.key} className="grid gap-0.5">
              <div className={cn('flex flex-wrap items-center gap-1.5 text-xs', !now && 'text-fg-secondary')}>
                <span className={cn('size-1.5 shrink-0 rounded-full', now ? 'bg-brand' : 'bg-line-strong')} aria-hidden />
                {r.label}
                <span className="text-fg-secondary tabular-nums">
                  {r.void ? `${r.from} 起 · 生效前已撤销` : `${period(r.from, r.to)}${!now && r.from > asOf ? ' · 计划' : ''}`}
                </span>
                {r.actions}
              </div>
              {r.extra && <div className="pl-3">{r.extra}</div>}
            </div>
          )
        })}
        {hidden > 0 && (
          <span>
            <InlineAction className="-ml-2" onClick={() => setShowPast(!showPast)}>
              {showPast ? '收起已结束的' : `显示已结束或已撤销的 ${hidden} 段`}
            </InlineAction>
          </span>
        )}
      </div>
    </div>
  )
}

function nameEvents(d: PersonDetail): TimelineEvent[] {
  const asc = [...d.versions].sort((a, b) => a.version_no - b.version_no)
  return asc.map((v, i) => {
    const prev = asc.slice(0, i).filter((x) => !x.void).at(-1)
    return {
      key: `v${v.version_no}`,
      date: v.valid_from,
      title: v.void ? '生效前已更正' : NAME_REASON[v.revise_reason],
      detail: prev ? `${prev.name} → ${v.name}${v.revise_reason === 'CORRECTION' ? '（原值为误录）' : ''}` : v.name,
      changeId: v.change_id,
      void: v.void,
    }
  })
}
