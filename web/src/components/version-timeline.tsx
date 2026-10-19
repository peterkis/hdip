// 版本与事件时间线（按原型复刻）：左侧一条浅灰竖线，每个事件一个蓝色实心圆点；
// 日期（灰）→ 事件名（粗）→ 一句说明（灰）。默认按时间从早到晚，order="desc" 时最新在上（部门页）；查看日期之后的事件显示为灰色。
// 事件由版本推出（设立、更名、修订属性、生命周期变更…），页面还可补充其他事件（分类赋值、隶属调整、组织变更）。
import { Link } from 'react-router'
import { useApp } from '@/lib/app-context'
import { FIELD_LABELS, formatValue } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Version {
  version_no: number
  valid_from: string
  valid_to: string | null
  change_id: number
  recorded_at: string
  recorded_by: { display_name: string }
}

export interface TimelineEvent {
  key: string
  date: string
  title: string
  detail?: string
  changeId?: number
  /** 生效前已更正的版本：从未生效 */
  void?: boolean
}

/** 只改了这些字段时用专门的事件名 */
const SPECIAL: [string, string][] = [
  ['name', '更名'],
  ['lifecycle', '生命周期变更'],
  ['operating_status', '运营状态变更'],
  ['status', '状态变更'],
  ['department_name', '更换所属部门'],
]

function isEmpty(x: unknown) {
  return x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)
}

/** 由版本推出事件：第一版 = 设立 / 建立；之后每版按改动的字段命名，说明写“旧 → 新” */
export function useVersionEvents<V extends Version>(
  versions: V[],
  fields: (keyof V)[],
  first: { title: string; detail: (v: V) => string },
): TimelineEvent[] {
  const { optionLabels } = useApp()
  const fmt = (f: keyof V, v: V) => formatValue(String(f), v[f], optionLabels)
  const asc = [...versions].sort((a, b) => a.version_no - b.version_no)
  const live = asc.filter((v) => !(v.valid_to !== null && v.valid_to < v.valid_from))
  return asc.map((v): TimelineEvent => {
    const isVoid = v.valid_to !== null && v.valid_to < v.valid_from
    const prev = live.filter((x) => x.version_no < v.version_no).at(-1)
    if (!prev)
      return { key: `v${v.version_no}`, date: v.valid_from, title: first.title, detail: first.detail(v), changeId: v.change_id, void: isVoid }
    const changed = fields.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(v[f]))
    const special = changed.length === 1 ? SPECIAL.find(([f]) => f === changed[0])?.[1] : undefined
    const detail = changed
      .map((f) => {
        const label = changed.length === 1 && special ? '' : `${FIELD_LABELS[String(f)]}：`
        return isEmpty(prev[f]) ? `${label}补录 ${fmt(f, v)}` : `${label}${fmt(f, prev)} → ${fmt(f, v)}`
      })
      .join('；')
    return {
      key: `v${v.version_no}`,
      date: v.valid_from,
      title: isVoid ? '生效前已更正' : (special ?? '修订属性'),
      detail: (special === '更名' ? `${detail}（身份不变）` : detail) || '内容未变，只调整了期间',
      changeId: v.change_id,
      void: isVoid,
    }
  })
}

export function Timeline({ events, asOf, order = 'asc' }: { events: TimelineEvent[]; asOf: string; order?: 'asc' | 'desc' }) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  if (order === 'desc') sorted.reverse()
  return (
    <div className="grid gap-5">
      <ol className="relative">
        <span aria-hidden className="bg-line-subtle absolute top-0 bottom-0 left-1.5 w-0.5 rounded-full" />
        {sorted.map((e) => {
          const muted = e.date > asOf || e.void
          return (
            <li key={e.key} className="group relative pb-4 pl-7 last:pb-2">
              <span
                aria-hidden
                className={cn('absolute top-1 left-0 size-3.5 rounded-full', muted ? 'bg-line-strong' : 'bg-brand')}
              />
              <div className="flex items-baseline gap-3">
                <span className={cn('text-xs tabular-nums', muted ? 'text-fg-disabled' : 'text-fg-muted')}>{e.date}</span>
                {e.changeId && (
                  <Link
                    to={`/changes/${e.changeId}`}
                    className="text-fg-muted hover:text-fg text-caption opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    申请 #{e.changeId}
                  </Link>
                )}
              </div>
              <div className={cn('text-xs font-semibold', muted ? 'text-fg-muted' : 'text-fg-strong', e.void && 'line-through')}>
                {e.title}
              </div>
              {e.detail && <div className={cn('text-caption', muted ? 'text-fg-disabled' : 'text-fg-secondary')}>{e.detail}</div>}
            </li>
          )
        })}
      </ol>
      <p className="text-fg-muted text-xs">每个事件都对应一张已确认的变更申请；查看日期之后的事件显示为灰色。</p>
    </div>
  )
}

/** 版本时间线：由版本推出事件，可附加页面自己的事件 */
export function VersionTimeline<V extends Version>({
  versions,
  fields,
  asOf,
  first,
  extra = [],
  order,
}: {
  versions: V[]
  fields: (keyof V)[]
  asOf: string
  first?: { title: string; detail: (v: V) => string }
  extra?: TimelineEvent[]
  order?: 'asc' | 'desc'
}) {
  const { optionLabels } = useApp()
  const events = useVersionEvents(
    versions,
    fields,
    first ?? {
      title: '建立',
      detail: (v) =>
        fields
          .filter((f) => !isEmpty(v[f]))
          .slice(0, 3)
          .map((f) => formatValue(String(f), v[f], optionLabels))
          .join('，'),
    },
  )
  return <Timeline events={[...events, ...extra]} asOf={asOf} order={order} />
}
