// 服务单元详情：页头属性 + 分区（演变关系、分类、外部编码、版本与事件）。
// 服务单元 = 部门 × 院区 × 运营主体 × 期间；拆分、合并产生新身份，前身与后继在“演变关系”里互相可达。
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetServiceUnit } from '@/api/generated/master/master'
import type { DepartmentClassificationOut, LineageOut, ServiceUnitVersionOut } from '@/api/generated/model'
import { EvolveFlow, type FlowUnit } from '@/components/evolve-flow'
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
import { ChangeLink, InlineAction, InlineLink, Section } from '@/components/kit/section'
import { DbCell, DbRow, DbTable } from '@/components/kit/database'
import { DetailFallback } from '@/components/kit/missing'
import { isDenial } from '@/components/kit/read-state'
import { MoreActions } from '@/components/kit/more-actions'
import { PropertyList } from '@/components/kit/property-list'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, period, stamp, UNIT_STATUS, versionNote, type UnitStatus } from '@/lib/format'
import { UNIT_STATUS_TONE } from '@/lib/tones'
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
  usePageFrame('document')
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const query = useGetServiceUnit(id, { as_of: asOf })
  const { data } = query
  const [dialog, setDialog] = useState<UnitDialog | null>(null)
  const [closing, setClosing] = useState<DepartmentClassificationOut | null>(null)
  useCrumb(data && !isDenial(query.error) ? `${data.code} ${data.versions[0].name}` : null)
  if (!data || isDenial(query.error))
    return (
      <DetailFallback what="服务单元" back={{ to: '/service-units', label: '返回服务单元列表' }} query={query} invalid={!Number.isInteger(id)} />
    )

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

  // 统一规范 SC-07：名称 / 代码 / 版本 → 关键关系（类型、状态、所属部门、院区、运营主体、业务期间）→ 次要属性 →
  // 演变关系 → 分类 → 外部编码 → 版本与事件。“修订”是页头主动作；拆分、合并是低频动作，收进“更多”；
  // 暂停 / 恢复、更换部门、重新绑定院区留在对应属性旁；永久退出放在版本与事件一节，不与修订并排。
  // 属性按查看日期那一版显示；所有动作都作用在最新一版上
  return (
    <>
      <PageHeader
        title={shown.name}
        description={
          <>
            单元代码 <span className="font-mono">{data.code}</span> · {versionNote(data.versions, asOf)}
          </>
        }
        actions={
          canEdit && (
            <>
              <MoreActions
                items={[
                  { label: '拆分为新单元…', onClick: () => setDialog('split') },
                  { label: '与其他单元合并…', onClick: () => setDialog('merge') },
                ]}
              />
              <Button onClick={() => setDialog('revise')}>修订</Button>
            </>
          )
        }
      />

      <PropertyList
        items={[
          { label: '单元类型', value: typeName },
          {
            label: '状态',
            value: (
              <>
                <Tag tone={UNIT_STATUS_TONE[statusKey]}>{gone ? '已退出' : UNIT_STATUS[shown.status as UnitStatus]}</Tag>
                {canEdit && <InlineAction onClick={() => setDialog('status')}>{latest.status === 'ACTIVE' ? '暂停' : '恢复'}</InlineAction>}
              </>
            ),
          },
          {
            label: '所属部门',
            value: (
              <>
                <Link className="hover:underline" to={`/departments/${shown.department_id}`}>
                  {shown.department_name}
                </Link>
                {shown.department_lifecycle !== 'ACTIVE' && (
                  <Tag tone="orange" className="ml-2">
                    部门非正式履职
                  </Tag>
                )}
                {canEdit && <InlineAction onClick={() => setDialog('department')}>更换</InlineAction>}
              </>
            ),
          },
          {
            label: '所属院区',
            value: (
              <>
                <Link className="hover:underline" to={`/campuses/${shown.campus_id}`}>
                  {shown.campus_name}
                </Link>
                {canEdit && <InlineAction onClick={() => setDialog('rebind')}>重新绑定</InlineAction>}
              </>
            ),
          },
          {
            label: '运营主体',
            value: (
              <Link className="hover:underline" to={`/institutions/${shown.institution_id}`}>
                {shown.institution_name}
              </Link>
            ),
          },
          {
            label: '业务期间',
            value: (
              <>
                {period(shown.valid_from, shown.valid_to)}
                {shown.valid_to && shown.valid_to >= shown.valid_from && <span className="text-fg-secondary text-caption ml-2">结束日当天仍有效</span>}
              </>
            ),
          },
        ]}
      />
      <div className="border-line-subtle mt-3 border-t pt-3">
        <PropertyList
          items={[
            { label: '电话', value: shown.phone },
            { label: '拼音码', value: shown.pinyin && <span className="font-mono">{shown.pinyin}</span> },
            { label: '范围说明', value: shown.scope_note },
          ]}
        />
      </div>

      <div className="mt-8 grid gap-8">
        {retired && (
          <Callout tone="warning" title={`最后有效日 ${data.retired_after}`}>
            该单元已永久退出（最后有效日当天仍有效），之后不再有新版本；代码 {data.code} 永久绑定，不会被复用。
            {data.successors.length > 0 && ' 后继单元见下方“演变关系”。'}
          </Callout>
        )}

        <Section title="演变关系">
          {data.predecessors.length === 0 && data.successors.length === 0 ? (
            <p className="text-fg-secondary text-xs">
              本单元不是由拆分或合并产生的，也没有拆分或合并成其他单元。
              <br />
              拆分、合并的后继是新身份、新代码，不继承前身的版本历史，也不自动迁移外部编码等引用。
            </p>
          ) : (
            <>
              {data.predecessors.length > 0 && (
                <LineageFlow rows={data.predecessors} side="predecessor" self={{ name: latest.name, code: data.code }} />
              )}
              {data.successors.length > 0 && (
                <LineageFlow rows={data.successors} side="successor" self={{ name: latest.name, code: data.code }} />
              )}
              <p className="text-fg-secondary text-caption">
                {data.predecessors.length === 0 && '本单元不是由拆分或合并产生的。'}
                {data.successors.length === 0 && '本单元没有拆分或合并成其他单元。'}
                拆分、合并只填一个生效日：前身最后有效日为其前一日，后继自生效日起。后继是新身份、新代码，不继承前身的版本历史，也不自动迁移引用（如外部编码）。
              </p>
            </>
          )}
        </Section>

        <Section title="分类" action={canEdit ? <InlineAction onClick={() => setDialog('classify')}>设置分类</InlineAction> : null}>
          {data.classifications.length === 0 ? (
            <p className="text-fg-secondary text-xs">没有分类。所属部门的分类不会自动下发给单元。</p>
          ) : (
            <DbTable columns={[{ label: '分类方案' }, { label: '分类' }, { label: '分类期间' }, { label: '来源申请' }, { label: '' }]}>
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
                    <DbCell className="whitespace-nowrap">{period(c.valid_from, c.valid_to)}</DbCell>
                    <DbCell>
                      <ChangeLink id={c.change_id} />
                    </DbCell>
                    <DbCell className="text-right">
                      {canEdit && c.valid_to === null && (
                        <Button size="sm" variant="ghost" onClick={() => setClosing(c)}>
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

        <Section title="外部编码" action={<InlineLink to="/standards/code-mapping">到编码映射台账维护</InlineLink>}>
          <ExternalCodeLinks rows={data.external_codes} asOf={asOf} empty="没有外部代码的解释指向本单元" />
        </Section>

        <Section
          title="版本与事件"
          action={
            canEdit ? (
              <InlineAction danger onClick={() => setDialog('retire')}>
                永久退出…
              </InlineAction>
            ) : null
          }
        >
          <VersionTimeline
            versions={data.versions}
            fields={UNIT_FIELDS}
            asOf={asOf}
            first={{
              title: '开设',
              detail: (v) => `${formatValue('unit_type', data.unit_type, optionLabels)} · ${v.department_name} · ${v.campus_name}`,
            }}
          />
          <p className="text-fg-secondary text-caption">
            登记于 {stamp(data.created_at)}（<ChangeLink id={data.created_change_id} />）。
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
    </>
  )
}

// ------------------------------------------------------------------ 小件

const LINEAGE_LABEL = { SPLIT: '拆分', MERGE: '合并' } as const

/** 演变关系图：前身 → 本单元，或本单元 → 后继；点节点跳到另一端单元 */
function LineageFlow({
  rows,
  side,
  self,
}: {
  rows: LineageOut[]
  side: 'predecessor' | 'successor'
  self: { name: string; code: string }
}) {
  const day = rows[0].effective_date
  const kind = rows[0].lineage_type === 'MERGE' ? 'merge' : 'split'
  const others: FlowUnit[] = rows.map((l) =>
    side === 'predecessor'
      ? { name: l.predecessor_name, code: l.predecessor_code, footer: `最后有效日 ${dayBefore(day)}`, tag: { label: '前身', tone: 'retire' }, href: `/service-units/${l.predecessor_id}` }
      : { name: l.successor_name, code: l.successor_code, footer: `自 ${day} 起`, tag: { label: '后继', tone: 'new' }, href: `/service-units/${l.successor_id}` },
  )
  const me: FlowUnit = {
    ...self,
    footer: side === 'predecessor' ? `自 ${day} 起` : `最后有效日 ${dayBefore(day)}`,
    tag: { label: '本单元', tone: 'current' },
  }
  return (
    <div className="grid gap-1">
      <EvolveFlow
        kind={kind}
        day={day}
        before={side === 'predecessor' ? others : [me]}
        after={side === 'predecessor' ? [me] : others}
      />
      <p className="text-fg-muted text-caption">
        {side === 'predecessor' ? '本单元由上图左侧单元' : '本单元'}
        {LINEAGE_LABEL[rows[0].lineage_type]}
        {side === 'predecessor' ? '而来' : '为上图右侧单元'}，来源申请 <ChangeLink id={rows[0].change_id} />
        {side === 'predecessor' && kind === 'split' && '；同一次拆分的其他后继见前身单元页'}
      </p>
    </div>
  )
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
