import { useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  useGetServiceUnit,
  useListCampuses,
  useListDepartments,
  useListServiceUnits,
} from '@/api/generated/master/master'
import type { ServiceUnitVersionOut } from '@/api/generated/model'
import { UnitStatusBadge } from '@/components/badges'
import { SelectField } from '@/components/forms/fields'
import {
  UnitChangeDepartmentDialog,
  UnitCreateDialog,
  UnitRebindDialog,
  UnitRetireDialog,
  UnitReviseDialog,
  UnitStatusDialog,
} from '@/components/forms/unit-forms'
import { PageHeader } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { UnitsTable } from '@/components/units-table'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, stamp } from '@/lib/format'
import { useMe } from '@/lib/use-me'

export function ServiceUnitsPage() {
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const [campusId, setCampusId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  const { data: rows = [], isPending } = useListServiceUnits({
    as_of: asOf,
    ...(campusId && { campus_id: Number(campusId) }),
    ...(departmentId && { department_id: Number(departmentId) }),
  })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="服务单元"
        description={`显示 ${asOf} 当天有效的版本。服务单元 = 部门 × 院区 × 运营主体 × 期间。`}
        actions={isMaintainer && <Button onClick={() => setCreating(true)}>新建服务单元</Button>}
      />
      <div className="mb-3 grid max-w-xl grid-cols-2 gap-3">
        <SelectField
          label="院区"
          allowEmpty
          value={campusId}
          onChange={setCampusId}
          options={campuses.map((c) => ({ value: String(c.id), label: c.version.name }))}
        />
        <SelectField
          label="所属部门"
          allowEmpty
          value={departmentId}
          onChange={setDepartmentId}
          options={departments.map((d) => ({ value: String(d.id), label: d.name }))}
        />
      </div>
      {!isPending && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{asOf} 没有服务单元</EmptyTitle>
            <EmptyDescription>新建服务单元后经提交、确认才会出现在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <UnitsTable rows={rows} />
      )}
      {creating && <UnitCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

const UNIT_FIELDS: (keyof ServiceUnitVersionOut)[] = [
  'name',
  'department_name',
  'campus_name',
  'institution_name',
  'status',
  'phone',
  'scope_note',
]

type UnitDialog = 'revise' | 'rebind' | 'department' | 'status' | 'retire'

export function ServiceUnitDetailPage() {
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const { data } = useGetServiceUnit(id, { as_of: asOf })
  const [dialog, setDialog] = useState<UnitDialog | null>(null)
  if (!data) return null

  const latest = data.versions[0]
  const onDay = data.versions.find((v) => v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf))
  const retired = data.retired_after !== null
  const close = (o: boolean) => !o && setDialog(null)
  const dialogProps = { open: true, onOpenChange: close, code: data.code, current: latest }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {(onDay ?? latest).name}
            <span className="text-muted-foreground font-mono text-sm font-normal">{data.code}</span>
            <Badge variant="outline">{formatValue('unit_type', data.unit_type, optionLabels)}</Badge>
            {onDay && <UnitStatusBadge status={onDay.status} />}
            {retired && <Badge variant="destructive">已退出</Badge>}
          </span>
        }
        description={
          onDay
            ? `${asOf} 有效版本：第 ${onDay.version_no} 版`
            : retired && asOf > (data.retired_after ?? '')
              ? `已于 ${data.retired_after} 后永久退出`
              : `${asOf} 尚未生效`
        }
        actions={
          isMaintainer &&
          !retired && (
            <>
              <Button variant="outline" onClick={() => setDialog('revise')}>
                修订
              </Button>
              <Button variant="outline" onClick={() => setDialog('rebind')}>
                重新绑定
              </Button>
              <Button variant="outline" onClick={() => setDialog('department')}>
                更换所属部门
              </Button>
              <Button variant="outline" onClick={() => setDialog('status')}>
                {latest.status === 'ACTIVE' ? '暂停' : '恢复'}
              </Button>
              <Button variant="destructive" onClick={() => setDialog('retire')}>
                永久退出
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4">
        {retired && (
          <Alert>
            <AlertDescription>
              该单元最后有效日为 {data.retired_after}，已永久退出；代码 {data.code} 永久绑定，不会被复用。
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>资料（{asOf}）</CardTitle>
          </CardHeader>
          <CardContent>
            {onDay ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">所属部门</dt>
                  <dd>
                    <Link className="hover:underline" to={`/departments/${onDay.department_id}`}>
                      {onDay.department_name}
                    </Link>
                    {onDay.department_status !== 'ACTIVE' && (
                      <Badge variant="destructive" className="ml-2">
                        所属部门已停用
                      </Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">院区</dt>
                  <dd>
                    <Link className="hover:underline" to={`/campuses/${onDay.campus_id}`}>
                      {onDay.campus_name}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">运营主体</dt>
                  <dd>
                    <Link className="hover:underline" to={`/institutions/${onDay.institution_id}`}>
                      {onDay.institution_name}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">状态</dt>
                  <dd>{formatValue('status', onDay.status)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">电话</dt>
                  <dd>{formatValue('phone', onDay.phone)}</dd>
                </div>
                <div className="col-span-3">
                  <dt className="text-muted-foreground">范围说明</dt>
                  <dd>{formatValue('scope_note', onDay.scope_note)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground text-xs">该日期没有有效版本。</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>版本时间线</CardTitle>
          </CardHeader>
          <CardContent>
            <VersionTimeline versions={data.versions} fields={UNIT_FIELDS} asOf={asOf} />
            <p className="text-muted-foreground mt-2 text-xs">
              新建于 {stamp(data.created_at)}。部门暂无版本，历史版本里的部门名称显示为当前名称。
            </p>
          </CardContent>
        </Card>
      </div>
      {dialog === 'revise' && <UnitReviseDialog {...dialogProps} />}
      {dialog === 'rebind' && <UnitRebindDialog {...dialogProps} />}
      {dialog === 'department' && <UnitChangeDepartmentDialog {...dialogProps} />}
      {dialog === 'status' && <UnitStatusDialog {...dialogProps} />}
      {dialog === 'retire' && <UnitRetireDialog {...dialogProps} />}
    </>
  )
}
