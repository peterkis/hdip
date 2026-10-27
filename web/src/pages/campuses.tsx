import {
  Add01Icon,
  Calendar03Icon,
  CallIcon,
  HashtagIcon,
  Hospital01Icon,
  Loading03Icon,
  Location01Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetCampus, useListCampuses, useListServiceUnits } from '@/api/generated/master/master'
import type { CampusVersionOut } from '@/api/generated/model'
import { OperatingStatusBadge } from '@/components/badges'
import { CampusCreateDialog, CampusReviseDialog, CampusStatusDialog, RelationCreateDialog } from '@/components/forms/change-forms'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { DetailFallback } from '@/components/kit/missing'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { PropertyList } from '@/components/kit/property-list'
import { InlineAction, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { ExpandableText } from '@/components/kit/expandable-text'
import { RelationsTable } from '@/components/relations-table'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { UnitsTable } from '@/components/units-table'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, period, versionNote, type OperatingStatus } from '@/lib/format'
import { useListReturn } from '@/lib/scroll-memory'
import { useMe } from '@/lib/use-me'
import { PLANNED_TONE } from '@/lib/tones'

export function CampusesPage() {
  usePageFrame('work')
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  // 读取状态（U3R-03）：空态与计数只由当前查看日期读取成功的数据得出
  const list = useListCampuses({ as_of: asOf })
  const status = readStatus(list)
  const rows = list.data ?? []
  const [creating, setCreating] = useState(false)
  // 返回上下文（U3R-05）：本页只按查看日期取数，返回时回到原位置与原对象
  const back = useListReturn({ scope: asOf, ready: status === 'ready' })

  return (
    <>
      <PageHeader
        title="院区"
        description="院区不等于法人；由哪个主体运营，看运营关系。筹建中的院区也在这里，标出开始日。"
        actions={
          isMaintainer && (
            <Button onClick={() => setCreating(true)}>
              <Icon icon={Add01Icon} inline="start" />
              新建院区
            </Button>
          )
        }
      />
      <StaleNotice what="院区" query={list} />
      {status === 'loading' ? (
        <ReadLoading label="正在读取院区…" />
      ) : status === 'error' ? (
        <ReadError what="院区" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty title={`${asOf} 没有院区`} hint="新建院区后经提交、确认才会出现在这里。" />
      ) : (
        // 统一规范 v1.0 SC-09：院区名称（代码 / 对外称谓在辅助行）/ 运营状态 / 主要运营方 / 地址 / 版本期间
        <div onClickCapture={back.onClickCapture}>
        <DbTable
          columns={[
            { label: '名称', icon: TextFontIcon, className: 'min-w-44' },
            { label: '运营状态', icon: Loading03Icon },
            { label: '主要运营方', icon: Hospital01Icon },
            { label: '地址', icon: Location01Icon },
            { label: '版本期间', icon: Calendar03Icon },
          ]}
        >
          {rows.map((r) => (
            <DbRow key={r.id} returnId={r.id}>
              <DbCell>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline" to={`/campuses/${r.id}`}>
                      {r.version.name}
                    </Link>
                    {r.not_yet_effective && <Tag tone={PLANNED_TONE}>{r.version.valid_from} 起</Tag>}
                  </span>
                  <span className="text-fg-muted text-caption">
                    <span className="font-mono select-all">{r.code}</span>
                    {r.version.public_name && <> · 对外称 {r.version.public_name}</>}
                    {r.has_later_versions && <> · 之后有已确认的新版本</>}
                  </span>
                </span>
              </DbCell>
              <DbCell>
                <OperatingStatusBadge status={r.version.operating_status} />
              </DbCell>
              <DbCell className="whitespace-nowrap">
                {r.primary_operator ? (
                  <Link className="hover:underline" to={`/institutions/${r.primary_operator.institution_id}`}>
                    {r.primary_operator.name}
                  </Link>
                ) : (
                  <span className="text-fg-muted">未登记</span>
                )}
              </DbCell>
              <DbCell className="text-fg-secondary max-w-64">
                {r.version.address ? <ExpandableText text={r.version.address} /> : <span className="text-fg-muted">未登记</span>}
              </DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">{period(r.version.valid_from, r.version.valid_to)}</DbCell>
            </DbRow>
          ))}
        </DbTable>
        </div>
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{status === 'ready' ? rows.length : <Unknown reason="院区尚未读取成功" />}</span> 个院区
        </span>
        <span>显示 {asOf} 当天有效的版本；尚未开始的院区显示最早的计划版本</span>
      </DbFooter>
      {creating && <CampusCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

const CAMPUS_FIELDS: (keyof CampusVersionOut)[] = [
  'name',
  'public_name',
  'operating_status',
  'address',
  'admin_division_code',
  'phone',
  'actual_open_date',
]

export function CampusDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const query = useGetCampus(id, { as_of: asOf }, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  // 下属服务单元是独立读取（U3R-03）：失败时只影响这一节，不写 0 个单元、0 个部门
  const unitsQuery = useListServiceUnits({ as_of: asOf, campus_id: id }, { query: { enabled: Number.isInteger(id) } })
  const unitsStatus = readStatus(unitsQuery)
  const units = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data])
  const [dialog, setDialog] = useState<'revise' | 'status' | 'relation' | 'unit' | null>(null)
  const [showAllDepts, setShowAllDepts] = useState(false)
  useCrumb(data && !isDenial(query.error) ? `${data.code} ${data.versions[0].name}` : null)
  if (!data || isDenial(query.error)) return <DetailFallback what="院区" back={{ to: '/campuses', label: '返回院区列表' }} query={query} invalid={!Number.isInteger(id)} />

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? latest
  const suspended = latest.operating_status === 'SUSPENDED'
  const close = (o: boolean) => !o && setDialog(null)
  const departments = [...new Set(units.filter((u) => !u.not_yet_effective).map((u) => u.version.department_name))]
  const operators = data.relations.filter((r) => r.effective_on_as_of && r.relation_type === 'OPERATE')
  // 查看日期当天还没有运营方时，写出已登记的计划运营方，不写成“未登记”
  const plannedOperators = data.relations.filter((r) => r.relation_type === 'OPERATE' && r.valid_from > asOf)

  // 统一规范 SC-09：名称 / 版本 → 状态与运营主体 → 地点和联系 → 服务单元 → 运营关系 → 版本与事件。
  // 院区不是法人：运营主体与地点分开写；“建立运营关系”“新建服务单元”放在各自一节的标题右侧
  return (
    <>
      <PageHeader
        title={shown.name}
        description={shown.public_name ? <>对外称“{shown.public_name}”</> : undefined}
        meta={
          <>
            院区代码 <span className="font-mono">{data.code}</span> · {versionNote(data.versions, asOf)}
          </>
        }
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to={`/organization-overview?campus=${data.id}&planned=1`} />}>
              查看本院区服务布局
            </Button>
            {isMaintainer && <Button onClick={() => setDialog('revise')}>修订资料</Button>}
          </>
        }
      />
      <StaleNotice what="这个院区" query={query} />

      <PropertyList
        items={[
          {
            label: '运营状态',
            icon: Loading03Icon,
            value: (
              <>
                <OperatingStatusBadge status={shown.operating_status} />
                {isMaintainer && !suspended && <InlineAction onClick={() => setDialog('status')}>变更</InlineAction>}
              </>
            ),
          },
          {
            label: '运营主体',
            icon: Hospital01Icon,
            value: operators.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {operators.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5">
                    <Link className="hover:underline" to={`/institutions/${r.institution_id}`}>
                      {r.institution_name}
                    </Link>
                    {r.is_primary && <Tag tone="blue">主要运营方</Tag>}
                  </span>
                ))}
              </span>
            ) : plannedOperators.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {plannedOperators.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5">
                    <Link className="hover:underline" to={`/institutions/${r.institution_id}`}>
                      {r.institution_name}
                    </Link>
                    <Tag tone="yellow">计划</Tag>
                    <span className="text-fg-secondary text-caption">自 {r.valid_from} 起</span>
                  </span>
                ))}
              </span>
            ) : null,
          },
          { label: '实际启用日期', icon: Calendar03Icon, value: shown.actual_open_date },
          { label: '地址', icon: Location01Icon, value: shown.address },
          { label: '行政区划代码', icon: HashtagIcon, value: shown.admin_division_code && <span className="font-mono">{shown.admin_division_code}</span> },
          { label: '电话', icon: CallIcon, value: shown.phone },
          { label: '拼音码', icon: TextFontIcon, value: shown.pinyin && <span className="font-mono">{shown.pinyin}</span> },
          { label: '版本期间', icon: Calendar03Icon, value: period(shown.valid_from, shown.valid_to) },
        ]}
      />

      <div className="mt-8 grid gap-8">
        {suspended && (
          <Callout tone="warning" title={`该院区自 ${latest.valid_from} 起停用`}>
            停用后不可恢复，也不能再挂新的服务单元；代码 {data.code} 永久绑定。
          </Callout>
        )}
        <Section
          title={unitsStatus === 'ready' ? `服务单元（${units.length}）` : '服务单元'}
          action={isMaintainer && !suspended ? <InlineAction onClick={() => setDialog('unit')}>新建服务单元</InlineAction> : null}
        >
          {unitsStatus === 'loading' && <ReadLoading label="正在读取本院区的服务单元…" rows={3} />}
          {unitsStatus === 'error' && <ReadError what="本院区的服务单元" query={unitsQuery} compact />}
          {unitsStatus === 'ready' && (
          <>
          <StaleNotice what="服务单元" query={unitsQuery} />
          <p className="text-fg-secondary text-caption">
            <Icon icon={UserGroupIcon} className="mr-1 inline size-3.5 align-text-bottom" />
            {departments.length === 0 ? (
              units.length ? '查看日期当天本院区还没有生效的服务单元，下面都是计划中的单元。' : '本院区还没有登记服务单元。'
            ) : (
              <>在本院区设有服务单元的部门（按单元的所属部门去重，不是行政隶属）共 {departments.length} 个：</>
            )}
            {(showAllDepts ? departments : departments.slice(0, 12)).join('、')}
            {departments.length > 12 && (
              <button type="button" className="text-fg-secondary hover:text-fg ml-1 hover:underline" onClick={() => setShowAllDepts(!showAllDepts)}>
                {showAllDepts ? '收起' : `…展开其余 ${departments.length - 12} 个`}
              </button>
            )}
          </p>
          <UnitsTable rows={units} hide={['campus']} />
          </>
          )}
        </Section>

        <Section
          title="运营关系"
          action={isMaintainer && !suspended ? <InlineAction onClick={() => setDialog('relation')}>建立运营关系</InlineAction> : null}
        >
          <RelationsTable relations={data.relations} canEdit={isMaintainer} hide="campus" />
        </Section>

        <Section title="版本与事件">
          <VersionTimeline
            versions={data.versions}
            fields={CAMPUS_FIELDS}
            asOf={asOf}
            first={{
              title: '建立',
              detail: (v) =>
                [formatValue('operating_status', v.operating_status), v.public_name && `对外称 ${v.public_name}`].filter(Boolean).join('，'),
            }}
          />
        </Section>
      </div>
      {dialog === 'revise' && <CampusReviseDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'status' && (
        <CampusStatusDialog open onOpenChange={close} code={data.code} name={latest.name} current={latest.operating_status as OperatingStatus} />
      )}
      {dialog === 'relation' && <RelationCreateDialog open onOpenChange={close} campusCode={data.code} />}
      {dialog === 'unit' && <UnitCreateDialog open onOpenChange={close} campusCode={data.code} />}
    </>
  )
}
