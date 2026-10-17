// 主体—院区运营关系图：左列主体，右列院区。
// 查看日期当天在“运行”的院区用流动的虚线连接（一目了然：正在运行）；
// 其他状态（筹建、试运行、停用、关系尚未开始）用实线 + 标签写明状态。只展示与点击跳转，不拖动、不缩放。
import '@xyflow/react/dist/base.css'
import { Building03Icon, Hospital01Icon } from '@hugeicons/core-free-icons'
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Link } from 'react-router'
import type { CampusRow, RelationOut } from '@/api/generated/model'
import { Icon, type AppIcon } from '@/components/kit/icon'
import { Tag, type Tone } from '@/components/kit/tag'
import { OPERATING_STATUS, RELATION_TYPE, type OperatingStatus, type RelationType } from '@/lib/format'
import { OPERATING_STATUS_TONE } from '@/lib/tones'
import { cn } from '@/lib/utils'

type CardData = {
  icon: AppIcon
  title: string
  code: string
  subtitle?: string
  footer?: string
  tag?: { label: string; tone: Tone }
  href: string
  strong?: boolean
  side: 'left' | 'right'
}
type CardNode = Node<CardData, 'card'>

const W = 260
const H = 96
const GAP = 22

function Card({ data }: NodeProps<CardNode>) {
  return (
    <>
      {data.side === 'right' && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <Link
        to={data.href}
        className={cn(
          'bg-surface-raised hover:border-line-strong flex flex-col rounded-lg border shadow-xs transition-colors',
          data.strong ? 'border-line-strong' : 'border-line',
        )}
        style={{ width: W, height: H }}
      >
        <div className="flex min-w-0 items-center gap-2.5 px-3 pt-2.5 pb-2">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              data.strong ? 'bg-fg-strong text-surface-raised' : 'border-line text-fg-secondary border',
            )}
          >
            <Icon icon={data.icon} className="size-4" strokeWidth={1.75} />
          </span>
          <span className="grid min-w-0">
            <span className="text-fg-strong flex items-baseline gap-1.5 truncate text-xs font-medium">
              <span className="truncate">{data.title}</span>
              <span className="text-fg-muted shrink-0 font-mono text-caption font-normal">{data.code}</span>
            </span>
            <span className="text-fg-muted truncate text-caption">{data.subtitle || ' '}</span>
          </span>
        </div>
        <div className="border-line-subtle mt-auto flex items-center gap-2 border-t px-3 py-1.5">
          <span className="text-fg-muted truncate text-caption">{data.footer}</span>
          {data.tag && (
            <Tag tone={data.tag.tone} className="ml-auto h-auto text-caption">
              {data.tag.label}
            </Tag>
          )}
        </div>
      </Link>
      {data.side === 'left' && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </>
  )
}

const nodeTypes = { card: Card }

export interface FlowInstitution {
  id: number
  code: string
  name: string
  subtitle?: string
}

export function OperatorFlow({
  institutions,
  campuses,
  relations,
  asOf,
  allCampuses = false,
}: {
  institutions: FlowInstitution[]
  /** 院区：查看日期当天的版本或最早的计划版本 */
  campuses: CampusRow[]
  /** 查看日期当天有效及之后才开始的关系 */
  relations: RelationOut[]
  asOf: string
  allCampuses?: boolean
}) {
  // 主体页只画与它有关系的院区；全院视图（allCampuses）把没有任何关系的院区也列出
  const shownCampuses = allCampuses ? campuses : campuses.filter((c) => relations.some((r) => r.campus_id === c.id))
  const colY = (n: number) => (i: number) => i * (H + GAP) - (n * H + (n - 1) * GAP) / 2
  const leftY = colY(institutions.length)
  const rightY = colY(shownCampuses.length)
  const nodes: CardNode[] = [
    ...institutions.map(
      (inst, i): CardNode => ({
        id: `i${inst.id}`,
        type: 'card',
        position: { x: 0, y: leftY(i) },
        draggable: false,
        selectable: false,
        data: {
          icon: Hospital01Icon,
          title: inst.name,
          code: inst.code,
          subtitle: inst.subtitle ?? '运营主体（法人）',
          footer: `运营 ${relations.filter((r) => r.institution_id === inst.id && r.effective_on_as_of).length} 个院区`,
          href: `/institutions/${inst.id}`,
          strong: true,
          side: 'left',
        },
      }),
    ),
    ...shownCampuses.map((c, i): CardNode => {
      const status = c.version.operating_status as OperatingStatus
      return {
        id: `c${c.id}`,
        type: 'card',
        position: { x: W + 200, y: rightY(i) },
        draggable: false,
        selectable: false,
        data: {
          icon: Building03Icon,
          title: c.version.name,
          code: c.code,
          subtitle: c.version.public_name ? `对外称 ${c.version.public_name}` : c.version.address ?? undefined,
          footer: c.not_yet_effective ? `${c.version.valid_from} 起` : relations.some((r) => r.campus_id === c.id) ? `自 ${c.version.valid_from} 起` : '尚未建立运营关系',
          tag: { label: OPERATING_STATUS[status], tone: OPERATING_STATUS_TONE[status] },
          href: `/campuses/${c.id}`,
          side: 'right',
        },
      }
    }),
  ]

  const edges: Edge[] = relations.flatMap((r) => {
    const c = shownCampuses.find((x) => x.id === r.campus_id)
    if (!c || !institutions.some((i) => i.id === r.institution_id)) return []
    const status = c.version.operating_status as OperatingStatus
    const running = r.effective_on_as_of && !c.not_yet_effective && status === 'RUNNING'
    const type = r.relation_type === 'OPERATE' ? '' : `${RELATION_TYPE[r.relation_type as RelationType]} · `
    const label = !r.effective_on_as_of
      ? `${type}${r.valid_from} 起`
      : running
        ? type
          ? type.slice(0, -3)
          : undefined
        : `${type}${OPERATING_STATUS[status]}`
    return [
      {
        id: `r${r.id}`,
        source: `i${r.institution_id}`,
        target: `c${r.campus_id}`,
        // 贝塞尔曲线：每条连线各走各的路，标签不挤在同一根竖线上
        type: 'default',
        animated: running,
        className: running ? 'hd-edge-running' : 'hd-edge-idle',
        label,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        focusable: false,
      },
    ]
  })

  const rows = Math.max(institutions.length, shownCampuses.length, 1)
  const height = Math.max(220, rows * (H + GAP) + 60)

  return (
    <div className="grid gap-2">
      <div className="hd-flow bg-surface-sidebar border-line-subtle rounded-md border" style={{ height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        </ReactFlow>
      </div>
      <p className="text-fg-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        <span className="flex items-center gap-1.5">
          <span className="hd-legend-running" /> 流动虚线：{asOf} 正在运行
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hd-legend-idle" /> 实线 + 标签：筹建、试运行、停用，或关系尚未开始
        </span>
        <span>点卡片查看主体或院区</span>
      </p>
    </div>
  )
}
