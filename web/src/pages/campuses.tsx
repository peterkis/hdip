import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetCampus, useListCampuses, useListServiceUnits } from '@/api/generated/master/master'
import type { CampusVersionOut } from '@/api/generated/model'
import { OperatingStatusBadge } from '@/components/badges'
import {
  CampusCreateDialog,
  CampusReviseDialog,
  CampusStatusDialog,
  RelationCreateDialog,
} from '@/components/forms/change-forms'
import { Missing } from '@/components/kit/missing'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { UnitCreateDialog } from '@/components/forms/unit-forms'
import { RelationsTable } from '@/components/relations-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UnitsTable } from '@/components/units-table'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { FIELD_LABELS, formatValue, period, type OperatingStatus } from '@/lib/format'
import { useMe } from '@/lib/use-me'

export function CampusesPage() {
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListCampuses({ as_of: asOf })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="院区"
        description={`显示 ${asOf} 当天有效的版本`}
        actions={isMaintainer && <Button onClick={() => setCreating(true)}>新建院区</Button>}
      />
      {!isPending && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{asOf} 没有院区</EmptyTitle>
            <EmptyDescription>新建院区后经提交、确认才会出现在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>节点角色</TableHead>
              <TableHead>运营状态</TableHead>
              <TableHead>主要运营方</TableHead>
              <TableHead>版本期间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>
                  <Link className="font-medium hover:underline" to={`/campuses/${r.id}`}>
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
                <TableCell>{formatValue('node_role', r.version.node_role, optionLabels)}</TableCell>
                <TableCell>
                  <OperatingStatusBadge status={r.version.operating_status} />
                </TableCell>
                <TableCell>{r.primary_operator?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{period(r.version.valid_from, r.version.valid_to)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {creating && <CampusCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

const CAMPUS_FIELDS: (keyof CampusVersionOut)[] = [
  'name',
  'node_role',
  'operating_status',
  'address',
  'admin_division_code',
  'phone',
  'actual_open_date',
]

export function CampusDetailPage() {
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const { data, isError } = useGetCampus(id, { as_of: asOf })
  const { data: units = [] } = useListServiceUnits({ as_of: asOf, campus_id: id })
  const [dialog, setDialog] = useState<'revise' | 'status' | 'relation' | 'unit' | null>(null)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="院区" back={{ to: '/campuses', label: '返回院区列表' }} /> : null

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
            {onDay && <OperatingStatusBadge status={onDay.operating_status} />}
          </span>
        }
        description={onDay ? `${asOf} 有效版本：第 ${onDay.version_no} 版` : `${asOf} 尚未生效`}
        actions={
          isMaintainer && (
            <>
              <Button variant="outline" onClick={() => setDialog('revise')}>
                修订资料
              </Button>
              <Button
                variant="outline"
                disabled={latest.operating_status === 'SUSPENDED'}
                onClick={() => setDialog('status')}
              >
                变更运营状态
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
                {CAMPUS_FIELDS.map((k) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt>
                    <dd>{formatValue(k, onDay[k], optionLabels)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground text-xs">该日期没有有效版本，最早版本自 {data.versions.at(-1)?.valid_from} 起。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              服务单元（{asOf}）
              <span className="text-muted-foreground ml-2 font-normal">
                该院区有哪些部门 = 这些单元按所属部门去重：
                {[...new Set(units.filter((u) => !u.not_yet_effective).map((u) => u.version.department_name))].join('、') || '无'}
              </span>
            </CardTitle>
            {isMaintainer && latest.operating_status !== 'SUSPENDED' && (
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setDialog('unit')}>
                  新建服务单元
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <UnitsTable rows={units} hide={['campus']} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>运营关系</CardTitle>
          </CardHeader>
          <CardContent>
            <RelationsTable relations={data.relations} canEdit={isMaintainer} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>版本时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <VersionTimeline versions={data.versions} fields={CAMPUS_FIELDS} asOf={asOf} />
          </CardContent>
        </Card>
      </div>
      {dialog === 'revise' && <CampusReviseDialog open onOpenChange={close} code={data.code} current={latest} />}
      {dialog === 'status' && (
        <CampusStatusDialog
          open
          onOpenChange={close}
          code={data.code}
          name={latest.name}
          current={latest.operating_status as OperatingStatus}
        />
      )}
      {dialog === 'relation' && <RelationCreateDialog open onOpenChange={close} campusCode={data.code} />}
      {dialog === 'unit' && <UnitCreateDialog open onOpenChange={close} campusCode={data.code} />}
    </>
  )
}

