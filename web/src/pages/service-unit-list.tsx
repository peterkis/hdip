// 服务单元列表：Notion 数据库视图。筛选条件放在地址栏（?campus=&dept=…），可收藏、可分享。
import { Icon } from '@/components/kit/icon'
import {
  Add01Icon,
  Building03Icon,
  Calendar03Icon,
  Download01Icon,
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
import { combineStatus, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { downloadCsv } from '@/lib/download'
import { notify } from '@/lib/notify'
import { formatValue, UNIT_STATUS, type UnitStatus } from '@/lib/format'
import { UNIT_STATUS_TONE, PLANNED_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { indexDepartments, NO_CLASS } from '@/lib/org-overview'

const EMPTY: never[] = []

// 统一规范 v1.0 SC-06：名称（代码在辅助行）/ 类型 / 所属部门 / 院区 / 运营主体 / 状态 / 业务期间
const COLUMNS: DbColumn[] = [
  { label: '名称', icon: TextFontIcon, className: 'min-w-56' },
  { label: '类型', icon: ListViewIcon },
  { label: '所属部门', icon: UserGroupIcon },
  { label: '院区', icon: Building03Icon },
  { label: '运营主体', icon: Hospital01Icon },
  { label: '状态', icon: Loading03Icon },
  { label: '业务期间', icon: Calendar03Icon },
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
    // 部门含其下级部门（组织总览跳转过来时带上）
    sub: get('sub') === '1',
    // 一级部门的部门管理主分类（同组织总览“按分类”）
    cls: get('cls'),
    inst: get('inst'),
    type: get('type'),
    status: get('status'),
    // 默认含计划中的单元；?future=0 只看当天已生效的（剧本 5 “在运营”）
    future: get('future') !== '0',
    set,
    clear: () => setParams(new URLSearchParams(), { replace: true }),
    active: ['campus', 'dept', 'sub', 'cls', 'inst', 'type', 'status', 'future'].some((k) => params.has(k)),
  }
}

export function ServiceUnitsPage() {
  usePageFrame('work')
  const { asOf, unitTypeOptions, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const f = useFilters()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  // 运营主体、主分类放“更多筛选”；设了值就一直展开，不让隐藏的条件悄悄生效
  const [more, setMore] = useState(false)
  const showMore = more || !!f.inst || !!f.cls

  // 读取状态（U3R-03）：院区、部门、主体只供筛选选项；部门另供“含下级 / 主分类”在页内筛选——这时它失败，结果就未知
  const campusQuery = useListCampuses({ as_of: asOf })
  const deptQuery = useListDepartments({ as_of: asOf })
  const instQuery = useListInstitutions({ as_of: asOf })
  const campuses = campusQuery.data ?? EMPTY
  const departments = useMemo(() => deptQuery.data ?? [], [deptQuery.data])
  const institutions = instQuery.data ?? EMPTY
  const unitQuery = useListServiceUnits({
    as_of: asOf,
    include_future: f.future,
    ...(f.campus && { campus_id: Number(f.campus) }),
    // 含下级时在页内按隶属链筛
    ...(f.dept && !f.sub && { department_id: Number(f.dept) }),
    ...(f.inst && { institution_id: Number(f.inst) }),
  })

  const units = useMemo(() => unitQuery.data ?? [], [unitQuery.data])
  const needsDepts = (!!f.dept && f.sub) || !!f.cls
  const deptStatus = readStatus(deptQuery)
  const status = combineStatus(readStatus(unitQuery), needsDepts ? deptStatus : 'ready')
  // 失败时说清是哪一次读取：单元本身，还是“含下级 / 主分类”要用的部门
  const failed = readStatus(unitQuery) === 'error' ? { what: '服务单元', query: unitQuery } : { what: '部门（“含下级 / 主分类”筛选要用）', query: deptQuery }
  const idx = useMemo(() => indexDepartments(departments), [departments])
  const classOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of departments) if (!d.parent && d.main_class) m.set(d.main_class.code, d.main_class.name)
    return [...m].map(([value, label]) => ({ value, label })).concat({ value: NO_CLASS, label: '未分类' })
  }, [departments])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return units.filter(
      (u) =>
        (!f.dept || !f.sub || idx.chain(u.version.department_id).some((d) => String(d.id) === f.dept)) &&
        (!f.cls || idx.classOf(u.version.department_id) === f.cls) &&
        (!f.type || u.unit_type === f.type) &&
        (!f.status || u.version.status === f.status) &&
        (!q ||
          u.code.toLowerCase().includes(q) ||
          u.version.name.toLowerCase().includes(q) ||
          (u.version.pinyin ?? '').toLowerCase().includes(q)),
    )
  }, [units, idx, f.dept, f.sub, f.cls, f.type, f.status, query])

  const exporting = useMutation({
    mutationFn: () => downloadCsv('service-units', asOf),
    onSuccess: () => notify.success(`已导出 ${asOf} 的服务单元`),
    onError: (e) => notify.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="服务单元"
        description={`部门 × 院区 × 运营主体 × 期间。按 ${asOf} 当天有效的版本显示。`}
        actions={
          <>
            <Button
              variant="ghost"
              disabled={exporting.isPending}
              onClick={() => exporting.mutate()}
              title="导出当天已生效的全部单元（含暂停，不含计划中与已退出），不按页面筛选"
            >
              <Icon icon={Download01Icon} inline="start" />
              导出 CSV
            </Button>
            {isMaintainer && (
              <Button onClick={() => setCreating(true)}>
                <Icon icon={Add01Icon} inline="start" />
                新建服务单元
              </Button>
            )}
          </>
        }
      />

      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称、拼音码或代码" />}>
        <FilterPill
          label="院区"
          icon={Building03Icon}
          value={f.campus}
          onChange={(v) => f.set('campus', v)}
          options={campuses.map((c) => ({ value: String(c.id), label: c.version.name }))}
          optionsStatus={readStatus(campusQuery)}
        />
        <FilterPill
          label="部门"
          icon={UserGroupIcon}
          value={f.dept}
          onChange={(v) => f.set('dept', v)}
          options={departments.map((d) => ({ value: String(d.id), label: d.version.name }))}
          optionsStatus={deptStatus}
        />
        {f.dept && <ToggleChip label="含下级部门" checked={f.sub} onChange={(v) => f.set('sub', v ? '1' : '')} />}
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
        {showMore ? (
          <>
            <FilterPill
              label="运营主体"
              icon={Hospital01Icon}
              value={f.inst}
              onChange={(v) => f.set('inst', v)}
              options={institutions.map((i) => ({ value: String(i.id), label: i.version.name }))}
              optionsStatus={readStatus(instQuery)}
            />
            <FilterPill label="主分类" icon={ListViewIcon} value={f.cls} onChange={(v) => f.set('cls', v)} options={classOptions} optionsStatus={deptStatus} />
          </>
        ) : (
          <Button variant="ghost" size="sm" className="text-fg-muted" onClick={() => setMore(true)}>
            更多筛选
          </Button>
        )}
        <ToggleChip label="含计划中" checked={f.future} onChange={(v) => f.set('future', v ? '' : '0')} />
        {f.active && (
          <Button variant="ghost" size="sm" className="text-fg-muted" onClick={f.clear}>
            清除筛选
          </Button>
        )}
      </DbToolbar>

      <StaleNotice what="服务单元" query={unitQuery} />
      {status === 'loading' ? (
        <ReadLoading label="正在读取服务单元…" />
      ) : status === 'error' ? (
        <ReadError what={failed.what} query={failed.query} />
      ) : rows.length === 0 ? (
        <DbEmpty
          // 院区、部门、主体在服务端筛：有条件时是“筛选无结果”，不能说成当天没有单元（R-STATE）
          title={f.active || query ? '没有符合条件的服务单元' : `${asOf} 没有服务单元`}
          hint={f.active || query ? '换个筛选条件或搜索词试试。' : '新建服务单元后经提交、确认才会出现在这里。'}
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
          共 <span className="text-fg-secondary">{status === 'ready' ? rows.length : <Unknown reason="服务单元尚未读取成功" />}</span> 个单元
          {status === 'ready' && rows.length !== units.length && `（筛选自 ${units.length} 个）`}
        </span>
        <span>“在运营”= 当天有有效版本，含暂停；已退出的不显示</span>
        <span>导出 CSV 是查看日期当天已生效的全部单元（含暂停，不含计划中与已退出），不按页面筛选</span>
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
        <span className="grid gap-0.5">
          <span className="flex items-center gap-2">
            <Link
              to={`/service-units/${u.id}`}
              className="text-fg-strong decoration-line-strong truncate font-medium underline-offset-4 hover:underline"
            >
              {v.name}
            </Link>
            {u.not_yet_effective && <Tag tone={PLANNED_TONE}>计划中</Tag>}
          </span>
          <span className="text-fg-muted text-caption whitespace-nowrap">
            <span className="font-mono select-all">{u.code}</span>
            {/* 后续版本用文字说明，不只放一个时钟图标（SC-06） */}
            {u.has_later_versions && <> · 之后有已确认的新版本</>}
          </span>
        </span>
      </DbCell>
      <DbCell className="whitespace-nowrap">{typeName}</DbCell>
      <DbCell className="whitespace-nowrap">
        <Link to={`/departments/${v.department_id}`} className="hover:underline">
          {v.department_name}
        </Link>
        {v.department_lifecycle !== 'ACTIVE' && (
          <Tag tone="orange" className="ml-1.5">
            部门非正式履职
          </Tag>
        )}
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
      <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">
        {v.valid_from} 至 {v.valid_to ?? '长期'}
      </DbCell>
    </DbRow>
  )
}
