import {
  Add01Icon,
  Building03Icon,
  Calendar03Icon,
  CallIcon,
  HashtagIcon,
  Hospital01Icon,
  Loading03Icon,
  Location01Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetCampus, useListCampuses, useListServiceUnits } from '@/api/generated/master/master'
import type { CampusVersionOut } from '@/api/generated/model'
import { OperatingStatusBadge } from '@/components/badges'
import { CampusCreateDialog, CampusReviseDialog, CampusStatusDialog, RelationCreateDialog } from '@/components/forms/change-forms'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { Missing } from '@/components/kit/missing'
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
import { formatValue, period, type OperatingStatus } from '@/lib/format'
import { useMe } from '@/lib/use-me'
import { PLANNED_TONE } from '@/lib/tones'

export function CampusesPage() {
  usePageFrame('work')
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListCampuses({ as_of: asOf })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        work
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
      {!isPending && rows.length === 0 ? (
        <DbEmpty title={`${asOf} 没有院区`} hint="新建院区后经提交、确认才会出现在这里。" />
      ) : (
        // 统一规范 v1.0 SC-09：院区名称（代码 / 对外称谓在辅助行）/ 运营状态 / 主要运营方 / 地址 / 版本期间
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
            <DbRow key={r.id}>
              <DbCell>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline" to={`/campuses/${r.id}`}>
                      {r.version.name}
                    </Link>
                    {r.not_yet_effective && <Tag tone={PLANNED_TONE}>{r.version.valid_from} 起</Tag>}
                    {r.has_later_versions && <Tag tone="blue">有后续版本</Tag>}
                  </span>
                  <span className="text-fg-muted text-caption">
                    <span className="font-mono select-all">{r.code}</span>
                    {r.version.public_name && <> · 对外称 {r.version.public_name}</>}
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
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{rows.length}</span> 个院区
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
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data, isError } = useGetCampus(id, { as_of: asOf })
  const { data: units = [] } = useListServiceUnits({ as_of: asOf, campus_id: id })
  const [dialog, setDialog] = useState<'revise' | 'status' | 'relation' | 'unit' | null>(null)
  const [showAllDepts, setShowAllDepts] = useState(false)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="院区" back={{ to: '/campuses', label: '返回院区列表' }} /> : null

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? latest
  const suspended = latest.operating_status === 'SUSPENDED'
  const close = (o: boolean) => !o && setDialog(null)
  const departments = [...new Set(units.filter((u) => !u.not_yet_effective).map((u) => u.version.department_name))]
  const operators = data.relations.filter((r) => r.effective_on_as_of && r.relation_type === 'OPERATE')

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={Building03Icon}
        title={shown.name}
        description={
          onDay
            ? `院区代码 ${data.code} · ${asOf} 有效的是第 ${onDay.version_no} 版`
            : `院区代码 ${data.code} · ${asOf} 尚未开始，自 ${data.versions.at(-1)!.valid_from} 起`
        }
        actions={
          <>
            <Button variant="ghost" nativeButton={false} render={<Link to={`/organization-overview?campus=${data.id}&planned=1`} />}>
              查看本院区服务布局
            </Button>
            {isMaintainer && (
              <>
                <Button variant="outline" disabled={suspended} onClick={() => setDialog('relation')}>
                  建立运营关系
                </Button>
                <Button onClick={() => setDialog('revise')}>修订资料</Button>
              </>
            )}
          </>
        }
      />

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
          { label: '对外名称', icon: TextFontIcon, value: shown.public_name },
          { label: '拼音码', icon: TextFontIcon, value: shown.pinyin && <span className="font-mono">{shown.pinyin}</span> },
          {
            label: '运营主体',
            icon: Hospital01Icon,
            value: operators.length ? (
              <span className="flex flex-wrap gap-x-3">
                {operators.map((r) => (
                  <Link key={r.id} className="hover:underline" to={`/institutions/${r.institution_id}`}>
                    {r.institution_name}
                    {r.is_primary && <span className="text-fg-muted text-caption">（主要）</span>}
                  </Link>
                ))}
              </span>
            ) : null,
          },
          { label: '地址', icon: Location01Icon, value: shown.address },
          { label: '行政区划代码', icon: HashtagIcon, value: shown.admin_division_code },
          { label: '电话', icon: CallIcon, value: shown.phone },
          { label: '实际启用日期', icon: Calendar03Icon, value: shown.actual_open_date },
          { label: '版本期间', icon: Calendar03Icon, value: `${shown.valid_from} → ${shown.valid_to ?? '长期'}` },
        ]}
      />

      <div className="mt-8 grid gap-8">
        {suspended && (
          <Callout tone="warning" title={`该院区自 ${latest.valid_from} 起停用`}>
            停用后不可恢复，也不能再挂新的服务单元；代码 {data.code} 永久绑定。
          </Callout>
        )}
        <Section
          title={`服务单元（${units.length}）`}
          action={isMaintainer && !suspended ? <InlineAction onClick={() => setDialog('unit')}>新建服务单元</InlineAction> : null}
        >
          <p className="text-fg-muted text-caption">
            <Icon icon={UserGroupIcon} className="mr-1 inline size-3.5 align-text-bottom" />
            该院区有哪些部门 = 这些单元按所属部门去重，共 {departments.length} 个：
            {(showAllDepts ? departments : departments.slice(0, 12)).join('、') || '无'}
            {departments.length > 12 && (
              <button type="button" className="text-fg-secondary hover:text-fg ml-1 hover:underline" onClick={() => setShowAllDepts(!showAllDepts)}>
                {showAllDepts ? '收起' : `…展开其余 ${departments.length - 12} 个`}
              </button>
            )}
          </p>
          <UnitsTable rows={units} hide={['campus']} />
        </Section>

        <Section title="运营关系">
          <RelationsTable relations={data.relations} canEdit={isMaintainer} />
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
    </div>
  )
}
