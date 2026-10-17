// 主体—院区运营关系列表（主体、院区详情里嵌入）：Notion 数据库视图样式。
import { useState } from 'react'
import { Link } from 'react-router'
import type { RelationOut } from '@/api/generated/model'
import { RelationCloseDialog } from '@/components/forms/change-forms'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { Tag } from '@/components/kit/tag'
import { Button } from '@/components/ui/button'
import { period, RELATION_TYPE, type RelationType } from '@/lib/format'
import { cn } from '@/lib/utils'

export function RelationsTable({ relations, canEdit }: { relations: RelationOut[]; canEdit: boolean }) {
  const [closing, setClosing] = useState<RelationOut | null>(null)
  if (relations.length === 0) return <DbEmpty title="暂无运营关系" hint="用“建立运营关系”把运营主体与院区连起来。" />
  return (
    <>
      <DbTable
        columns={[{ label: '主体' }, { label: '院区' }, { label: '类型' }, { label: '期间' }, { label: '查看日期' }, { label: '' }]}
      >
        {relations.map((r) => (
          <DbRow key={r.id} className={cn(!r.effective_on_as_of && 'text-fg-muted')}>
            <DbCell className="whitespace-nowrap">
              <Link className="hover:underline" to={`/institutions/${r.institution_id}`}>
                {r.institution_name}
              </Link>
            </DbCell>
            <DbCell className="whitespace-nowrap">
              <Link className="hover:underline" to={`/campuses/${r.campus_id}`}>
                {r.campus_name}
              </Link>
            </DbCell>
            <DbCell className="whitespace-nowrap">
              <span className="flex items-center gap-1.5">
                {RELATION_TYPE[r.relation_type as RelationType]}
                {r.is_primary && <Tag tone="blue">主要</Tag>}
              </span>
            </DbCell>
            <DbCell className="whitespace-nowrap">{period(r.valid_from, r.valid_to)}</DbCell>
            <DbCell className="whitespace-nowrap">
              {r.effective_on_as_of ? <Tag tone="green">有效</Tag> : <span className="text-fg-muted">不在期间内</span>}
            </DbCell>
            <DbCell className="text-right">
              {canEdit && r.valid_to === null && (
                <Button size="xs" variant="ghost" onClick={() => setClosing(r)}>
                  关闭
                </Button>
              )}
            </DbCell>
          </DbRow>
        ))}
      </DbTable>
      {closing && <RelationCloseDialog open relation={closing} onOpenChange={(o) => !o && setClosing(null)} />}
    </>
  )
}
