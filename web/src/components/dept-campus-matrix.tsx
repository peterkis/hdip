// 部门 × 院区矩阵（组织总览）：行 = 有单元的部门及其上级（按部门树缩进），列 = 院区，
// 格子 = 该部门本身（不含下级）在该院区的单元数与类型。空格只说明“未登记”，不等于院方确认不设。
import { Link } from 'react-router'
import type { CampusRow, ServiceUnitRow } from '@/api/generated/model'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { OPERATING_STATUS, type OperatingStatus } from '@/lib/format'
import type { MatrixRow } from '@/lib/org-overview'
import { OPERATING_STATUS_TONE } from '@/lib/tones'
import { cn } from '@/lib/utils'

export function DeptCampusMatrix({
  rows,
  campuses,
  selected,
  onSelect,
}: {
  rows: MatrixRow[]
  campuses: CampusRow[]
  /** 当前选中的格子：部门 id × 院区 id */
  selected?: string
  onSelect: (row: MatrixRow, campus: CampusRow, units: ServiceUnitRow[]) => void
}) {
  const { optionLabels } = useApp()
  const typeShort = (code: string) => (optionLabels.unit_type?.[code] ?? code).replace(/单元$/, '')
  return (
    <div className="border-line-subtle overflow-x-auto rounded-md border">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr className="bg-surface-subtle text-fg-muted">
            <th className="sticky left-0 z-10 bg-surface-subtle px-3 py-2 text-left font-normal">部门</th>
            {campuses.map((c) => (
              <th key={c.id} className="border-line-subtle min-w-32 border-l px-3 py-2 text-left font-normal">
                <span className="text-fg-secondary flex items-center gap-1.5 whitespace-nowrap">
                  {c.version.name}
                  <Tag tone={c.not_yet_effective ? 'gray' : OPERATING_STATUS_TONE[c.version.operating_status]}>
                    {c.not_yet_effective
                      ? `${c.version.valid_from} 起`
                      : (OPERATING_STATUS[c.version.operating_status as OperatingStatus] ?? c.version.operating_status)}
                  </Tag>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dept.id} className="border-line-subtle border-t">
              <th
                scope="row"
                className="bg-surface-page sticky left-0 z-10 px-3 py-2 text-left font-normal whitespace-nowrap"
                style={{ paddingLeft: `calc(var(--hd-space-12) + var(--hd-space-16) * ${r.depth})` }}
              >
                <Link to={`/departments/${r.dept.id}`} className={cn('hover:underline', r.depth === 0 ? 'text-fg-strong font-medium' : 'text-fg')}>
                  {r.dept.version.name}
                </Link>
              </th>
              {campuses.map((c) => {
                const units = r.cells.get(c.id) ?? []
                const key = `${r.dept.id}:${c.id}`
                if (units.length === 0)
                  return (
                    <td
                      key={c.id}
                      className="border-line-subtle text-fg-disabled border-l px-3 py-2"
                      title="当前日期下未登记符合条件的服务单元，实际开展情况待核实"
                    >
                      —
                    </td>
                  )
                const planned = units.filter((u) => u.not_yet_effective).length
                const types = [...new Set(units.map((u) => u.unit_type))]
                return (
                  <td key={c.id} className="border-line-subtle border-l p-0">
                    <button
                      type="button"
                      onClick={() => onSelect(r, c, units)}
                      className={cn(
                        'hover:bg-surface-hover flex w-full flex-col items-start gap-1 px-3 py-2 text-left transition-colors duration-(--hd-duration-fast)',
                        selected === key && 'bg-surface-selected',
                      )}
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-fg-strong text-sm font-semibold">{units.length}</span>
                        {planned > 0 && <span className="text-fg-muted text-caption">含计划 {planned}</span>}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {types.map((t) => (
                          <Tag key={t} tone="gray">
                            {typeShort(t)}
                          </Tag>
                        ))}
                      </span>
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
