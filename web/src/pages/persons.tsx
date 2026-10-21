// 人员名册与人员详情（人员设计第 7.2 节）。
// 名册每人一行（按人去重），任用与当天的主部门、工号作为子项；状态由查看日期的任用派生。
// 详情按任用分段显示工号与部门归属的历史；姓名版本单独一条时间线（更名、更正误录分开标出）。
import {
  Add01Icon,
  Briefcase01Icon,
  Calendar03Icon,
  Download01Icon,
  HashtagIcon,
  Hospital01Icon,
  IdentityCardIcon,
  Loading03Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useListDepartments } from '@/api/generated/master/master'
import type { PersonDetail, PersonEngagementOut, PersonRow } from '@/api/generated/model'
import { useGetPerson, useListPersons } from '@/api/generated/persons/persons'
import { PersonEngageDialog, PersonRegisterDialog } from '@/components/forms/person-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { Missing } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { ChangeLink, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Timeline, type TimelineEvent } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { DEPARTMENT_LIFECYCLE, period } from '@/lib/format'
import { notify } from '@/lib/notify'
import { NAME_REASON, PERSON_STATUS, PERSON_STATUS_TONE, WORK_NO_REASON } from '@/lib/person'
import { DEPARTMENT_LIFECYCLE_TONE, PLANNED_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

// ================================================================== 名册
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
  const { asOf, optionLabels } = useApp()
  const { can } = useMe()
  const f = useRosterFilters()
  const [query, setQuery] = useState('')
  const [registering, setRegistering] = useState(false)
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  const { data: rows = [], isPending } = useListPersons({
    as_of: asOf,
    q: query.trim() || undefined,
    scope: f.all ? 'all' : 'as_of',
    include_future: f.future,
    ...(f.status && { status: f.status as PersonRow['status'] }),
    ...(f.dept && { department_id: Number(f.dept) }),
  })
  const types = optionLabels.engagement_type ?? {}

  const exporting = useMutation({
    mutationFn: async (dataset: 'persons' | 'person-relations') => downloadCsv(dataset, asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的人员数据`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        icon={IdentityCardIcon}
        title="人员名册"
        description={`人员 × 任用 × 部门归属。按 ${asOf} 当天的任用显示，一人一行；不含账号、资质与执业信息。`}
        actions={
          <>
            {can('person.export') && (
              <>
                <Button variant="ghost" disabled={exporting.isPending} onClick={() => exporting.mutate('persons')} title="当天有有效任用的人员，一人一行">
                  <Icon icon={Download01Icon} inline="start" />
                  导出名册
                </Button>
                <Button
                  variant="ghost"
                  disabled={exporting.isPending}
                  onClick={() => exporting.mutate('person-relations')}
                  title="当天有效的任用与主部门，一行一项任用"
                >
                  <Icon icon={Download01Icon} inline="start" />
                  导出任用与归属
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
        <ToggleChip label="全部人员（含已离开、未来）" checked={f.all} onChange={(v) => f.set('scope', v ? 'all' : '')} />
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
            { label: '姓名', icon: TextFontIcon, className: 'min-w-36' },
            { label: '人员代码', icon: HashtagIcon },
            { label: '任用', icon: Briefcase01Icon },
            { label: '主部门', icon: UserGroupIcon },
            { label: '工号', icon: HashtagIcon },
            { label: '任用期间', icon: Calendar03Icon },
          ]}
        >
          {rows.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Link className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline" to={`/persons/${r.id}`}>
                    {r.name}
                  </Link>
                  {r.status !== 'ENGAGED' && <Tag tone={PERSON_STATUS_TONE[r.status]}>{PERSON_STATUS[r.status]}</Tag>}
                  {r.matched && <span className="text-fg-muted text-caption">命中 {r.matched}</span>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{r.code}</DbCell>
              <Stacked rows={r} render={(e) => types[e.engagement_type] ?? e.engagement_type} />
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
              <Stacked rows={r} mono render={(e) => e.work_no ?? <span className="text-fg-disabled">—</span>} />
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
          {f.all ? '全部人员，不看日期' : `${asOf} 当天有有效任用的人${f.future ? '，含计划中' : ''}`}；一人多项任用仍算一人
        </span>
      </DbFooter>
      {registering && <PersonRegisterDialog open onOpenChange={setRegistering} />}
    </>
  )
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
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { can } = useMe()
  const { data, isError } = useGetPerson(id, { as_of: asOf })
  const [engaging, setEngaging] = useState(false)
  useCrumb(data && `${data.code} ${data.name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="人员" back={{ to: '/persons', label: '返回人员名册' }} /> : null

  const live = data.engagements.filter((e) => !e.void)
  const current = live.filter((e) => covers(e.valid_from, e.valid_to, asOf))
  const formerNames = data.versions.filter((v, i) => !v.void && i > 0 && data.versions[i - 1].revise_reason === 'RENAME')

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={IdentityCardIcon}
        title={data.name}
        description={`人员代码 ${data.code} · 按 ${asOf} 显示 · 人员代码由系统分配、永不改变，与业务工号无关`}
        actions={
          can('person.change') && (
            <Button variant="outline" onClick={() => setEngaging(true)}>
              建立任用（再次任用）
            </Button>
          )
        }
      />
      <PropertyList
        items={[
          { label: '状态', icon: Loading03Icon, value: <Tag tone={PERSON_STATUS_TONE[data.status]}>{PERSON_STATUS[data.status]}</Tag> },
          { label: '拼音码', icon: TextFontIcon, value: data.pinyin && <span className="font-mono">{data.pinyin}</span> },
          {
            label: '当天任用',
            icon: Hospital01Icon,
            value: current.length
              ? current.map((e) => `${e.institution_name} · ${optionLabels.engagement_type?.[e.engagement_type] ?? e.engagement_type}`).join('；')
              : null,
          },
          {
            label: '当天主部门',
            icon: UserGroupIcon,
            value: current.length
              ? current.map((e) => {
                  const a = e.assignments.find((x) => !x.void && covers(x.valid_from, x.valid_to, asOf))
                  return a ? (
                    <Link key={e.id} className="hover:underline" to={`/departments/${a.department.id}`}>
                      {a.department.name}
                    </Link>
                  ) : (
                    <Tag key={e.id} tone="yellow">
                      暂未分配
                    </Tag>
                  )
                })
              : null,
          },
          {
            label: '当天工号',
            icon: HashtagIcon,
            value:
              current
                .map((e) => e.work_nos.find((n) => !n.void && covers(n.valid_from, n.valid_to, asOf))?.work_no)
                .filter(Boolean)
                .join('、') || null,
          },
          { label: '曾用名', icon: TextFontIcon, value: formerNames.map((v) => v.name).join('、') || null },
        ]}
      />
      {(data.masked_fields ?? []).length > 0 && (
        <Callout tone="neutral" title="部分信息无权查看">
          以下字段按权限隐去：{(data.masked_fields ?? []).join('、')}。
        </Callout>
      )}

      <div className="mt-8 grid gap-8">
        <Section title={`任用与部门归属（${live.length}）`}>
          {live.length === 0 ? (
            <p className="text-fg-muted text-xs">没有任用记录。</p>
          ) : (
            <div className="grid gap-4">
              {data.engagements.map((e) => (
                <EngagementCard key={e.id} e={e} asOf={asOf} />
              ))}
            </div>
          )}
        </Section>
        <Section title="姓名">
          <Timeline events={nameEvents(data)} asOf={asOf} order="desc" />
        </Section>
      </div>
      {engaging && <PersonEngageDialog open onOpenChange={setEngaging} personCode={data.code} name={data.name} />}
    </div>
  )
}

function EngagementCard({ e, asOf }: { e: PersonEngagementOut; asOf: string }) {
  const { optionLabels } = useApp()
  const type = optionLabels.engagement_type?.[e.engagement_type] ?? e.engagement_type
  const state = e.void
    ? { label: '生效前已撤销', tone: 'gray' as const }
    : e.valid_from > asOf
      ? { label: '计划中', tone: PLANNED_TONE }
      : e.valid_to && e.valid_to < asOf
        ? { label: '已结束', tone: 'gray' as const }
        : { label: '有效', tone: 'green' as const }
  return (
    <div className={cn('border-line rounded-md border', e.void && 'opacity-60')}>
      <div className="border-line-subtle flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-xs">
        <span className="text-fg-strong font-medium">{e.institution_name}</span>
        <span className="text-fg-secondary">{type}</span>
        <Tag tone={state.tone}>{state.label}</Tag>
        <span className="text-fg-secondary tabular-nums">{period(e.valid_from, e.valid_to)}</span>
        {e.note && <span className="text-fg-muted text-caption">· {e.note}</span>}
        <span className="ml-auto flex gap-2">
          <ChangeLink id={e.change_id} />
          {e.closed_change_id && <ChangeLink id={e.closed_change_id} />}
        </span>
      </div>
      <div className="grid gap-3 px-3 py-2 sm:grid-cols-2">
        <SegmentList
          title="主部门"
          empty="这项任用没有部门归属（暂未分配）"
          rows={e.assignments.map((a) => ({
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
                  <Tag tone={DEPARTMENT_LIFECYCLE_TONE[a.department_lifecycle]}>{DEPARTMENT_LIFECYCLE[a.department_lifecycle as keyof typeof DEPARTMENT_LIFECYCLE]}</Tag>
                )}
              </>
            ),
          }))}
          asOf={asOf}
        />
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
                {n.revise_reason !== 'INITIAL' && <span className="text-fg-muted text-caption">{WORK_NO_REASON[n.revise_reason]}</span>}
              </>
            ),
          }))}
          asOf={asOf}
        />
      </div>
    </div>
  )
}

function SegmentList({
  title,
  empty,
  rows,
  asOf,
}: {
  title: string
  empty: string
  rows: { key: number; void: boolean; from: string; to: string | null; label: React.ReactNode }[]
  asOf: string
}) {
  return (
    <div className="grid content-start gap-1">
      <div className="text-fg-muted text-caption font-medium">{title}</div>
      {rows.length === 0 ? (
        <div className="text-fg-disabled text-xs">{empty}</div>
      ) : (
        rows.map((r) => {
          const now = !r.void && covers(r.from, r.to, asOf)
          return (
            <div key={r.key} className={cn('flex flex-wrap items-center gap-1.5 text-xs', r.void && 'line-through opacity-60', !now && 'text-fg-secondary')}>
              <span className={cn('size-1.5 shrink-0 rounded-full', now ? 'bg-brand' : 'bg-line-strong')} aria-hidden />
              {r.label}
              <span className="text-fg-muted tabular-nums">{r.void ? '生效前已撤销' : period(r.from, r.to)}</span>
            </div>
          )
        })
      )}
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
