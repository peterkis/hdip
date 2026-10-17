// 主体—院区运营关系图：左列主体，右列院区。
// 查看日期当天在“运行”的院区用流动的虚线连接（一目了然：正在运行）；
// 其他状态（筹建、试运行、停用、关系尚未开始）用实线 + 标签写明状态。只展示与点击跳转，不拖动、不缩放。
import '@xyflow/react/dist/base.css'
import {
  Building03Icon,
  Calendar03Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Hospital01Icon,
  Loading03Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
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
import { OPERATING_STATUS, RELATION_TYPE, type OperatingStatus, type RelationType } from '@/lib/format'
import { cn } from '@/lib/utils'

type Pill = { label: string; tone: 'success' | 'info' | 'danger' | 'neutral'; icon: AppIcon }

type CardData = {
  icon: AppIcon
  title: string
  code: string
  subtitle?: string
  footer?: string
  footerIcon: AppIcon
  pill?: Pill
  href: string
  strong?: boolean
  /** 左列（主体）只有右侧端点；右列（院区）只有左侧端点：没有上级或下级的一侧不画端点 */
  side: 'left' | 'right'
}
type CardNode = Node<CardData, 'card'>

const W = 272
const H = 100
const GAP = 28

// 状态胶囊：与截图一致——成功 = 浅绿底绿字，失败 = 浅红底红字，其他 = 白底细边框
const PILL: Record<Pill['tone'], string> = {
  success: 'bg-success-soft text-success-text border-success-text/25',
  info: 'bg-info-soft text-info-text border-info-text/25',
  danger: 'bg-danger-soft text-danger-text border-danger-text/25',
  neutral: 'bg-surface-raised text-fg-strong border-line',
}

const STATUS_PILL: Record<OperatingStatus, Pill> = {
  RUNNING: { label: '运行', tone: 'success', icon: CheckmarkCircle02Icon },
  TRIAL_RUNNING: { label: '试运行', tone: 'info', icon: Loading03Icon },
  PLANNING: { label: '筹建', tone: 'neutral', icon: Clock01Icon },
  SUSPENDED: { label: '停用', tone: 'danger', icon: CancelCircleIcon },
}

/** 卡片：左右两侧中点各一个黑色实心端点（截图样式），连线从端点出发 */
function Card({ data }: NodeProps<CardNode>) {
  return (
    <>
      {data.side === 'right' && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <Link
        to={data.href}
        className="bg-surface-raised border-line hover:border-line-strong flex flex-col rounded-lg border shadow-xs transition-colors"
        style={{ width: W, height: H }}
      >
        <div className="flex min-w-0 items-center gap-2.5 px-3 pt-3 pb-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              data.strong ? 'bg-fg-strong text-surface-raised' : 'border-line text-fg-strong border',
            )}
          >
            <Icon icon={data.icon} className="size-4" strokeWidth={1.75} />
          </span>
          <span className="grid min-w-0 leading-tight">
            <span className="text-fg-strong flex items-baseline gap-1.5 text-sm font-medium">
              <span className="truncate">{data.title}</span>
              <span className="text-fg-muted shrink-0 font-mono text-caption font-normal">{data.code}</span>
            </span>
            <span className="text-fg-muted truncate text-xs">{data.subtitle || ' '}</span>
          </span>
        </div>
        <div className="border-line-subtle mt-auto flex items-center gap-2 border-t px-3 py-1.5">
          <span className="bg-surface-subtle text-fg-secondary flex size-5 shrink-0 items-center justify-center rounded-full">
            <Icon icon={data.footerIcon} className="size-3" strokeWidth={2} />
          </span>
          <span className="text-fg-muted truncate text-xs">{data.footer}</span>
          {data.pill && (
            <span className={cn('ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium', PILL[data.pill.tone])}>
              <Icon icon={data.pill.icon} className="size-3.5" strokeWidth={2} />
              {data.pill.label}
            </span>
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
          footerIcon: UserGroupIcon,
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
        position: { x: W + 160, y: rightY(i) },
        draggable: false,
        selectable: false,
        data: {
          icon: Building03Icon,
          title: c.version.name,
          code: c.code,
          subtitle: c.version.public_name ? `对外称 ${c.version.public_name}` : c.version.address ?? undefined,
          footer: c.not_yet_effective ? `${c.version.valid_from} 起` : relations.some((r) => r.campus_id === c.id) ? `自 ${c.version.valid_from} 起` : '尚未建立运营关系',
          footerIcon: Calendar03Icon,
          pill: STATUS_PILL[status],
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
        // 直线 + 直角转折（与截图一致）；标签落在中间的竖段上
        type: 'step',
        animated: running,
        className: running ? 'hd-edge-running' : 'hd-edge-idle',
        label,
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 6,
        focusable: false,
      },
    ]
  })

  const rows = Math.max(institutions.length, shownCampuses.length, 1)
  const height = Math.max(220, rows * (H + GAP) + 60)

  return (
    <div className="grid gap-2">
      <div className="hd-flow hd-flow-dots bg-surface-sidebar border-line-subtle rounded-md border" style={{ height }}>
        <ReactFlow
          // 节点变化（数据加载完、增删后继）时重新挂载，让 fitView 按新内容适配
          key={nodes.map((n) => n.id).join(',')}
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
