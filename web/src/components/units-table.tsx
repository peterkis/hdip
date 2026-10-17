// 服务单元列表（院区详情、部门详情里嵌入）：Notion 数据库视图样式，每行是查看日期当天有效的版本。
import { Link } from 'react-router'
import type { ServiceUnitRow } from '@/api/generated/model'
import { UnitStatusBadge } from '@/components/badges'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { formatValue, period } from '@/lib/format'

export function UnitsTable({ rows, hide = [] }: { rows: ServiceUnitRow[]; hide?: ('department' | 'campus')[] }) {
  const { optionLabels } = useApp()
  if (rows.length === 0) return <DbEmpty title="没有服务单元" hint="查看日期当天没有有效或计划中的单元。" />
  return (
    <DbTable
      columns={[
        { label: '名称', className: 'min-w-40' },
        { label: '代码' },
        { label: '类型' },
        ...(hide.includes('department') ? [] : [{ label: '所属部门' }]),
        ...(hide.includes('campus') ? [] : [{ label: '院区' }]),
        { label: '运营主体' },
        { label: '状态' },
        { label: '版本期间' },
      ]}
    >
      {rows.map((r) => (
        <DbRow key={r.id}>
          <DbCell>
            <span className="flex flex-wrap items-center gap-1.5">
              <Link className="text-fg-strong decoration-line-strong font-medium underline-offset-4 hover:underline" to={`/service-units/${r.id}`}>
                {r.version.name}
              </Link>
              {r.not_yet_effective && <Tag tone="gray">计划中</Tag>}
              {r.has_later_versions && <Tag tone="blue">有后续版本</Tag>}
            </span>
          </DbCell>
          <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{r.code}</DbCell>
          <DbCell className="whitespace-nowrap">{formatValue('unit_type', r.unit_type, optionLabels)}</DbCell>
          {!hide.includes('department') && (
            <DbCell className="whitespace-nowrap">
              <Link className="hover:underline" to={`/departments/${r.version.department_id}`}>
                {r.version.department_name}
              </Link>
              {r.version.department_lifecycle !== 'ACTIVE' && (
                <Tag tone="red" className="ml-1.5">
                  部门非正式履职
                </Tag>
              )}
            </DbCell>
          )}
          {!hide.includes('campus') && (
            <DbCell className="whitespace-nowrap">
              <Link className="hover:underline" to={`/campuses/${r.version.campus_id}`}>
                {r.version.campus_name}
              </Link>
            </DbCell>
          )}
          <DbCell className="text-fg-secondary whitespace-nowrap">{r.version.institution_name}</DbCell>
          <DbCell>
            <UnitStatusBadge status={r.version.status} />
          </DbCell>
          <DbCell className="text-fg-secondary whitespace-nowrap">{period(r.version.valid_from, r.version.valid_to)}</DbCell>
        </DbRow>
      ))}
    </DbTable>
  )
}
