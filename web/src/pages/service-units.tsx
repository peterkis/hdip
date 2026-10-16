import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useGetServiceUnit } from '@/api/generated/master/master'
import type { ServiceUnitVersionOut } from '@/api/generated/model'
import { UnitStatusBadge } from '@/components/badges'
import {
  UnitChangeDepartmentDialog,
  UnitRebindDialog,
  UnitRetireDialog,
  UnitReviseDialog,
  UnitStatusDialog,
} from '@/components/forms/unit-forms'
import { ExternalCodeLinks } from '@/components/external-code-links'
import { UnitClassifyDialog } from '@/components/forms/code-forms'
import { Tag } from '@/components/kit/tag'
import { Missing } from '@/components/kit/missing'
import { PageHeader } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VersionTimeline } from '@/components/version-timeline'
import { useApp } from '@/lib/app-context'
import { formatValue, stamp } from '@/lib/format'
import { useMe } from '@/lib/use-me'

const UNIT_FIELDS: (keyof ServiceUnitVersionOut)[] = [
  'name',
  'department_name',
  'campus_name',
  'institution_name',
  'status',
  'phone',
  'scope_note',
]

type UnitDialog = 'revise' | 'rebind' | 'department' | 'status' | 'retire' | 'classify'

export function ServiceUnitDetailPage() {
  const id = Number(useParams().id)
  const { asOf, optionLabels } = useApp()
  const { isMaintainer } = useMe()
  const { data, isError } = useGetServiceUnit(id, { as_of: asOf })
  const [dialog, setDialog] = useState<UnitDialog | null>(null)
  useCrumb(data && `${data.code} ${data.versions[0].name}`)
  if (!data) return isError || !Number.isInteger(id) ? <Missing what="服务单元" back={{ to: '/service-units', label: '返回服务单元列表' }} /> : null

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
                    {onDay.department_lifecycle !== 'ACTIVE' && (
                      <Badge variant="destructive" className="ml-2">
                        所属部门非正式履职
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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>分类</CardTitle>
            {isMaintainer && !retired && (
              <Button size="sm" variant="outline" onClick={() => setDialog('classify')}>
                设置分类
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.classifications.length === 0 ? (
              <p className="text-fg-disabled text-xs">没有分类。所属部门的分类不会自动下发给单元。</p>
            ) : (
              <ul className="grid gap-1 text-xs">
                {data.classifications.map((c) => {
                  const current = c.valid_from <= asOf && (c.valid_to === null || c.valid_to >= asOf)
                  return (
                    <li key={c.id} className={current ? '' : 'text-fg-muted'}>
                      <span className="text-fg-secondary">{c.scheme_name}：</span>
                      <Tag tone={current ? 'blue' : 'gray'}>
                        {c.code} {c.name}
                      </Tag>
                      <span className="ml-2">
                        {c.valid_from} → {c.valid_to ?? '长期'}
                      </span>
                      <Link to={`/changes/${c.change_id}`} className="text-fg-secondary ml-2 hover:underline">
                        #{c.change_id}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>外部编码</CardTitle>
            <Link to="/standards/code-mapping" className="text-fg-muted hover:text-fg text-caption hover:underline">
              到编码映射台账维护
            </Link>
          </CardHeader>
          <CardContent>
            <ExternalCodeLinks rows={data.external_codes} asOf={asOf} empty="没有外部代码的解释指向本单元" />
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
      {dialog === 'classify' && <UnitClassifyDialog open onOpenChange={close} code={data.code} name={latest.name} />}
    </>
  )
}
