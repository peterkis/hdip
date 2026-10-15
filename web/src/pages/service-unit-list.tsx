// 服务单元列表：Notion 数据库视图。筛选条件放在地址栏（?campus=&dept=…），可收藏、可分享。
import { Icon } from '@/components/kit/icon'
import {
  Add01Icon,
  Building03Icon,
  Calendar03Icon,
  Clock01Icon,
  Download01Icon,
  GridViewIcon,
  HashtagIcon,
  Hospital01Icon,
  ListViewIcon,
  Loading03Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  useListCampuses,
  useListDepartments,
  useListInstitutions,
  useListServiceUnits,
} from '@/api/generated/master/master'
import type { ServiceUnitRow } from '@/api/generated/model'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import {
  DbCell,
  DbEmpty,
  DbFooter,
  DbRow,
  DbTable,
  DbToolbar,
  FilterPill,
  SearchBox,
  ToggleChip,
  type DbColumn,
} from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { notify } from '@/lib/notify'
import { formatValue, UNIT_STATUS, type UnitStatus } from '@/lib/format'
import { UNIT_STATUS_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'

const COLUMNS: DbColumn[] = [
  { label: '名称', icon: TextFontIcon, className: 'min-w-56' },
  { label: '代码', icon: HashtagIcon },
  { label: '类型', icon: ListViewIcon },
  { label: '所属部门', icon: UserGroupIcon },
  { label: '院区', icon: Building03Icon },
  { label: '运营主体', icon: Hospital01Icon },
  { label: '状态', icon: Loading03Icon },
  { label: '期间', icon: Calendar03Icon },
]

/** 地址栏里的筛选条件；空串 = 不筛 */
function useFilters() {
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
    campus: get('campus'),
    dept: get('dept'),
    inst: get('inst'),
    type: get('type'),
    status: get('status'),
    // 默认含计划中的单元；?future=0 只看当天已生效的（剧本 5 “在运营”）
    future: get('future') !== '0',
    set,
    clear: () => setParams(new URLSearchParams(), { replace: true }),
    active: ['campus', 'dept', 'inst', 'type', 'status', 'future'].some((k) => params.has(k)),
  }
}

export function ServiceUnitsPage() {
  const { asOf, unitTypeOptions, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const f = useFilters()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf })
  const { data: units = [], isPending } = useListServiceUnits({
    as_of: asOf,
    include_future: f.future,
    ...(f.campus && { campus_id: Number(f.campus) }),
    ...(f.dept && { department_id: Number(f.dept) }),
    ...(f.inst && { institution_id: Number(f.inst) }),
  })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return units.filter(
      (u) =>
        (!f.type || u.unit_type === f.type) &&
        (!f.status || u.version.status === f.status) &&
        (!q || u.code.toLowerCase().includes(q) || u.version.name.toLowerCase().includes(q)),
    )
  }, [units, f.type, f.status, query])

  const exporting = useMutation({
    mutationFn: () => downloadCsv('service-units', asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的服务单元`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        icon={GridViewIcon}
        title="服务单元"
        description={`部门 × 院区 × 运营主体 × 期间。按 ${asOf} 当天有效的版本显示。`}
        actions={
          <>
            <Button
              variant="ghost"
              disabled={exporting.isPending}
              onClick={() => exporting.mutate()}
              title="导出当天已生效的全部单元（含暂停，不含计划中与已退出）"
            >
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

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="搜索名称或代码" />}>
        <FilterPill
          label="院区"
          icon={Building03Icon}
          value={f.campus}
          onChange={(v) => f.set('campus', v)}
          options={campuses.map((c) => ({ value: String(c.id), label: c.version.name }))}
        />
        <FilterPill
          label="部门"
          icon={UserGroupIcon}
          value={f.dept}
          onChange={(v) => f.set('dept', v)}
          options={departments.map((d) => ({ value: String(d.id), label: d.version.name }))}
        />
        <FilterPill
          label="运营主体"
          icon={Hospital01Icon}
          value={f.inst}
          onChange={(v) => f.set('inst', v)}
          options={institutions.map((i) => ({ value: String(i.id), label: i.version.name }))}
        />
        <FilterPill
          label="类型"
          icon={ListViewIcon}
          value={f.type}
          onChange={(v) => f.set('type', v)}
          options={unitTypeOptions.map((o) => ({ value: o.code, label: o.name }))}
        />
        <FilterPill
          label="状态"
          icon={Loading03Icon}
          value={f.status}
          onChange={(v) => f.set('status', v)}
          options={Object.entries(UNIT_STATUS).map(([value, label]) => ({ value, label }))}
        />
        <ToggleChip label="含计划中" checked={f.future} onChange={(v) => f.set('future', v ? '' : '0')} />
        {f.active && (
          <Button variant="ghost" size="sm" className="text-fg-muted" onClick={f.clear}>
            清除筛选
          </Button>
        )}
      </DbToolbar>

      {!isPending && rows.length === 0 ? (
        <DbEmpty
          title={units.length === 0 ? `${asOf} 没有服务单元` : '没有符合条件的服务单元'}
          hint={units.length === 0 ? '新建服务单元后经提交、确认才会出现在这里。' : '换个筛选条件或搜索词试试。'}
          action={
            (f.active || query) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  f.clear()
                  setQuery('')
                }}
              >
                清除筛选与搜索
              </Button>
            )
          }
        />
      ) : (
        <DbTable columns={COLUMNS}>
          {rows.map((u) => (
            <UnitRow key={u.id} unit={u} typeName={formatValue('unit_type', u.unit_type, optionLabels)} />
          ))}
        </DbTable>
      )}

      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{rows.length}</span> 个单元
          {rows.length !== units.length && `（筛选自 ${units.length} 个）`}
        </span>
        <span>“在运营”= 当天有有效版本，含暂停；已退出的不显示</span>
      </DbFooter>

      {creating && <UnitCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

function UnitRow({ unit: u, typeName }: { unit: ServiceUnitRow; typeName: string }) {
  const v = u.version
  return (
    <DbRow>
      <DbCell>
        <span className="flex items-center gap-2">
          <Link
            to={`/service-units/${u.id}`}
            className="text-fg-strong decoration-line-strong truncate font-medium underline-offset-4 hover:underline"
          >
            {v.name}
          </Link>
          {u.not_yet_effective && <Tag tone="gray">计划中</Tag>}
          {u.has_later_versions && (
            <span title="之后还有已确认的版本" className="text-fg-muted inline-flex">
              <Icon icon={Clock01Icon} className="size-3.5" strokeWidth={1.75} />
            </span>
          )}
        </span>
      </DbCell>
      <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{u.code}</DbCell>
      <DbCell className="whitespace-nowrap">{typeName}</DbCell>
      <DbCell className="whitespace-nowrap">
        <Link to={`/departments/${v.department_id}`} className="hover:underline">
          {v.department_name}
        </Link>
        {v.department_lifecycle !== 'ACTIVE' && <span className="text-danger-text ml-1.5 text-caption">部门非正式履职</span>}
      </DbCell>
      <DbCell className="whitespace-nowrap">
        <Link to={`/campuses/${v.campus_id}`} className="hover:underline">
          {v.campus_name}
        </Link>
      </DbCell>
      <DbCell className="whitespace-nowrap">{v.institution_name}</DbCell>
      <DbCell>
        <Tag tone={UNIT_STATUS_TONE[v.status]}>{UNIT_STATUS[v.status as UnitStatus] ?? v.status}</Tag>
      </DbCell>
      <DbCell className="text-fg-secondary whitespace-nowrap">
        {v.valid_from} → {v.valid_to ?? '长期'}
      </DbCell>
    </DbRow>
  )
}
