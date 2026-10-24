// 部门详情的“人员”区块（人员设计第 7.2 节）：查看日期归属本部门的人员（主归属，不含下级部门），
// 计数与人员名册同口径；计划中的（之后才调入、入职）另列，不计入当天人数。
import { Link } from 'react-router'
import type { DepartmentDutyRow, DepartmentPersonRow } from '@/api/generated/model'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { InlineAction } from '@/components/kit/section'
import { EngagementTypeTag } from '@/components/engagement-type-tag'
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { period, today } from '@/lib/format'
import { PLANNED_TONE } from '@/lib/tones'
import { cn } from '@/lib/utils'

export function DepartmentPersons({ rows, suspended }: { rows: DepartmentPersonRow[]; suspended: boolean }) {
  const { asOf } = useApp()
  const current = new Set(rows.filter((r) => !r.not_yet_effective).map((r) => r.person_id))
  return (
    <div className="grid gap-2">
      {suspended && current.size > 0 && (
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
                  {r.kind === 'ADDITIONAL' && <Tag tone="purple">附加归属</Tag>}
                  {r.not_yet_effective && <Tag tone={PLANNED_TONE}>{r.valid_from} 起</Tag>}
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary font-mono text-caption">{r.person_code}</DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  {r.institution_name}
                  <EngagementTypeTag code={r.engagement_type} />
                </span>
              </DbCell>
              <DbCell className="text-fg-secondary whitespace-nowrap">{period(r.valid_from, r.valid_to)}</DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
      <p className="text-fg-muted text-caption">
        {asOf} 当天 {current.size} 人（主部门与附加归属，按人员去重，不含下级部门）；部门更名、调整隶属不迁人。
      </p>
    </div>
  )
}

/** 任职依据（A1）：A1 之前登记的职务没有依据，如实说明，不补写 */
export function DutyBasis({ note, className }: { note?: string | null; className?: string }) {
  return note ? (
    <span className={cn('text-fg-secondary text-caption', className)} title={note}>
      依据：{note}
    </span>
  ) : (
    <span className={cn('text-fg-muted text-caption', className)}>历史记录未提供依据</span>
  )
}

/** 负责人：有主持工作者（代理或代管）时显示主持工作者并注明部长；没有时显示部长（人员设计 10.1） */
export function DepartmentLeader({ duties }: { duties: DepartmentDutyRow[] }) {
  const now = duties.filter((d) => !d.not_yet_effective && d.duty === 'HEAD')
  const presiding = now.find((d) => d.mode !== 'FORMAL')
  const head = now.find((d) => d.mode === 'FORMAL')
  const link = (d: DepartmentDutyRow) => (
    <Link className="hover:underline" to={`/persons/${d.person_id}`}>
      {d.person_name}
    </Link>
  )
  if (!presiding && !head) return <span className="text-fg-muted">空缺</span>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {presiding ? (
        <>
          {link(presiding)}
          <Tag tone="orange">{presiding.label}</Tag>
          {head && <span className="text-fg-muted text-caption">部长：{head.person_name}</span>}
        </>
      ) : (
        <>
          {link(head!)}
          <Tag tone="blue">部长</Tag>
        </>
      )}
    </span>
  )
}

export function DepartmentDuties({ rows, onAction }: { rows: DepartmentDutyRow[]; onAction?: (kind: 'handover' | 'end', d: DepartmentDutyRow) => void }) {
  if (rows.length === 0) return <p className="text-fg-muted text-xs">没有登记职务。</p>
  return (
    <DbTable columns={[{ label: '职务' }, { label: '姓名' }, { label: '期间' }, { label: '依据' }, { label: '' }]}>
      {rows.map((d) => (
        <DbRow key={d.duty_id}>
          <DbCell>
            <Tag tone={d.mode === 'FORMAL' ? 'blue' : 'orange'}>{d.label}</Tag>
            {d.not_yet_effective && <Tag tone={PLANNED_TONE}>{d.valid_from} 起</Tag>}
          </DbCell>
          <DbCell>
            <Link className="text-fg-strong font-medium hover:underline" to={`/persons/${d.person_id}`}>
              {d.person_name}
            </Link>
            <span className="text-fg-muted ml-1.5 font-mono text-caption">{d.person_code}</span>
          </DbCell>
          <DbCell className="text-fg-secondary whitespace-nowrap">{period(d.valid_from, d.valid_to)}</DbCell>
          <DbCell className="max-w-56 truncate">
            <DutyBasis note={d.basis_note} />
          </DbCell>
          <DbCell className="whitespace-nowrap">
            {onAction && (!d.valid_to || d.valid_to >= today()) && (
              <>
                <InlineAction onClick={() => onAction('handover', d)}>交接</InlineAction>
                <InlineAction onClick={() => onAction('end', d)}>结束</InlineAction>
              </>
            )}
          </DbCell>
        </DbRow>
      ))}
    </DbTable>
  )
}
