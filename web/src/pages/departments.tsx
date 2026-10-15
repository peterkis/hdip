// 部门：列表（Notion 数据库视图 + 部门数统计）与详情（页头属性 + 选项卡）。
// 部门数口径：查看日期当天已设立、且组织生命周期为“正式履职”的部门；筹备、暂停等不计入。
import {
  Add01Icon,
  Building03Icon,
  Calendar03Icon,
  Certificate01Icon,
  Download01Icon,
  HashtagIcon,
  Hospital01Icon,
  Layers01Icon,
  ListViewIcon,
  Loading03Icon,
  Tag01Icon,
  TextFontIcon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useGetDepartment, useListClassificationSchemes, useListDepartments } from '@/api/generated/master/master'
import type { DepartmentAliasOut, DepartmentRow, DepartmentVersionOut } from '@/api/generated/model'
import {
  DepartmentAffiliateDialog,
  DepartmentAliasCloseDialog,
  DepartmentAliasDialog,
  DepartmentClassifyDialog,
  DepartmentCreateDialog,
  DepartmentLifecycleDialog,
  DepartmentReviseDialog,
} from '@/components/forms/department-forms'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip, type DbColumn } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { PropertyList } from '@/components/kit/property-list'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UnitsTable } from '@/components/units-table'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { DEPARTMENT_LIFECYCLE, ESTABLISHMENT_FORM, stamp, type DepartmentLifecycle } from '@/lib/format'
import { notify } from '@/lib/notify'
import { DEPARTMENT_LIFECYCLE_TONE, MAIN_CLASS_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

const MAIN_SCHEME = 'DEPT_MAIN_CLASS'

function LifecycleTag({ value }: { value: string }) {
  return <Tag tone={DEPARTMENT_LIFECYCLE_TONE[value] ?? 'gray'}>{DEPARTMENT_LIFECYCLE[value as DepartmentLifecycle] ?? value}</Tag>
}

function MainClassTag({ code, name }: { code: string; name: string }) {
  return <Tag tone={MAIN_CLASS_TONE[code] ?? 'gray'}>{name}</Tag>
}

/** 部门数口径：当天已设立且正式履职 */
const counted = (d: DepartmentRow) => !d.not_yet_effective && d.version.lifecycle === 'ACTIVE'

// ================================================================== 列表
const COLUMNS: DbColumn[] = [
  { label: '名称', icon: TextFontIcon, className: 'min-w-48' },
  { label: '代码', icon: HashtagIcon },
  { label: '部门管理主分类', icon: Tag01Icon },
  { label: '组织生命周期', icon: Loading03Icon },
  { label: '设立形式', icon: ListViewIcon },
  { label: '主体归属', icon: Hospital01Icon },
  { label: '服务单元', icon: Building03Icon },
]

export function DepartmentsPage() {
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
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const [creating, setCreating] = useState(false)

  const { data: all = [], isPending } = useListDepartments({ as_of: asOf, ...(q && { q }) })
  const { data: schemes = [] } = useListClassificationSchemes()
  const mainCodes = schemes.find((s) => s.code === MAIN_SCHEME)?.codes ?? []

  const rows = useMemo(
    () =>
      all.filter(
        (d) =>
          (future || !d.not_yet_effective) &&
          (!cls || (cls === '_none' ? !d.main_class : d.main_class?.code === cls)) &&
          (!life || d.version.lifecycle === life),
      ),
    [all, future, cls, life],
  )

  const exporting = useMutation({
    mutationFn: () => downloadCsv('departments', asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的部门`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        icon={UserGroupIcon}
        title="部门"
        description="谁在医院组织体系内承担这组职责。部门身份不因院区、地点、负责人、服务形态或核算口径变化而改变。"
        actions={
          <>
            <Button variant="ghost" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
              <Icon icon={Download01Icon} inline="start" />
              导出 CSV
            </Button>
            {isMaintainer && (
              <Button onClick={() => setCreating(true)}>
                <Icon icon={Add01Icon} inline="start" />
                新建
              </Button>
            )}
          </>
        }
      />

      {!q && <DeptStats rows={all} codes={mainCodes} onPick={(c) => set('class', c)} active={cls} />}

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称、曾用名、别名或代码" />}>
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
        <ToggleChip label="含计划中" checked={future} onChange={(v) => set('future', v ? '' : '0')} />
      </DbToolbar>

      {!isPending && rows.length === 0 ? (
        <DbEmpty
          title={all.length === 0 ? (q ? `没有找到“${q}”` : '还没有部门') : '没有符合条件的部门'}
          hint={all.length === 0 && !q ? '新建部门后经提交、确认才会出现在这里。' : '换个筛选条件或搜索词试试。'}
        />
      ) : (
        <DbTable columns={COLUMNS}>
          {rows.map((d) => (
            <DbRow key={d.id}>
              <DbCell>
                <span className="flex items-center gap-2">
                  <Link
                    to={`/departments/${d.id}`}
                    className="text-fg-strong decoration-line-strong truncate font-medium underline-offset-4 hover:underline"
                  >
                    {d.version.name}
                  </Link>
                  {d.not_yet_effective && <Tag tone="gray">计划中</Tag>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{d.code}</DbCell>
              <DbCell>
                {d.main_class ? (
                  <MainClassTag code={d.main_class.code} name={d.main_class.name} />
                ) : (
                  <span className="text-fg-disabled">未分类</span>
                )}
              </DbCell>
              <DbCell>
                <LifecycleTag value={d.version.lifecycle} />
              </DbCell>
              <DbCell className="whitespace-nowrap">
                {ESTABLISHMENT_FORM[d.version.establishment_form]}
                {d.version.temporary_until && <span className="text-fg-muted text-caption"> · 至 {d.version.temporary_until}</span>}
              </DbCell>
              <DbCell className="whitespace-nowrap">{d.institution_name ?? <span className="text-fg-disabled">未填</span>}</DbCell>
              <DbCell className="text-fg-secondary tabular-nums">{d.unit_count || '—'}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{rows.length}</span> 个部门
        </span>
        <span>部门数只计查看日期当天“正式履职”的部门；筹备、暂停履职、撤销不计入</span>
      </DbFooter>
      {creating && <DepartmentCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

/** 统计条：正式履职部门数、按主分类计数（每个部门只计一次）、不计入的筹备与暂停。点击按主分类筛选 */
function DeptStats({
  rows,
  codes,
  onPick,
  active,
}: {
  rows: DepartmentRow[]
  codes: { code: string; name: string }[]
  onPick: (code: string) => void
  active: string
}) {
  const inCount = rows.filter(counted)
  const byClass = (code: string) => inCount.filter((d) => d.main_class?.code === code).length
  const unclassified = inCount.filter((d) => !d.main_class).length
  // 不计入：尚未设立（计划中）或仍在筹备的部门
  const preparing = rows.filter((d) => d.not_yet_effective || d.version.lifecycle === 'PREPARING').length
  const suspended = rows.filter((d) => !d.not_yet_effective && d.version.lifecycle === 'SUSPENDED').length
  const cell = 'grid gap-0.5 px-3 py-2 text-left transition-colors duration-(--hd-duration-fast)'
  return (
    <div className="border-line-subtle mb-4 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4 lg:grid-cols-9">
      <div className={cn(cell, 'bg-surface-subtle')}>
        <span className="text-fg-strong text-lg font-semibold tabular-nums">{inCount.length}</span>
        <span className="text-fg-muted text-caption">正式履职部门数</span>
      </div>
      {[...codes.map((c) => ({ code: c.code, name: c.name, n: byClass(c.code) })), { code: '_none', name: '未分类', n: unclassified }].map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => onPick(active === c.code ? '' : c.code)}
          className={cn(cell, 'hover:bg-surface-hover', active === c.code && 'bg-brand-muted')}
        >
          <span className="text-fg-strong text-lg font-semibold tabular-nums">{c.n}</span>
          <span className="text-fg-muted text-caption">{c.name}</span>
        </button>
      ))}
      <div className={cell} title="筹备中、尚未正式履职的部门不进入正式统计">
        <span className="text-fg-muted text-lg font-semibold tabular-nums">
          {preparing}
          {suspended > 0 && <span className="text-caption font-normal"> · 暂停 {suspended}</span>}
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

type Dialog = 'revise' | 'lifecycle' | 'classify' | 'affiliate' | 'alias' | 'unit'
type TabKey = 'props' | 'class' | 'units' | 'history'

export function DepartmentDetailPage() {
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data } = useGetDepartment(id, { as_of: asOf })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [closingAlias, setClosingAlias] = useState<DepartmentAliasOut | null>(null)
  const [tab, setTab] = useState<TabKey>('props')
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return null

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
  const edit = (label: string, d: Dialog) =>
    isMaintainer && !terminal ? (
      <button type="button" className="text-fg-muted hover:text-fg ml-2 text-caption hover:underline" onClick={() => setDialog(d)}>
        {label}
      </button>
    ) : null

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={UserGroupIcon}
        title={shown.name}
        description={
          onDay
            ? `管理编码 ${data.code} · 部门 ID ${data.id} · ${asOf} 有效的是第 ${onDay.version_no} 版`
            : `管理编码 ${data.code} · ${asOf} 尚未设立，自 ${shown.valid_from} 起`
        }
        actions={
          isMaintainer &&
          !terminal && (
            <>
              <Button variant="outline" onClick={() => setDialog('lifecycle')}>
                变更生命周期
              </Button>
              <Button onClick={() => setDialog('revise')}>修订属性</Button>
            </>
          )
        }
      />

      <PropertyList
        items={[
          {
            label: '部门管理主分类',
            icon: Tag01Icon,
            value: (
              <>
                {mainClass ? <MainClassTag code={mainClass.code} name={mainClass.name} /> : <span className="text-fg-disabled">未分类</span>}
                {edit(mainClass ? '调整' : '设置', 'classify')}
              </>
            ),
          },
          {
            label: '承担职责',
            icon: ListViewIcon,
            value: shown.duties.length ? (
              <span className="flex flex-wrap gap-1">
                {shown.duties.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
            ) : null,
          },
          {
            label: '组织生命周期',
            icon: Loading03Icon,
            value: (
              <>
                <LifecycleTag value={shown.lifecycle} />
                <span className="text-fg-muted ml-2 text-caption">自 {shown.valid_from}</span>
              </>
            ),
          },
          {
            label: '设立形式',
            icon: Certificate01Icon,
            value: `${ESTABLISHMENT_FORM[shown.establishment_form]}${shown.temporary_until ? `，期限至 ${shown.temporary_until}` : ''}`,
          },
          {
            label: '主体归属',
            icon: Hospital01Icon,
            value: (
              <>
                {affiliation?.institution_name ?? <span className="text-fg-disabled">未填</span>}
                {edit(affiliation ? '调整' : '设置', 'affiliate')}
              </>
            ),
          },
          { label: '行政级别', icon: Layers01Icon, value: shown.admin_grade },
          {
            label: '行政隶属',
            icon: Layers01Icon,
            value: <span className="text-fg-muted">一级 / 二级部门在 D2（行政视图）接入</span>,
          },
          {
            label: '当前负责人',
            icon: UserIcon,
            value: <span className="text-fg-muted">待“岗位与任职”接入，由有效任职关系带出</span>,
          },
        ]}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList variant="line">
          <TabsTrigger value="props">名称与说明</TabsTrigger>
          <TabsTrigger value="class">分类与归属</TabsTrigger>
          <TabsTrigger value="units">服务单元（{data.units.length}）</TabsTrigger>
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
                  {
                    label: '曾用名',
                    value: formerNames.length ? formerNames.map((v) => `${v.name}（${v.valid_from} → ${v.valid_to ?? '长期'}）`).join('；') : null,
                  },
                  {
                    label: '别名',
                    value: (
                      <span className="flex flex-wrap items-center gap-1">
                        {data.aliases.map((a) => (
                          <Tag key={a.id} tone="gray" className={cn(a.valid_to && a.valid_to < asOf && 'opacity-50')}>
                            {a.kind === 'SEARCH_CODE' ? '检索码 ' : ''}
                            {a.value}
                            {a.valid_to ? ` · 至 ${a.valid_to}` : ''}
                          </Tag>
                        ))}
                        {data.aliases.length === 0 && <span className="text-fg-disabled">空</span>}
                        {edit('添加', 'alias')}
                      </span>
                    ),
                  },
                ]}
              />
              <p className="text-fg-muted text-caption">名称不是身份。更名产生新版本，旧名称即曾用名；别名只用于检索。</p>
            </Section>
            <Section title="职责与依据">
              <PropertyList
                items={[
                  { label: '职责说明', value: shown.description },
                  { label: '依据', value: shown.basis_note },
                ]}
              />
            </Section>
            {isMaintainer && data.aliases.some((a) => !a.valid_to) && (
              <p className="text-fg-muted text-caption">
                停用别名：
                {data.aliases
                  .filter((a) => !a.valid_to)
                  .map((a) => (
                    <button key={a.id} type="button" className="ml-2 hover:underline" onClick={() => setClosingAlias(a)}>
                      {a.value}
                    </button>
                  ))}
              </p>
            )}
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
                    cells: [<MainClassTag code={c.code} name={c.name} />, `${c.valid_from} → ${c.valid_to ?? '长期'}`, <ChangeLink id={c.change_id} />],
                  }))}
                empty="尚未分类"
              />
              <p className="text-fg-muted text-caption">同一时点只有一个主分类；承担的多项职责放在“承担职责”。成本分类另设，允许与管理主分类有依据地不同。</p>
            </Section>
            <Section title="主体归属" action={edit(affiliation ? '调整' : '设置', 'affiliate')}>
              <PeriodTable
                head={['主体', '期间', '来源申请']}
                rows={data.affiliations.map((a) => ({
                  key: a.id,
                  current: a === affiliation,
                  cells: [a.institution_name, `${a.valid_from} → ${a.valid_to ?? '长期'}`, <ChangeLink id={a.change_id} />],
                }))}
                empty="未填主体归属"
              />
            </Section>
          </>
        )}

        {tab === 'units' && (
          <Section
            title={`服务单元（${asOf}）`}
            action={
              isMaintainer && latest.lifecycle === 'ACTIVE' ? (
                <Button size="sm" variant="outline" onClick={() => setDialog('unit')}>
                  新建服务单元
                </Button>
              ) : null
            }
          >
            <UnitsTable rows={data.units} hide={['department']} />
            <p className="text-fg-muted text-caption">部门在新院区开展服务 = 新建或重新绑定服务单元，部门身份不变。</p>
          </Section>
        )}

        {tab === 'history' && (
          <Section title="版本时间线">
            <VersionTimeline versions={data.versions} fields={VERSION_FIELDS} asOf={asOf} />
            <p className="text-fg-muted text-caption">
              新建于 {stamp(data.created_at)}（<ChangeLink id={data.created_change_id} />）。相关申请：
              {data.change_ids.map((cid) => (
                <ChangeLink key={cid} id={cid} className="ml-1.5" />
              ))}
            </p>
          </Section>
        )}

        {terminal && (
          <Callout tone="warning" title={`该部门已${DEPARTMENT_LIFECYCLE[latest.lifecycle as DepartmentLifecycle]}`}>
            终态，不能再调整；代码 {data.code} 永久绑定，不会被复用。
          </Callout>
        )}
      </div>

      {dialog === 'revise' && <DepartmentReviseDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'lifecycle' && <DepartmentLifecycleDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'classify' && (
        <DepartmentClassifyDialog open onOpenChange={close} code={data.code} name={latest.name} currentCode={mainClass?.code} />
      )}
      {dialog === 'affiliate' && <DepartmentAffiliateDialog open onOpenChange={close} code={data.code} name={latest.name} />}
      {dialog === 'alias' && <DepartmentAliasDialog open onOpenChange={close} code={data.code} name={latest.name} />}
      {dialog === 'unit' && <UnitCreateDialog open onOpenChange={close} departmentCode={data.code} />}
      {closingAlias && <DepartmentAliasCloseDialog open alias={closingAlias} onOpenChange={(o) => !o && setClosingAlias(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ 小件
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-fg-strong flex items-center text-sm font-semibold">
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </h2>
      {children}
    </section>
  )
}

function ChangeLink({ id, className }: { id: number; className?: string }) {
  return (
    <Link to={`/changes/${id}`} className={cn('text-fg-secondary hover:underline', className)}>
      #{id}
    </Link>
  )
}

function PeriodTable({
  head,
  rows,
  empty,
}: {
  head: string[]
  rows: { key: number; current: boolean; cells: React.ReactNode[] }[]
  empty: string
}) {
  if (rows.length === 0) return <p className="text-fg-disabled text-xs">{empty}</p>
  return (
    <DbTable columns={head.map((label, i) => ({ label, icon: i === 1 ? Calendar03Icon : undefined }))}>
      {rows.map((r) => (
        <DbRow key={r.key} className={cn(!r.current && 'text-fg-muted')}>
          {r.cells.map((c, i) => (
            <DbCell key={i} className="whitespace-nowrap">
              {c}
            </DbCell>
          ))}
        </DbRow>
      ))}
    </DbTable>
  )
}
