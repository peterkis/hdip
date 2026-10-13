import { Link } from 'react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApp } from '@/lib/app-context'
import { FIELD_LABELS, formatValue, period, stamp } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Version {
  version_no: number
  valid_from: string
  valid_to: string | null
  change_id: number
  recorded_at: string
  recorded_by: { display_name: string }
}

/** 版本按新到旧列出；每版只显示与上一版相比改动的字段，查看日期所在的版本高亮。 */
export function VersionTimeline<V extends Version>({
  versions,
  fields,
  asOf,
}: {
  versions: V[]
  fields: (keyof V)[]
  asOf: string
}) {
  const { optionLabels } = useApp()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>版本</TableHead>
          <TableHead>业务期间</TableHead>
          <TableHead>内容（相对上一版的变化）</TableHead>
          <TableHead>来源申请</TableHead>
          <TableHead>确认</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((v, i) => {
          const prev = versions[i + 1]
          const changed = fields.filter((f) => !prev || prev[f] !== v[f])
          const current = v.valid_from <= asOf && (v.valid_to === null || v.valid_to >= asOf)
          return (
            <TableRow key={v.version_no} className={cn(current && 'bg-muted/50')}>
              <TableCell>第 {v.version_no} 版</TableCell>
              <TableCell className="whitespace-nowrap">{period(v.valid_from, v.valid_to)}</TableCell>
              <TableCell className="whitespace-normal">
                {changed
                  .filter((f) => prev || v[f] !== null)
                  .map((f) => (
                    <span key={String(f)} className="mr-3 inline-block">
                      <span className="text-muted-foreground">{FIELD_LABELS[String(f)]}：</span>
                      {prev && (
                        <>
                          <span className="line-through opacity-60">{formatValue(String(f), prev[f], optionLabels)}</span>
                          {' → '}
                        </>
                      )}
                      {formatValue(String(f), v[f], optionLabels)}
                    </span>
                  ))}
              </TableCell>
              <TableCell>
                <Link className="hover:underline" to={`/changes/${v.change_id}`}>
                  #{v.change_id}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {v.recorded_by.display_name} · {stamp(v.recorded_at)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
