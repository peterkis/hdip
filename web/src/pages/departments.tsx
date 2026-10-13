import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetDepartment, useListDepartments } from '@/api/generated/master/master'
import { DepartmentStatusBadge } from '@/components/badges'
import {
  DepartmentCreateDialog,
  DepartmentRenameDialog,
  DepartmentStatusDialog,
  UnitCreateDialog,
} from '@/components/forms/unit-forms'
import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UnitsTable } from '@/components/units-table'
import { useApp } from '@/lib/app-context'
import { stamp } from '@/lib/format'
import { useMe } from '@/lib/use-me'

export function DepartmentsPage() {
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data: rows = [], isPending } = useListDepartments({ as_of: asOf })
  const [creating, setCreating] = useState(false)

  return (
    <>
      <PageHeader
        title="部门"
        description={`部门仅作引用，无版本；单元数为 ${asOf} 当天挂在该部门下的服务单元。`}
        actions={isMaintainer && <Button onClick={() => setCreating(true)}>新建部门</Button>}
      />
      {!isPending && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>还没有部门</EmptyTitle>
            <EmptyDescription>新建部门后经提交、确认才会出现在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>服务单元数（{asOf}）</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono">{d.code}</TableCell>
                <TableCell>
                  <Link className="font-medium hover:underline" to={`/departments/${d.id}`}>
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <DepartmentStatusBadge status={d.status} />
                </TableCell>
                <TableCell>{d.unit_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {creating && <DepartmentCreateDialog open onOpenChange={setCreating} />}
    </>
  )
}

export function DepartmentDetailPage() {
  const id = Number(useParams().id)
  const { asOf } = useApp()
  const { isMaintainer } = useMe()
  const { data } = useGetDepartment(id, { as_of: asOf })
  const [dialog, setDialog] = useState<'rename' | 'status' | 'unit' | null>(null)
  if (!data) return null
  const close = (o: boolean) => !o && setDialog(null)

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {data.name}
            <span className="text-muted-foreground font-mono text-sm font-normal">{data.code}</span>
            <DepartmentStatusBadge status={data.status} />
          </span>
        }
        description="部门暂无版本：名称与状态为当前值，按历史日期查询时也显示当前名称。"
        actions={
          isMaintainer && (
            <>
              <Button variant="outline" onClick={() => setDialog('rename')}>
                改名
              </Button>
              <Button variant="outline" onClick={() => setDialog('status')}>
                {data.status === 'ACTIVE' ? '停用' : '恢复'}
              </Button>
              <Button disabled={data.status !== 'ACTIVE'} onClick={() => setDialog('unit')}>
                新建服务单元
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>服务单元（{asOf}）</CardTitle>
          </CardHeader>
          <CardContent>
            <UnitsTable rows={data.units} hide={['department']} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>改动记录</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-xs">
            <p>
              新建于 {stamp(data.created_at)}（
              <Link className="hover:underline" to={`/changes/${data.created_change_id}`}>
                #{data.created_change_id}
              </Link>
              ），最近改动 {stamp(data.updated_at)}。
            </p>
            <p>
              相关申请：
              {data.change_ids.map((cid) => (
                <Link key={cid} className="mr-2 hover:underline" to={`/changes/${cid}`}>
                  #{cid}
                </Link>
              ))}
            </p>
          </CardContent>
        </Card>
      </div>
      {dialog === 'rename' && <DepartmentRenameDialog open onOpenChange={close} department={data} />}
      {dialog === 'status' && <DepartmentStatusDialog open onOpenChange={close} department={data} />}
      {dialog === 'unit' && <UnitCreateDialog open onOpenChange={close} departmentCode={data.code} />}
    </>
  )
}
