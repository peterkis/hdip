// 关系图共用件（细节按 ReUI Flow 区块）：卡片节点、带标签的直角折线、自动适配视图。
// 主体—院区运营关系图（operator-flow.tsx）与部门隶属 / 管理关系图（org-flow.tsx）共用，保证样式一致。
import '@xyflow/react/dist/base.css'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, Loading03Icon } from '@hugeicons/core-free-icons'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { Icon, type AppIcon } from '@/components/kit/icon'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ 状态胶囊
export type PillTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral'
export type Pill = { label: string; tone: PillTone; icon?: AppIcon }

// 低饱和度的语义色：运行 = 浅绿，计划中 = 浅黄，试运行 = 浅蓝，停用 = 浅红，其他 = 白底细边框
const PILL: Record<PillTone, string> = {
  success: 'bg-success-soft text-success-text border-success-text/25',
  warning: 'bg-tag-yellow-bg text-tag-yellow-text border-tag-yellow-text/25',
  info: 'bg-info-soft text-info-text border-info-text/25',
  danger: 'bg-danger-soft text-danger-text border-danger-text/25',
  neutral: 'bg-surface-raised text-fg-secondary border-line',
}

export const PILL_ICON = { success: CheckmarkCircle02Icon, warning: Clock01Icon, info: Loading03Icon, danger: CancelCircleIcon } as const

export function PillTag({ pill }: { pill: Pill }) {
  return (
    <span className={cn('ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-caption font-medium', PILL[pill.tone])}>
      {pill.icon && <Icon icon={pill.icon} className="size-3" strokeWidth={2} />}
      {pill.label}
    </span>
  )
}

// ------------------------------------------------------------------ 卡片节点
export type Side = 'left' | 'right' | 'top' | 'bottom'

export type CardData = {
  icon: AppIcon
  title: string
  code?: string
  subtitle?: string
  footer?: string
  footerIcon: AppIcon
  pill?: Pill
  href?: string
  /** 主节点：图标框深色实心，边框加深 */
  strong?: boolean
  /** 有连线的一侧才画端点（小黑点）；没有上级或下级的一侧不画 */
  targets?: Side[]
  sources?: Side[]
  width: number
  height: number
}
export type CardNode = Node<CardData, 'card'>

const POS: Record<Side, Position> = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }

export function FlowCard({ data }: NodeProps<CardNode>) {
  const body = (
    <div
      className={cn(
        'bg-surface-raised flex flex-col rounded-lg border shadow-xs transition-colors',
        data.strong ? 'border-line-strong' : 'border-line',
        data.href && 'hover:border-line-strong',
      )}
      style={{ width: data.width, height: data.height }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 pt-2.5 pb-2">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            data.strong ? 'bg-fg-strong text-surface-raised' : 'border-line text-fg-strong border',
          )}
        >
          <Icon icon={data.icon} className="size-4" strokeWidth={1.75} />
        </span>
        <span className="grid min-w-0 leading-tight">
          <span className="text-fg-strong flex items-baseline gap-1.5 text-xs font-medium">
            <span className="truncate">{data.title}</span>
            {data.code && <span className="text-fg-muted shrink-0 font-mono text-caption font-normal">{data.code}</span>}
          </span>
          <span className="text-fg-muted truncate text-caption">{data.subtitle || ' '}</span>
        </span>
      </div>
      {/* 底部比标题小一号（12px），与参考区块的比例一致 */}
      <div className="border-line-subtle mt-auto flex min-w-0 items-center gap-1.5 border-t px-3 py-1.5">
        <span className="bg-surface-subtle text-fg-secondary flex size-4 shrink-0 items-center justify-center rounded-full">
          <Icon icon={data.footerIcon} className="size-2.5" strokeWidth={2} />
        </span>
        <span className="text-fg-muted truncate text-caption">{data.footer}</span>
        {data.pill && <PillTag pill={data.pill} />}
      </div>
    </div>
  )
  return (
    <>
      {data.targets?.map((s) => <Handle key={`t${s}`} id={s} type="target" position={POS[s]} isConnectable={false} />)}
      {data.href ? (
        <Link to={data.href} className="block rounded-lg">
          {body}
        </Link>
      ) : (
        body
      )}
      {data.sources?.map((s) => <Handle key={`s${s}`} id={s} type="source" position={POS[s]} isConnectable={false} />)}
    </>
  )
}

// ------------------------------------------------------------------ 连线：直角折线，标签贴近目标卡片
export type LabeledEdgeData = { label?: string; dashed?: boolean; stack?: number; stackOf?: number }
export type LabeledEdge = Edge<LabeledEdgeData, 'labeled'>

/**
 * 直角折线；标签放在通往目标卡片的最后一段上（离目标近），
 * 多条线共用一段竖线时，各自的状态不会挤在中间引起误读。
 */
export function LabeledStepEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd }: EdgeProps<LabeledEdge>) {
  const [path, centerX, centerY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0 })
  const horizontal = targetPosition === Position.Left || targetPosition === Position.Right
  // 最后一段的中点：横向连线在“竖线 → 目标”之间；纵向连线在“横线 → 目标”之间
  const lx = horizontal ? (centerX + targetX) / 2 : targetX
  // 同一目标有多条线时，标签按序号上下错开 22px
  const shift = data?.stackOf && data.stackOf > 1 ? ((data.stack ?? 0) - (data.stackOf - 1) / 2) * 22 : 0
  const ly = (horizontal ? targetY : (centerY + targetY) / 2) + shift
  return (
    <>
      <BaseEdge path={path} style={data?.dashed ? { ...style, strokeDasharray: '4 4' } : style} markerEnd={markerEnd} />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className="bg-surface-raised border-line text-fg-strong pointer-events-none absolute rounded-md border px-1.5 py-0.5 text-caption font-medium whitespace-nowrap"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const nodeTypes = { card: FlowCard }
export const edgeTypes = { labeled: LabeledStepEdge }

// ------------------------------------------------------------------ 自动适配
export const FIT = { padding: 0.1, maxZoom: 1 }

/** 容器尺寸变化（窄屏、侧栏收起、弹窗展开）时重新适配，整张图始终完整可见 */
export function AutoFit() {
  const { fitView } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  useEffect(() => {
    if (width && height) fitView(FIT)
  }, [width, height, fitView])
  return null
}
