// 拆分 / 合并的图示：左列前身、右列后继，中间一个节点写明生效日。
// 用 React Flow 只做展示与点选（不拖动、不缩放），节点样式按设计令牌自绘。
import '@xyflow/react/dist/base.css'
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
import { Add01Icon, GitForkIcon, GitMergeIcon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'
import { Icon } from '@/components/kit/icon'
import { cn } from '@/lib/utils'

export type FlowUnit = {
  /** 单元名称；未填时显示 placeholder */
  name: string
  placeholder?: string
  code?: string
  /** 第二行：类型 · 部门 · 院区 */
  subtitle?: string
  /** 底部左侧：最后有效日 / 自某日起 */
  footer?: string
  tag: { label: string; tone: 'retire' | 'new' | 'current' }
  invalid?: boolean
  /** 可点选的节点（拆分、合并时编辑哪一个后继 / 前身） */
  selectable?: boolean
  /** 详情页里点击跳到该单元 */
  href?: string
}

type UnitNode = Node<FlowUnit & { selected?: boolean; onPick?: () => void }, 'unit'>
type HubNode = Node<{ kind: 'split' | 'merge'; day: string }, 'hub'>
type AddNode = Node<{ label: string; onAdd: () => void }, 'add'>

const W = 248
const H = 92
const GAP_Y = 20
const HUB_W = 120

const TAG: Record<FlowUnit['tag']['tone'], string> = {
  retire: 'bg-tag-gray-bg text-tag-gray-text',
  new: 'bg-tag-green-bg text-tag-green-text',
  current: 'bg-tag-blue-bg text-tag-blue-text',
}

function UnitCard({ data }: NodeProps<UnitNode>) {
  const clickable = !!data.onPick || !!data.href
  const body = (
    <div
      className={cn(
        'bg-surface-raised flex flex-col rounded-lg border text-left shadow-xs transition-colors',
        data.invalid ? 'border-danger' : data.selected ? 'border-brand ring-brand ring-2' : 'border-line',
        clickable && 'hover:border-line-strong cursor-pointer',
      )}
      style={{ width: W, height: H }}
    >
      <div className="grid min-w-0 gap-0.5 px-3 pt-2.5 pb-2">
        <div className="text-fg-strong flex min-w-0 items-baseline gap-1.5 text-xs font-medium">
          <span className={cn('truncate', !data.name && 'text-fg-muted font-normal')}>{data.name || data.placeholder}</span>
          {data.code && <span className="text-fg-muted shrink-0 font-mono text-caption font-normal">{data.code}</span>}
        </div>
        <div className="text-fg-muted truncate text-caption">{data.subtitle || ' '}</div>
      </div>
      <div className="border-line-subtle mt-auto flex items-center gap-2 border-t px-3 py-1.5">
        <span className="text-fg-muted truncate text-caption">{data.footer}</span>
        <span className={cn('ml-auto shrink-0 rounded-sm px-1.5 text-caption font-medium', data.invalid ? 'bg-danger-soft text-danger-text' : TAG[data.tag.tone])}>
          {data.invalid ? '待补全' : data.tag.label}
        </span>
      </div>
    </div>
  )
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {data.href ? (
        <Link to={data.href} className="block rounded-lg">
          {body}
        </Link>
      ) : data.onPick ? (
        <button type="button" onClick={data.onPick} className="block rounded-lg">
          {body}
        </button>
      ) : (
        body
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

function Hub({ data }: NodeProps<HubNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        className="bg-surface-raised border-line text-fg-secondary flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-caption shadow-xs"
        style={{ width: HUB_W }}
      >
        <span className="text-fg-strong flex items-center gap-1 font-medium">
          <Icon icon={data.kind === 'split' ? GitForkIcon : GitMergeIcon} className="size-3.5" strokeWidth={2} />
          {data.kind === 'split' ? '拆分' : '合并'}
        </span>
        <span>{data.day ? `${data.day} 起` : '待选生效日'}</span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

function AddCard({ data }: NodeProps<AddNode>) {
  return (
    <button
      type="button"
      onClick={data.onAdd}
      className="border-line text-fg-muted hover:text-fg hover:border-line-strong flex items-center justify-center gap-1 rounded-lg border border-dashed text-xs"
      style={{ width: W, height: 36 }}
    >
      <Icon icon={Add01Icon} className="size-3.5" strokeWidth={2} />
      {data.label}
    </button>
  )
}

const nodeTypes = { unit: UnitCard, hub: Hub, add: AddCard }

function column(count: number, extra: number) {
  const total = count * H + (count - 1) * GAP_Y + extra
  return (i: number) => i * (H + GAP_Y) - total / 2
}

export function EvolveFlow({
  kind,
  day,
  before,
  after,
  selected,
  onSelect,
  onAdd,
  addLabel,
  className,
}: {
  kind: 'split' | 'merge'
  day: string
  before: FlowUnit[]
  after: FlowUnit[]
  /** 当前选中的节点：'b0'（前身 0）或 'a1'（后继 1） */
  selected?: string
  onSelect?: (key: string) => void
  /** 在可增加的一侧末尾显示“+”节点 */
  onAdd?: () => void
  addLabel?: string
  className?: string
}) {
  const addSide = kind === 'split' ? 'a' : 'b'
  const addExtra = onAdd ? GAP_Y + 36 : 0
  const leftY = column(before.length, addSide === 'b' ? addExtra : 0)
  const rightY = column(after.length, addSide === 'a' ? addExtra : 0)
  const hubX = W + 70
  const rightX = hubX + HUB_W + 70

  const unitNode = (u: FlowUnit, key: string, x: number, y: number): UnitNode => ({
    id: key,
    type: 'unit',
    position: { x, y },
    draggable: false,
    selectable: false,
    data: { ...u, selected: selected === key, onPick: u.selectable && onSelect ? () => onSelect(key) : undefined },
  })
  const nodes: Node[] = [
    ...before.map((u, i) => unitNode(u, `b${i}`, 0, leftY(i))),
    { id: 'hub', type: 'hub', position: { x: hubX, y: -24 }, draggable: false, selectable: false, data: { kind, day } },
    ...after.map((u, i) => unitNode(u, `a${i}`, rightX, rightY(i))),
  ]
  if (onAdd) {
    const side = addSide === 'a' ? after : before
    const y = (addSide === 'a' ? rightY : leftY)(side.length)
    nodes.push({
      id: 'add',
      type: 'add',
      position: { x: addSide === 'a' ? rightX : 0, y },
      draggable: false,
      selectable: false,
      data: { label: addLabel ?? '添加', onAdd },
    })
  }
  const edge = (source: string, target: string): Edge => ({
    id: `${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    style: { strokeDasharray: '4 4' },
    focusable: false,
  })
  const edges = [...before.map((_, i) => edge(`b${i}`, 'hub')), ...after.map((_, i) => edge('hub', `a${i}`))]

  const rows = Math.max(before.length + (addSide === 'b' && onAdd ? 0.5 : 0), after.length + (addSide === 'a' && onAdd ? 0.5 : 0))
  const height = Math.max(160, rows * (H + GAP_Y) + 48)

  return (
    <div className={cn('hd-flow bg-surface-sidebar border-line-subtle rounded-md border', className)} style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
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
  )
}
