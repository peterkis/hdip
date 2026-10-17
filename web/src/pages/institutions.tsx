import { Add01Icon, Calendar03Icon, HashtagIcon, Hospital01Icon, LicenseIcon, TextFontIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetInstitution, useListCampuses, useListInstitutions, useListOperatorRelations } from '@/api/generated/master/master'
import type { InstitutionVersionOut } from '@/api/generated/model'
import { InstitutionCreateDialog, InstitutionReviseDialog, RelationCreateDialog } from '@/components/forms/change-forms'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable } from '@/components/kit/database'
import { Icon } from '@/components/kit/icon'
import { Missing } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { InlineAction, Section } from '@/components/kit/section'
import { Tag } from '@/components/kit/tag'
import { PageHeader } from '@/components/layout'
import { OperatorFlow } from '@/components/operator-flow'
import { RelationsTable } from '@/components/relations-table'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, period } from '@/lib/format'
import { useMe } from '@/lib/use-me'

export function InstitutionsPage() {
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListInstitutions({ as_of: asOf })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: relations = [] } = useListOperatorRelations({ as_of: asOf, include_future: true })
  const [creating, setCreating] = useState(false)

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={Hospital01Icon}
        title="主体"
        description="法人或登记主体。主体不设业务状态，终止关系通过关闭运营关系表达。"
        actions={
          isMaintainer && (
            <Button onClick={() => setCreating(true)}>
              <Icon icon={Add01Icon} inline="start" />
              新建
            </Button>
          )
        }
      />
      {!isPending && rows.length === 0 ? (
        <DbEmpty title={`${asOf} 没有主体`} hint="初始导入也作为一张变更申请，提交并确认一次。" />
      ) : (
        <DbTable
          columns={[
            { label: '名称', icon: TextFontIcon, className: 'min-w-48' },
            { label: '代码', icon: HashtagIcon },
            { label: '主体性质', icon: LicenseIcon },
            { label: '统一社会信用代码', icon: HashtagIcon },
            { label: '版本期间', icon: Calendar03Icon },
          ]}
        >
          {rows.map((r) => (
            <DbRow key={r.id}>
              <DbCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Link
                    className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline"
                    to={`/institutions/${r.id}`}
                  >
                    {r.version.name}
                  </Link>
                  {r.not_yet_effective && <Tag tone="gray">计划中</Tag>}
                  {r.has_later_versions && <Tag tone="blue">有后续版本</Tag>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{r.code}</DbCell>
              <DbCell className="whitespace-nowrap">{formatValue('nature', r.version.nature)}</DbCell>
              <DbCell className="font-mono text-caption whitespace-nowrap">{formatValue('unified_credit_code', r.version.unified_credit_code)}</DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap">{period(r.version.valid_from, r.version.valid_to)}</DbCell>
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

      {rows.length > 0 && (
        <div className="mt-8">
          <Section title={`主体—院区运营关系（${asOf}）`}>
            <OperatorFlow
              institutions={rows.map((r) => ({ id: r.id, code: r.code, name: r.version.name, subtitle: r.version.nature ?? undefined }))}
              campuses={campuses}
              relations={relations}
              asOf={asOf}
              allCampuses
            />
          </Section>
        </div>
      )}
      {creating && <InstitutionCreateDialog open onOpenChange={setCreating} />}
    </div>
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
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data, isError } = useGetInstitution(id, { as_of: asOf })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: relations = [] } = useListOperatorRelations({ as_of: asOf, institution_id: id, include_future: true })
  const [dialog, setDialog] = useState<'revise' | 'relation' | null>(null)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="主体" back={{ to: '/institutions', label: '返回主体列表' }} /> : null

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const shown = onDay ?? latest
  const close = (o: boolean) => !o && setDialog(null)

  return (
    <div className="max-w-(--hd-page-max-width)">
      <PageHeader
        icon={Hospital01Icon}
        title={shown.name}
        description={
          onDay
            ? `主体代码 ${data.code} · ${asOf} 有效的是第 ${onDay.version_no} 版`
            : `主体代码 ${data.code} · ${asOf} 尚未生效，自 ${data.versions.at(-1)!.valid_from} 起`
        }
        actions={
          isMaintainer && (
            <>
              <Button variant="outline" onClick={() => setDialog('relation')}>
                建立运营关系
              </Button>
              <Button onClick={() => setDialog('revise')}>修订</Button>
            </>
          )
        }
      />

      <PropertyList
        items={[
          { label: '主体性质', icon: LicenseIcon, value: shown.nature },
          { label: '统一社会信用代码', icon: HashtagIcon, value: shown.unified_credit_code && <span className="font-mono">{shown.unified_credit_code}</span> },
          { label: '医疗机构登记号', icon: HashtagIcon, value: shown.medical_reg_code },
          { label: '执业许可证号', icon: LicenseIcon, value: shown.license_no },
          {
            label: '许可证有效期',
            icon: Calendar03Icon,
            value: shown.license_valid_from || shown.license_valid_to ? `${shown.license_valid_from ?? '—'} → ${shown.license_valid_to ?? '长期'}` : null,
          },
          { label: '版本期间', icon: Calendar03Icon, value: `${shown.valid_from} → ${shown.valid_to ?? '长期'}` },
        ]}
      />

      <div className="mt-8 grid gap-8">
        <Section
          title="运营的院区"
          action={isMaintainer ? <InlineAction onClick={() => setDialog('relation')}>建立运营关系</InlineAction> : null}
        >
          <OperatorFlow
            institutions={[{ id: data.id, code: data.code, name: shown.name, subtitle: shown.nature ?? undefined }]}
            campuses={campuses}
            relations={relations}
            asOf={asOf}
          />
          <RelationsTable relations={data.relations} canEdit={isMaintainer} />
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
    </div>
  )
}
