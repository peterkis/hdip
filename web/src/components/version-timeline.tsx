// 版本时间线：竖向进度线，新版本在上。每个节点一眼看清三件事——
// ① 这一版的状态（查看日期当天有效 / 计划中 / 已结束 / 生效前已更正）与业务期间；
// ② 相对上一版改了什么（旧值划掉 → 新值），第一版列出建立时填写的内容；
// ③ 来源申请、确认人与时间（次要信息，弱化显示）。
import { Link } from 'react-router'
import { Tag, type Tone } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { FIELD_LABELS, formatValue, stamp } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Version {
  version_no: number
  valid_from: string
  valid_to: string | null
  change_id: number
  recorded_at: string
  recorded_by: { display_name: string }
}

type Phase = 'current' | 'future' | 'ended' | 'void'

const PHASE: Record<Phase, { label: string; tone: Tone; dot: string }> = {
  current: { label: '当前有效', tone: 'green', dot: 'bg-brand ring-4 ring-brand-soft' },
  future: { label: '计划中', tone: 'blue', dot: 'bg-surface-raised ring-2 ring-brand' },
  ended: { label: '已结束', tone: 'gray', dot: 'bg-line-strong' },
  void: { label: '生效前已更正', tone: 'gray', dot: 'bg-surface-raised ring-1 ring-line-strong' },
}

function phaseOf(v: Version, asOf: string): Phase {
  if (v.valid_to !== null && v.valid_to < v.valid_from) return 'void'
  if (v.valid_from > asOf) return 'future'
  if (v.valid_to !== null && v.valid_to < asOf) return 'ended'
  return 'current'
}

function isEmpty(x: unknown) {
  return x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)
}

/** 版本按新到旧排列；每版只显示与上一版相比改动的字段，查看日期所在的版本突出显示。 */
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
  // 比较对象：跳过“生效前已更正”的版本，它从未生效
  const live = versions.filter((v) => phaseOf(v, asOf) !== 'void')
  return (
    <ol className="relative grid">
      {versions.map((v, i) => {
        const phase = phaseOf(v, asOf)
        const style = PHASE[phase]
        const prev = phase === 'void' ? versions[i + 1] : live[live.indexOf(v) + 1]
        const changed = fields.filter((f) =>
          prev ? JSON.stringify(prev[f]) !== JSON.stringify(v[f]) : !isEmpty(v[f]),
        )
        const lastItem = i === versions.length - 1
        return (
          <li key={v.version_no} className="relative grid grid-cols-[1.5rem_1fr] gap-x-3">
            {/* 竖线与节点 */}
            <div className="relative flex justify-center">
              {!lastItem && <span aria-hidden className="bg-line absolute top-4 bottom-0 w-px" />}
              <span aria-hidden className={cn('relative z-10 mt-1.5 size-2.5 rounded-full', style.dot)} />
            </div>
            <div className={cn('grid gap-2 pb-6', phase === 'current' && 'bg-surface-subtle -mx-2 mb-4 rounded-md px-2 pt-1 pb-3')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('text-sm font-semibold', phase === 'void' || phase === 'ended' ? 'text-fg-secondary' : 'text-fg-strong')}>
                  第 {v.version_no} 版
                </span>
                <Tag tone={style.tone}>{style.label}</Tag>
                <span className={cn('text-xs', phase === 'void' ? 'text-fg-muted line-through' : 'text-fg-secondary')}>
                  {v.valid_from} → {phase === 'void' ? '未生效' : (v.valid_to ?? '长期')}
                </span>
                <span className="text-fg-muted ml-auto text-caption">
                  <Link className="hover:text-fg hover:underline" to={`/changes/${v.change_id}`}>
                    申请 #{v.change_id}
                  </Link>
                  {' · '}
                  {v.recorded_by.display_name} · {stamp(v.recorded_at)}
                </span>
              </div>
              {changed.length > 0 ? (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                  {changed.map((f) => (
                    <div key={String(f)} className="contents">
                      <dt className="text-fg-muted">{FIELD_LABELS[String(f)]}</dt>
                      <dd className="min-w-0">
                        {prev && (
                          <>
                            <span className="text-fg-muted line-through">{formatValue(String(f), prev[f], optionLabels)}</span>
                            <span className="text-fg-disabled mx-1.5">→</span>
                          </>
                        )}
                        <span className={cn(prev ? 'text-fg-strong font-medium' : 'text-fg')}>
                          {formatValue(String(f), v[f], optionLabels)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-fg-muted text-xs">{prev ? '内容与上一版相同（只调整了期间）' : '建立'}</p>
              )}
              {!prev && phase !== 'void' && <p className="text-fg-muted text-caption">建立：以上为这一版填写的内容</p>}
              {phase === 'void' && <p className="text-fg-muted text-caption">这一版在开始日前已被下一版更正，从未生效，记录保留。</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
