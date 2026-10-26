// 对象详情页上的“外部编码”：从对象一侧看哪些外部代码的解释指向它。编辑统一在编码映射台账进行。
import { Link } from 'react-router'
import type { ExternalCodeLink } from '@/api/generated/model'
import { DbCell, DbRow, DbTable } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { period } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ExternalCodeLinks({
  rows,
  asOf,
  empty,
  showUnit = false,
}: {
  rows: ExternalCodeLink[]
  asOf: string
  empty: string
  showUnit?: boolean
}) {
  if (rows.length === 0) return <p className="text-fg-muted text-xs">{empty}</p>
  return (
    <DbTable
      columns={[
        { label: '来源字典' },
        { label: '代码' },
        { label: '源名称' },
        ...(showUnit ? [{ label: '经服务单元' }] : []),
        { label: '院区条件' },
        { label: '期间' },
        { label: '来源申请' },
      ]}
    >
      {rows.map((r) => {
        const current = r.valid_from <= asOf && (r.valid_to === null || r.valid_to >= asOf)
        return (
          <DbRow key={r.assignment_id} className={cn(!current && 'text-fg-muted')}>
            <DbCell className="whitespace-nowrap">
              {r.system_name} · {r.namespace_name}
            </DbCell>
            <DbCell className="font-mono text-caption whitespace-nowrap">
              <Link to={`/standards/code-mapping?code=${r.external_code_id}`} className="hover:underline">
                {r.code}
              </Link>
            </DbCell>
            <DbCell>{r.source_name ?? '—'}</DbCell>
            {showUnit && (
              <DbCell className="whitespace-nowrap">
                {r.via_unit && (
                  <Link to={`/service-units/${r.via_unit.id}`} className="hover:underline">
                    {r.via_unit.name}
                  </Link>
                )}
              </DbCell>
            )}
            <DbCell className="whitespace-nowrap">{r.campus_name ? <Tag tone="purple">{r.campus_name}</Tag> : '不区分'}</DbCell>
            <DbCell className="whitespace-nowrap">
              {period(r.valid_from, r.valid_to)}
            </DbCell>
            <DbCell>
              <Link to={`/changes/${r.change_id}`} className="text-fg-secondary hover:underline">
                #{r.change_id}
              </Link>
            </DbCell>
          </DbRow>
        )
      })}
    </DbTable>
  )
}
