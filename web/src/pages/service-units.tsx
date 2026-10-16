// 服务单元详情：页头属性 + 分区（演变关系、分类、外部编码、版本时间线）。
// 服务单元 = 部门 × 院区 × 运营主体 × 期间；拆分、合并产生新身份，前身与后继在“演变关系”里互相可达。
import {
  Building03Icon,
  Calendar03Icon,
  CallIcon,
  GridViewIcon,
  Hospital01Icon,
  ListViewIcon,
  Loading03Icon,
  TextFontIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetServiceUnit } from '@/api/generated/master/master'
import type { DepartmentClassificationOut, LineageOut, ServiceUnitVersionOut } from '@/api/generated/model'
import { ExternalCodeLinks } from '@/components/external-code-links'
import { ClassificationCloseDialog, ClassifyDialog } from '@/components/forms/code-forms'
import {
  UnitChangeDepartmentDialog,
  UnitMergeDialog,
  UnitRebindDialog,
  UnitRetireDialog,
  UnitReviseDialog,
  UnitSplitDialog,
  UnitStatusDialog,
} from '@/components/forms/unit-forms'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbRow, DbTable } from '@/components/kit/database'
import { Missing } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, stamp, UNIT_STATUS, type UnitStatus } from '@/lib/format'
import { DEPARTMENT_LIFECYCLE_TONE, LINEAGE_TONE, UNIT_STATUS_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

const UNIT_FIELDS: (keyof ServiceUnitVersionOut)[] = [
  'name',
  'department_name',
  'campus_name',
  'institution_name',
  'status',
  'phone',
  'scope_note',
]

type UnitDialog = 'revise' | 'rebind' | 'department' | 'status' | 'retire' | 'classify' | 'split' | 'merge'

export function ServiceUnitDetailPage() {
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const { data, isError } = useGetServiceUnit(id, { as_of: asOf })
  const [dialog, setDialog] = useState<UnitDialog | null>(null)
  const [closing, setClosing] = useState<DepartmentClassificationOut | null>(null)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="服务单元" back={{ to: '/service-units', label: '返回服务单元列表' }} /> : null

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? latest
  const retired = data.retired_after !== null
  const gone = retired && asOf > (data.retired_after ?? '')
  const close = (o: boolean) => !o && setDialog(null)
  const dialogProps = { open: true, onOpenChange: close, code: data.code, current: latest }
  const typeName = formatValue('unit_type', data.unit_type, optionLabels)
  const statusKey = gone ? 'RETIRED' : shown.status
  const canEdit = isMaintainer && !retired

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={GridViewIcon}
        title={shown.name}
        description={
          onDay
            ? `单元代码 ${data.code} · ${asOf} 有效的是第 ${onDay.version_no} 版`
            : gone
              ? `单元代码 ${data.code} · 已于 ${data.retired_after} 后永久退出，下面显示最后一版`
              : `单元代码 ${data.code} · ${asOf} 尚未生效，自 ${data.versions.at(-1)!.valid_from} 起`
        }
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => setDialog('split')}>
                拆分
              </Button>
              <Button variant="outline" onClick={() => setDialog('merge')}>
                合并
              </Button>
              <Button onClick={() => setDialog('revise')}>修订</Button>
            </>
          )
        }
      />

      <PropertyList
        items={[
          { label: '单元类型', icon: ListViewIcon, value: <Tag>{typeName}</Tag> },
          {
            label: '状态',
            icon: Loading03Icon,
            value: (
              <>
                <Tag tone={UNIT_STATUS_TONE[statusKey]}>{gone ? '已退出' : UNIT_STATUS[shown.status as UnitStatus]}</Tag>
                {canEdit && <Action onClick={() => setDialog('status')}>{latest.status === 'ACTIVE' ? '暂停' : '恢复'}</Action>}
              </>
            ),
          },
          {
            label: '所属部门',
            icon: UserGroupIcon,
            value: (
              <>
                <Link className="hover:underline" to={`/departments/${shown.department_id}`}>
                  {shown.department_name}
                </Link>
                {shown.department_lifecycle !== 'ACTIVE' && (
                  <Tag tone={DEPARTMENT_LIFECYCLE_TONE[shown.department_lifecycle]} className="ml-2">
                    部门非正式履职
                  </Tag>
                )}
                {canEdit && <Action onClick={() => setDialog('department')}>更换</Action>}
              </>
            ),
          },
          {
            label: '所属院区',
            icon: Building03Icon,
            value: (
              <>
                <Link className="hover:underline" to={`/campuses/${shown.campus_id}`}>
                  {shown.campus_name}
                </Link>
                {canEdit && <Action onClick={() => setDialog('rebind')}>重新绑定</Action>}
              </>
            ),
          },
          {
            label: '所属运营主体',
            icon: Hospital01Icon,
            value: (
              <Link className="hover:underline" to={`/institutions/${shown.institution_id}`}>
                {shown.institution_name}
              </Link>
            ),
          },
          { label: '期间', icon: Calendar03Icon, value: `${shown.valid_from} → ${shown.valid_to ?? '长期'}` },
          { label: '电话', icon: CallIcon, value: shown.phone },
          { label: '范围说明', icon: TextFontIcon, value: shown.scope_note },
        ]}
      />

      <div className="mt-8 grid gap-8">
        {retired && (
          <Callout tone="warning" title={`最后有效日 ${data.retired_after}`}>
            该单元已永久退出（最后有效日当天仍有效）；代码 {data.code} 永久绑定，不会被复用。
            {data.successors.length > 0 && ' 后继单元见下方“演变关系”。'}
          </Callout>
        )}

        <Section title="演变关系">
          <LineageTable rows={data.predecessors} side="predecessor" empty="不是由拆分或合并产生的" />
          <LineageTable rows={data.successors} side="successor" empty="没有拆分或合并成其他单元" />
          <p className="text-fg-muted text-caption">
            拆分、合并只填一个生效日：前身最后有效日为其前一日，后继自生效日起。后继是新身份、新代码，不继承前身的版本历史，也不自动迁移引用（如外部代码）。
          </p>
        </Section>

        <Section title="分类" action={canEdit ? <Action onClick={() => setDialog('classify')}>设置分类</Action> : null}>
          {data.classifications.length === 0 ? (
            <p className="text-fg-disabled text-xs">没有分类。所属部门的分类不会自动下发给单元。</p>
          ) : (
            <DbTable columns={[{ label: '分类方案' }, { label: '分类' }, { label: '期间', icon: Calendar03Icon }, { label: '来源申请' }, { label: '' }]}>
              {data.classifications.map((c) => {
                const current = c.valid_from <= asOf && (c.valid_to === null || c.valid_to >= asOf)
                return (
                  <DbRow key={c.id} className={cn(!current && 'text-fg-muted')}>
                    <DbCell className="whitespace-nowrap">{c.scheme_name}</DbCell>
                    <DbCell>
                      <Tag tone={current ? 'blue' : 'gray'}>
                        {c.code} {c.name}
                      </Tag>
                    </DbCell>
                    <DbCell className="whitespace-nowrap">
                      {c.valid_from} → {c.valid_to ?? '长期'}
                    </DbCell>
                    <DbCell>
                      <ChangeLink id={c.change_id} />
                    </DbCell>
                    <DbCell className="text-right">
                      {canEdit && c.valid_to === null && (
                        <Button size="xs" variant="ghost" onClick={() => setClosing(c)}>
                          结束
                        </Button>
                      )}
                    </DbCell>
                  </DbRow>
                )
              })}
            </DbTable>
          )}
        </Section>

        <Section
          title="外部编码"
          action={
            <Link to="/standards/code-mapping" className="text-fg-muted hover:text-fg text-caption hover:underline">
              到编码映射台账维护
            </Link>
          }
        >
          <ExternalCodeLinks rows={data.external_codes} asOf={asOf} empty="没有外部代码的解释指向本单元" />
        </Section>

        <Section title="版本时间线">
          <VersionTimeline versions={data.versions} fields={UNIT_FIELDS} asOf={asOf} />
          <p className="text-fg-muted text-caption">
            新建于 {stamp(data.created_at)}（<ChangeLink id={data.created_change_id} />）。
            {canEdit && (
              <button type="button" className="text-danger-text ml-2 hover:underline" onClick={() => setDialog('retire')}>
                永久退出…
              </button>
            )}
          </p>
        </Section>
      </div>

      {dialog === 'revise' && <UnitReviseDialog {...dialogProps} />}
      {dialog === 'rebind' && <UnitRebindDialog {...dialogProps} />}
      {dialog === 'department' && <UnitChangeDepartmentDialog {...dialogProps} />}
      {dialog === 'status' && <UnitStatusDialog {...dialogProps} />}
      {dialog === 'retire' && <UnitRetireDialog {...dialogProps} />}
      {dialog === 'split' && <UnitSplitDialog {...dialogProps} unitType={data.unit_type} />}
      {dialog === 'merge' && <UnitMergeDialog {...dialogProps} unitType={data.unit_type} />}
      {dialog === 'classify' && <ClassifyDialog open onOpenChange={close} owner="unit" code={data.code} name={latest.name} />}
      {closing && <ClassificationCloseDialog open onOpenChange={(o) => !o && setClosing(null)} owner="unit" classification={closing} />}
    </div>
  )
}

// ------------------------------------------------------------------ 小件
function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="text-fg-muted hover:text-fg ml-2 text-caption hover:underline" onClick={onClick}>
      {children}
    </button>
  )
}

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

function ChangeLink({ id }: { id: number }) {
  return (
    <Link to={`/changes/${id}`} className="text-fg-secondary hover:underline">
      #{id}
    </Link>
  )
}

const LINEAGE_LABEL = { SPLIT: '拆分', MERGE: '合并' } as const

function LineageTable({ rows, side, empty }: { rows: LineageOut[]; side: 'predecessor' | 'successor'; empty: string }) {
  const label = side === 'predecessor' ? '前身（本单元由它们而来）' : '后继（本单元变成了它们）'
  if (rows.length === 0)
    return (
      <p className="text-fg-disabled text-xs">
        {side === 'predecessor' ? '前身' : '后继'}：{empty}
      </p>
    )
  return (
    <DbTable columns={[{ label }, { label: '方式' }, { label: '生效日', icon: Calendar03Icon }, { label: '来源申请' }]}>
      {rows.map((l) => {
        const other =
          side === 'predecessor'
            ? { id: l.predecessor_id, code: l.predecessor_code, name: l.predecessor_name }
            : { id: l.successor_id, code: l.successor_code, name: l.successor_name }
        return (
          <DbRow key={l.id}>
            <DbCell>
              <Link to={`/service-units/${other.id}`} className="hover:underline">
                {other.name}
              </Link>
              <span className="text-fg-muted ml-2 font-mono text-caption">{other.code}</span>
            </DbCell>
            <DbCell>
              <Tag tone={LINEAGE_TONE[l.lineage_type]}>{LINEAGE_LABEL[l.lineage_type]}</Tag>
            </DbCell>
            <DbCell className="whitespace-nowrap">{l.effective_date}</DbCell>
            <DbCell>
              <ChangeLink id={l.change_id} />
            </DbCell>
          </DbRow>
        )
      })}
    </DbTable>
  )
}
