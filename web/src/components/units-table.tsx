import { Link } from 'react-router'
import type { ServiceUnitRow } from '@/api/generated/model'
import { UnitStatusBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApp } from '@/lib/app-context'
import { formatValue, period } from '@/lib/format'

/** 服务单元列表：每行是查看日期当天有效的版本。 */
export function UnitsTable({ rows, hide = [] }: { rows: ServiceUnitRow[]; hide?: ('department' | 'campus')[] }) {
  const { optionLabels } = useApp()
  if (rows.length === 0) return <p className="text-muted-foreground py-4 text-xs">没有服务单元</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>代码</TableHead>
          <TableHead>名称</TableHead>
          <TableHead>类型</TableHead>
          {!hide.includes('department') && <TableHead>所属部门</TableHead>}
          {!hide.includes('campus') && <TableHead>院区</TableHead>}
          <TableHead>运营主体</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>版本期间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono">{r.code}</TableCell>
            <TableCell>
              <Link className="font-medium hover:underline" to={`/service-units/${r.id}`}>
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
            <TableCell>{formatValue('unit_type', r.unit_type, optionLabels)}</TableCell>
            {!hide.includes('department') && (
              <TableCell>
                <Link className="hover:underline" to={`/departments/${r.version.department_id}`}>
                  {r.version.department_name}
                </Link>
                {r.version.department_lifecycle !== 'ACTIVE' && (
                  <Badge variant="destructive" className="ml-2">
                    所属部门非正式履职
                  </Badge>
                )}
              </TableCell>
            )}
            {!hide.includes('campus') && (
              <TableCell>
                <Link className="hover:underline" to={`/campuses/${r.version.campus_id}`}>
                  {r.version.campus_name}
                </Link>
              </TableCell>
            )}
            <TableCell>{r.version.institution_name}</TableCell>
            <TableCell>
              <UnitStatusBadge status={r.version.status} />
            </TableCell>
            <TableCell className="whitespace-nowrap">{period(r.version.valid_from, r.version.valid_to)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
