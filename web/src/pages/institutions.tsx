import { Add01Icon, Calendar03Icon, HashtagIcon, LicenseIcon, TextFontIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetInstitution, useListCampuses, useListInstitutions, useListOperatorRelations } from '@/api/generated/master/master'
import type { InstitutionVersionOut } from '@/api/generated/model'
import { InstitutionCreateDialog, InstitutionReviseDialog, RelationCreateDialog } from '@/components/forms/change-forms'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { DetailFallback } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { InlineAction, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { OperatorFlow } from '@/components/operator-flow'
import { RelationsTable } from '@/components/relations-table'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, period, versionNote } from '@/lib/format'
import { useMe } from '@/lib/use-me'
import { PLANNED_TONE } from '@/lib/tones'

export function InstitutionsPage() {
  usePageFrame('work')
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListInstitutions({ as_of: asOf })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="主体"
        description="法人或登记主体。主体不设业务状态，终止关系通过关闭运营关系表达。"
        actions={
          isMaintainer && (
            <Button onClick={() => setCreating(true)}>
              <Icon icon={Add01Icon} inline="start" />
              新建主体
            </Button>
          )
        }
      />
      {!isPending && rows.length === 0 ? (
        <DbEmpty title={`${asOf} 没有主体`} hint="初始导入也作为一张变更申请，提交并确认一次。" />
      ) : (
        // 统一规范 v1.0 SC-08：名称（管理代码在辅助行）/ 主体性质 / 统一社会信用代码 / 版本期间
        <DbTable
          columns={[
            { label: '名称', icon: TextFontIcon, className: 'min-w-48' },
            { label: '主体性质', icon: LicenseIcon },
            { label: '统一社会信用代码', icon: HashtagIcon },
            { label: '版本期间', icon: Calendar03Icon },
          ]}
        >
          {rows.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link
                      className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline"
                      to={`/institutions/${r.id}`}
                    >
                      {r.version.name}
                    </Link>
                    {r.not_yet_effective && <Tag tone={PLANNED_TONE}>计划中</Tag>}
                    {r.has_later_versions && <Tag tone="blue">有后续版本</Tag>}
                  </span>
                  <span className="text-fg-muted font-mono text-caption select-all">{r.code}</span>
                </span>
              </DbCell>
              <DbCell className="whitespace-nowrap">{formatValue('nature', r.version.nature)}</DbCell>
              <DbCell className="font-mono text-caption whitespace-nowrap select-all">
                {r.version.unified_credit_code ?? <span className="text-fg-muted font-sans">未登记</span>}
              </DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">{period(r.version.valid_from, r.version.valid_to)}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{rows.length}</span> 个主体
        </span>
        <span>显示 {asOf} 当天有效的版本</span>
      </DbFooter>

      {creating && <InstitutionCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

const FIELDS: (keyof InstitutionVersionOut)[] = [
  'name',
  'nature',
  'unified_credit_code',
  'medical_reg_code',
  'license_no',
  'license_valid_from',
  'license_valid_to',
]

export function InstitutionDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const query = useGetInstitution(id, { as_of: asOf })
  const { data } = query
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: relations = [] } = useListOperatorRelations({ as_of: asOf, institution_id: id, include_future: true })
  const [dialog, setDialog] = useState<'revise' | 'relation' | null>(null)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data)
    return <DetailFallback what="主体" back={{ to: '/institutions', label: '返回主体列表' }} query={query} invalid={!Number.isInteger(id)} />

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? latest
  const close = (o: boolean) => !o && setDialog(null)

  // 统一规范 SC-08：名称 / 代码 / 版本 → 登记属性 → 运营的院区（图 + 明细）→ 版本与事件。
  // 主体没有业务启停状态；“建立运营关系”只放在运营院区一节的标题右侧
  return (
    <>
      <PageHeader
        title={shown.name}
        description={
          <>
            主体代码 <span className="font-mono">{data.code}</span> · {versionNote(data.versions, asOf)}
          </>
        }
        actions={isMaintainer && <Button onClick={() => setDialog('revise')}>修订</Button>}
      />

      <PropertyList
        items={[
          { label: '主体性质', icon: LicenseIcon, value: shown.nature },
          { label: '统一社会信用代码', icon: HashtagIcon, value: shown.unified_credit_code && <span className="font-mono break-all">{shown.unified_credit_code}</span> },
          { label: '医疗机构登记号', icon: HashtagIcon, value: shown.medical_reg_code && <span className="font-mono break-all">{shown.medical_reg_code}</span> },
          { label: '执业许可证号', icon: LicenseIcon, value: shown.license_no && <span className="font-mono break-all">{shown.license_no}</span> },
          {
            label: '许可证有效期',
            icon: Calendar03Icon,
            value: shown.license_valid_from || shown.license_valid_to ? `${shown.license_valid_from ?? '未登记'} 至 ${shown.license_valid_to ?? '长期'}` : null,
          },
          { label: '版本期间', icon: Calendar03Icon, value: period(shown.valid_from, shown.valid_to) },
        ]}
      />

      <div className="mt-8 grid gap-8">
        <Section
          title={`运营的院区（${new Set(data.relations.map((r) => r.campus_id)).size}）`}
          action={isMaintainer ? <InlineAction onClick={() => setDialog('relation')}>建立运营关系</InlineAction> : null}
        >
          <OperatorFlow
            institutions={[{ id: data.id, code: data.code, name: shown.name, subtitle: shown.nature ?? undefined }]}
            campuses={campuses}
            relations={relations}
            asOf={asOf}
          />
          <RelationsTable relations={data.relations} canEdit={isMaintainer} hide="institution" />
        </Section>

        <Section title="版本与事件">
          <VersionTimeline
            versions={data.versions}
            fields={FIELDS}
            asOf={asOf}
            first={{ title: '建立', detail: (v) => [v.nature, v.unified_credit_code].filter(Boolean).join('，') }}
          />
        </Section>
      </div>
      {dialog === 'revise' && <InstitutionReviseDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'relation' && <RelationCreateDialog open onOpenChange={close} institutionCode={data.code} />}
    </>
  )
}
