// 服务单元列表（院区详情、部门详情里嵌入）：每行是查看日期当天有效的版本。
// 与服务单元主列表用同一个名称单元格（UnitNameCell）：名称为主入口，代码与“之后有新版本”在辅助行（V5，U3R-08）；
// 父页面已限定的院区 / 部门列不重复列出。
import { Link } from 'react-router'
import type { ServiceUnitRow } from '@/api/generated/model'
import { UnitStatusBadge } from '@/components/badges'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { formatValue, period } from '@/lib/format'
import { PLANNED_TONE } from '@/lib/tones'

/** 服务单元的名称单元格：名称 14/20（链接，长名自然换行）+ 计划中标签；代码与后续版本说明 12/16 */
export function UnitNameCell({ unit: u }: { unit: ServiceUnitRow }) {
  return (
    <DbCell>
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            to={`/service-units/${u.id}`}
            className="text-fg-strong decoration-line-strong min-w-0 font-medium break-words underline-offset-4 hover:underline"
          >
            {u.version.name}
          </Link>
          {u.not_yet_effective && <Tag tone={PLANNED_TONE}>计划中</Tag>}
        </span>
        <span className="text-fg-muted text-caption">
          <span className="font-mono select-all">{u.code}</span>
          {/* 后续版本是中性事实，用文字说明，不用彩色标签（SC-06） */}
          {u.has_later_versions && <> · 之后有已确认的新版本</>}
        </span>
      </span>
    </DbCell>
  )
}

export function UnitsTable({ rows, hide = [] }: { rows: ServiceUnitRow[]; hide?: ('department' | 'campus')[] }) {
  const { optionLabels } = useApp()
  if (rows.length === 0) return <DbEmpty title="没有服务单元" hint="查看日期当天没有有效或计划中的单元。" />
  return (
    <DbTable
      columns={[
        { label: '名称', className: 'min-w-40' },
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
          <UnitNameCell unit={r} />
          <DbCell className="whitespace-nowrap">{formatValue('unit_type', r.unit_type, optionLabels)}</DbCell>
          {!hide.includes('department') && (
            <DbCell>
              <Link className="hover:underline" to={`/departments/${r.version.department_id}`}>
                {r.version.department_name}
              </Link>
              {r.version.department_lifecycle !== 'ACTIVE' && (
                <Tag tone="orange" className="ml-1.5">
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
          <DbCell className="text-fg-secondary">{r.version.institution_name}</DbCell>
          <DbCell>
            <UnitStatusBadge status={r.version.status} />
          </DbCell>
          <DbCell className="text-fg-secondary whitespace-nowrap tabular-nums">{period(r.version.valid_from, r.version.valid_to)}</DbCell>
        </DbRow>
      ))}
    </DbTable>
  )
}
