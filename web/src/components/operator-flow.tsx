// 主体—院区运营关系图：左列主体，右列院区（细节按 ReUI Flow 区块，共用 flow-kit）。
// 查看日期当天在“运行”的院区用灰色流动虚线连接；其他状态（筹建、试运行、停用、关系尚未开始）
// 用实线 + 标签，标签贴近对应院区的那一段，不挤在共用的竖线上。只展示与点击跳转，不拖动、不缩放。
import { Building03Icon, Calendar03Icon, Hospital01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { Background, BackgroundVariant, ReactFlow } from '@xyflow/react'
import type { CampusRow, RelationOut } from '@/api/generated/model'
import { AutoFit, KEEP_CARDS_CLICKABLE, edgeTypes, FIT, nodeTypes, PILL_ICON, type CardNode, type LabeledEdge, type Pill } from '@/components/flow-kit'
import { useFlowHeight } from '@/components/flow-size'
import { OPERATING_STATUS, RELATION_TYPE, type OperatingStatus, type RelationType } from '@/lib/format'

const W = 272
const H = 92
const GAP = 28

// 卡片右下角：运行 = 浅绿；筹建显示“计划中”，用低饱和度浅黄；试运行 = 浅蓝；停用 = 浅红
const STATUS_PILL: Record<OperatingStatus, Pill> = {
  RUNNING: { label: '运行', tone: 'success', icon: PILL_ICON.success },
  TRIAL_RUNNING: { label: '试运行', tone: 'info', icon: PILL_ICON.info },
  PLANNING: { label: '计划中', tone: 'warning', icon: PILL_ICON.warning },
  SUSPENDED: { label: '停用', tone: 'danger', icon: PILL_ICON.danger },
}

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
    ...institutions.map((inst, i): CardNode => {
      // 运营的院区数含筹建中、关系尚未开始的（图上连着几个就是几个）
      const linked = new Set(relations.filter((r) => r.institution_id === inst.id).map((r) => r.campus_id))
      return {
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
          footer: `运营 ${linked.size} 个院区`,
          footerIcon: UserGroupIcon,
          href: `/institutions/${inst.id}`,
          strong: true,
          sources: ['right'],
          width: W,
          height: H,
        },
      }
    }),
    ...shownCampuses.map((c, i): CardNode => {
      const status = c.version.operating_status as OperatingStatus
      return {
        id: `c${c.id}`,
        type: 'card',
        position: { x: W + 180, y: rightY(i) },
        draggable: false,
        selectable: false,
        data: {
          icon: Building03Icon,
          title: c.version.name,
          code: c.code,
          subtitle: c.version.public_name ? `对外称 ${c.version.public_name}` : (c.version.address ?? undefined),
          footer: relations.some((r) => r.campus_id === c.id) ? `自 ${c.version.valid_from} 起` : '尚未建立运营关系',
          footerIcon: Calendar03Icon,
          pill: STATUS_PILL[status],
          href: `/campuses/${c.id}`,
          targets: ['left'],
          width: W,
          height: H,
        },
      }
    }),
  ]

  const edges: LabeledEdge[] = relations.flatMap((r): LabeledEdge[] => {
    const c = shownCampuses.find((x) => x.id === r.campus_id)
    if (!c || !institutions.some((i) => i.id === r.institution_id)) return []
    const status = c.version.operating_status as OperatingStatus
    const sameTarget = relations.filter((x) => x.campus_id === r.campus_id)
    const running = r.effective_on_as_of && !c.not_yet_effective && status === 'RUNNING'
    const type = r.relation_type === 'OPERATE' ? '' : `${RELATION_TYPE[r.relation_type as RelationType]} · `
    // 院区不在运行（筹建、试运行、停用）：写院区状态，开始日已在卡片上；
    // 院区运行、关系尚未开始：写开始日；运行中：不加标签（非“运营”类关系写类型）
    const label =
      status !== 'RUNNING'
        ? `${type}${OPERATING_STATUS[status]}`
        : !r.effective_on_as_of
          ? `${type}${r.valid_from} 起`
          : type
            ? type.slice(0, -3)
            : undefined
    return [
      {
        id: `r${r.id}`,
        source: `i${r.institution_id}`,
        target: `c${r.campus_id}`,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'labeled',
        animated: running,
        className: running ? 'hd-edge-running' : 'hd-edge-idle',
        // 多条线连到同一院区时，标签上下错开，不重叠
        data: { label, stack: sameTarget.findIndex((x) => x.id === r.id), stackOf: sameTarget.length },
        focusable: false,
      },
    ]
  })

  const rows = Math.max(institutions.length, shownCampuses.length, 1)
  const { ref, height } = useFlowHeight(W * 2 + 180, rows * (H + GAP), 180)

  return (
    <div className="grid gap-2">
      <div ref={ref} className="hd-flow hd-flow-dots bg-surface-sidebar border-line-subtle rounded-md border" style={{ height }}>
        <ReactFlow
          // 节点变化（数据加载完）时重新挂载，让 fitView 按新内容适配
          key={nodes.map((n) => n.id).join(',')}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={KEEP_CARDS_CLICKABLE}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <AutoFit />
        </ReactFlow>
      </div>
      <p className="text-fg-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        <span className="flex items-center gap-1.5">
          <span className="hd-legend-running" /> 流动虚线：{asOf} 正在运行
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hd-legend-idle" /> 实线 + 标签：筹建、试运行、停用，或运营关系尚未开始（标签贴近对应院区）
        </span>
        <span>点卡片查看主体或院区</span>
      </p>
    </div>
  )
}
