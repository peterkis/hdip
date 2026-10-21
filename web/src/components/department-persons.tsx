// 部门详情的“人员”区块（人员设计第 7.2 节）：查看日期归属本部门的人员（主归属，不含下级部门），
// 计数与人员名册同口径；计划中的（之后才调入、入职）另列，不计入当天人数。
import { Link } from 'react-router'
import type { DepartmentPersonRow } from '@/api/generated/model'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { period } from '@/lib/format'
import { PLANNED_TONE } from '@/lib/tones'

export function DepartmentPersons({ rows, suspended }: { rows: DepartmentPersonRow[]; suspended: boolean }) {
  const { asOf, optionLabels } = useApp()
  const types = optionLabels.engagement_type ?? {}
  const current = rows.filter((r) => !r.not_yet_effective)
  return (
    <div className="grid gap-2">
      {suspended && current.length > 0 && (
        <p className="text-warning-text text-caption">部门暂停履职：已有人员归属保留，不因此结束任用。</p>
      )}
      {rows.length === 0 ? (
        <DbEmpty title={`${asOf} 没有归属本部门的人员`} hint="人员归属在人员名册里登记；下级部门的人员不计入本部门。" />
      ) : (
        <DbTable columns={[{ label: '姓名' }, { label: '人员代码' }, { label: '任用' }, { label: '归属期间' }]}>
          {rows.map((r) => (
            <DbRow key={r.assignment_id}>
              <DbCell>
                <span className="flex items-center gap-1.5">
                  <Link className="text-fg-strong font-medium hover:underline" to={`/persons/${r.person_id}`}>
                    {r.person_name}
                  </Link>
                  {r.not_yet_effective && <Tag tone={PLANNED_TONE}>{r.valid_from} 起</Tag>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary font-mono text-caption">{r.person_code}</DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap">
                {r.institution_name} · {types[r.engagement_type] ?? r.engagement_type}
              </DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap">{period(r.valid_from, r.valid_to)}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
      <p className="text-fg-muted text-caption">
        {asOf} 当天 {current.length} 人（按人员去重，不含下级部门）；部门更名、调整隶属不迁人。
      </p>
    </div>
  )
}
