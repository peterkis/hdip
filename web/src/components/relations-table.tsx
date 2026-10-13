import { useState } from 'react'
import { Link } from 'react-router'
import type { RelationOut } from '@/api/generated/model'
import { RelationCloseDialog } from '@/components/forms/change-forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { period, RELATION_TYPE, type RelationType } from '@/lib/format'

export function RelationsTable({ relations, canEdit }: { relations: RelationOut[]; canEdit: boolean }) {
  const [closing, setClosing] = useState<RelationOut | null>(null)
  if (relations.length === 0) return <p className="text-muted-foreground py-4 text-xs">暂无运营关系</p>
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>主体</TableHead>
            <TableHead>院区</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>期间</TableHead>
            <TableHead>查看日期</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {relations.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.id}</TableCell>
              <TableCell>
                <Link className="hover:underline" to={`/institutions/${r.institution_id}`}>
                  {r.institution_name}
                </Link>
              </TableCell>
              <TableCell>
                <Link className="hover:underline" to={`/campuses/${r.campus_id}`}>
                  {r.campus_name}
                </Link>
              </TableCell>
              <TableCell>
                {RELATION_TYPE[r.relation_type as RelationType]}
                {r.is_primary && (
                  <Badge variant="secondary" className="ml-1">
                    主要
                  </Badge>
                )}
              </TableCell>
              <TableCell>{period(r.valid_from, r.valid_to)}</TableCell>
              <TableCell>{r.effective_on_as_of ? '有效' : <span className="text-muted-foreground">不在期间内</span>}</TableCell>
              <TableCell className="text-right">
                {canEdit && r.valid_to === null && (
                  <Button size="sm" variant="outline" onClick={() => setClosing(r)}>
                    关闭
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {closing && (
        <RelationCloseDialog open relation={closing} onOpenChange={(o) => !o && setClosing(null)} />
      )}
    </>
  )
}
