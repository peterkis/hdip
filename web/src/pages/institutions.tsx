import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetInstitution, useListCampuses, useListInstitutions, useListOperatorRelations } from '@/api/generated/master/master'
import { OperatorFlow } from '@/components/operator-flow'
import type { InstitutionVersionOut } from '@/api/generated/model'
import {
  InstitutionCreateDialog,
  InstitutionReviseDialog,
  RelationCreateDialog,
} from '@/components/forms/change-forms'
import { Missing } from '@/components/kit/missing'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { RelationsTable } from '@/components/relations-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { FIELD_LABELS, formatValue, period } from '@/lib/format'
import { useMe } from '@/lib/use-me'

export function InstitutionsPage() {
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListInstitutions({ as_of: asOf })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: relations = [] } = useListOperatorRelations({ as_of: asOf, include_future: true })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="主体"
        description={`显示 ${asOf} 当天有效的版本。主体不设业务状态，终止关系通过关闭运营关系表达。`}
        actions={isMaintainer && <Button onClick={() => setCreating(true)}>新建主体</Button>}
      />
      {!isPending && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{asOf} 没有主体</EmptyTitle>
            <EmptyDescription>初始导入也作为一张变更申请，提交并确认一次。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>主体性质</TableHead>
              <TableHead>统一社会信用代码</TableHead>
              <TableHead>版本期间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>
                  <Link className="font-medium hover:underline" to={`/institutions/${r.id}`}>
                    {r.version.name}
                  </Link>
                  {r.not_yet_effective && (
                    <Badge variant="outline" className="ml-2">
                      未生效
                    </Badge>
                  )}
                  {r.has_later_versions && (
                    <Badge variant="outline" className="ml-2">
                      有后续版本
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{formatValue('nature', r.version.nature)}</TableCell>
                <TableCell>{formatValue('unified_credit_code', r.version.unified_credit_code)}</TableCell>
                <TableCell>{period(r.version.valid_from, r.version.valid_to)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.length > 0 && (
        <section className="mt-6 grid gap-2">
          <h2 className="text-fg-strong text-sm font-semibold">主体—院区运营关系（{asOf}）</h2>
          <OperatorFlow
            institutions={rows.map((r) => ({ id: r.id, code: r.code, name: r.version.name, subtitle: r.version.nature ?? undefined }))}
            campuses={campuses}
            relations={relations}
            asOf={asOf}
            allCampuses
          />
        </section>
      )}
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
  const close = (o: boolean) => !o && setDialog(null)

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {(onDay ?? latest).name}
            <span className="text-muted-foreground font-mono text-sm font-normal">{data.code}</span>
          </span>
        }
        description={onDay ? `${asOf} 有效版本：第 ${onDay.version_no} 版` : `${asOf} 尚未生效`}
        actions={
          isMaintainer && (
            <>
              <Button variant="outline" onClick={() => setDialog('revise')}>
                修订
              </Button>
              <Button onClick={() => setDialog('relation')}>建立运营关系</Button>
            </>
          )
        }
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>资料（{asOf}）</CardTitle>
          </CardHeader>
          <CardContent>
            {onDay ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                {FIELDS.map((k) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt>
                    <dd>{formatValue(k, onDay[k])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground text-xs">该日期没有有效版本。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>运营的院区与关系</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <OperatorFlow
              institutions={[{ id: data.id, code: data.code, name: (onDay ?? latest).name, subtitle: (onDay ?? latest).nature ?? undefined }]}
              campuses={campuses}
              relations={relations}
              asOf={asOf}
            />
            <RelationsTable relations={data.relations} canEdit={isMaintainer} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>版本时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <VersionTimeline versions={data.versions} fields={FIELDS} asOf={asOf} />
          </CardContent>
        </Card>
      </div>
      {dialog === 'revise' && (
        <InstitutionReviseDialog open onOpenChange={close} code={data.code} current={latest} />
      )}
      {dialog === 'relation' && <RelationCreateDialog open onOpenChange={close} institutionCode={data.code} />}
    </>
  )
}
