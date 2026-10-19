// 部门隶属与管理关系图（部门详情“隶属与管理关系”）：
// 纵向是行政隶属——上级链在上，本部门居中，下级部门在下，实线直角折线；
// 横向是管理关系——本部门管理 / 协作的对象在右，管理本部门的在左，虚线 + 关系标签（贴近对方卡片）。
// 只展示查看日期当天有效的隶属与关系；点卡片跳到对应部门或院区。样式与运营关系图共用 flow-kit。
import { Building03Icon, Layers01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { Background, BackgroundVariant, ReactFlow } from '@xyflow/react'
import type { DepartmentRelationOut, DeptRef } from '@/api/generated/model'
import { AutoFit, KEEP_CARDS_CLICKABLE, edgeTypes, FIT, nodeTypes, type CardNode, type LabeledEdge, type PillTone } from '@/components/flow-kit'
import { useFlowHeight } from '@/components/flow-size'
import { DEPT_RELATION, levelShort, type DeptRelationKind } from '@/lib/format'
import { levelTone } from '@/lib/tones'

const W = 232
const H = 84
const HGAP = 28
const VGAP = 56
const SIDE = 150

const KIND_TONE: Record<string, PillTone> = { PROFESSIONAL_MGMT: 'info', COLLABORATION: 'success', CAMPUS_MGMT: 'warning' }

function short(text: string, n = 10) {
  return text.length > n ? `${text.slice(0, n)}…` : text
}

export function OrgFlow({
  self,
  level,
  path,
  children,
  relations,
  asOf,
}: {
  self: { id: number; code: string; name: string }
  level: number
  /** 从一级部门到本部门（含本部门） */
  path: DeptRef[]
  /** 查看日期当天的直接下级 */
  children: DeptRef[]
  /** 本部门参与的管理关系（含已结束的，图里只画当天有效的） */
  relations: DepartmentRelationOut[]
  asOf: string
}) {
  const ancestors = path.filter((p) => p.id !== self.id)
  const current = relations.filter((r) => r.valid_from <= asOf && (r.valid_to === null || r.valid_to >= asOf))
  const outgoing = current.filter((r) => r.from_department.id === self.id)
  const incoming = current.filter((r) => r.from_department.id !== self.id)

  const node = (id: string, x: number, y: number, data: Omit<CardNode['data'], 'width' | 'height'>): CardNode => ({
    id,
    type: 'card',
    position: { x, y },
    draggable: false,
    selectable: false,
    data: { ...data, width: W, height: H },
  })
  const stackY = (n: number) => (i: number) => i * (H + HGAP) - ((n - 1) * (H + HGAP)) / 2

  const nodes: CardNode[] = []
  const edges: LabeledEdge[] = []

  // 上级链：最上面是一级部门
  ancestors.forEach((a, k) => {
    const y = -(ancestors.length - k) * (H + VGAP)
    nodes.push(
      node(`a${a.id}`, 0, y, {
        icon: UserGroupIcon,
        title: a.name,
        code: a.code,
        cornerTag: { label: levelShort(k + 1), tone: levelTone(k + 1) },
        footer: k === ancestors.length - 1 ? '直接上级' : '上级',
        footerIcon: Layers01Icon,
        href: `/departments/${a.id}`,
        targets: k > 0 ? ['top'] : [],
        sources: ['bottom'],
      }),
    )
    const below = k === ancestors.length - 1 ? 'self' : `a${ancestors[k + 1].id}`
    edges.push({ id: `h${a.id}`, source: `a${a.id}`, target: below, sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', className: 'hd-edge-idle', focusable: false })
  })

  // 本部门
  nodes.push(
    node('self', 0, 0, {
      icon: UserGroupIcon,
      title: self.name,
      code: self.code,
      subtitle: '本部门',
      cornerTag: { label: levelShort(level), tone: levelTone(level) },
      footer: `下级 ${children.length} 个 · 管理关系 ${current.length} 条`,
      footerIcon: Layers01Icon,
      strong: true,
      targets: [...(ancestors.length ? (['top'] as const) : []), ...(incoming.length ? (['left'] as const) : [])],
      sources: [...(children.length ? (['bottom'] as const) : []), ...(outgoing.length ? (['right'] as const) : [])],
    }),
  )

  // 下级部门：一排，居中
  children.forEach((c, i) => {
    const x = (i - (children.length - 1) / 2) * (W + HGAP)
    nodes.push(
      node(`c${c.id}`, x, H + VGAP, {
        icon: UserGroupIcon,
        title: c.name,
        code: c.code,
        cornerTag: { label: levelShort(level + 1), tone: levelTone(level + 1) },
        footer: '下级部门',
        footerIcon: Layers01Icon,
        href: `/departments/${c.id}`,
        targets: ['top'],
      }),
    )
    edges.push({ id: `k${c.id}`, source: 'self', target: `c${c.id}`, sourceHandle: 'bottom', targetHandle: 'top', type: 'labeled', className: 'hd-edge-idle', focusable: false })
  })

  // 管理关系：本部门发起的在右，指向本部门的在左
  const childSpan = Math.max(children.length, 1) * (W + HGAP) - HGAP
  const sideX = Math.max(childSpan / 2, W / 2) + SIDE
  const ry = stackY(outgoing.length)
  outgoing.forEach((r, i) => {
    const kind = DEPT_RELATION[r.kind as DeptRelationKind]
    const other = r.to_department
    const id = `o${r.id}`
    nodes.push(
      node(id, sideX + W / 2, ry(i), {
        icon: other ? UserGroupIcon : Building03Icon,
        title: other ? other.name : (r.campus_name ?? '院区'),
        code: other?.code,
        subtitle: r.scope,
        footer: `自 ${r.valid_from} 起`,
        footerIcon: Layers01Icon,
        pill: { label: kind, tone: KIND_TONE[r.kind] ?? 'neutral' },
        href: other ? `/departments/${other.id}` : r.campus_id ? `/campuses/${r.campus_id}` : undefined,
        targets: ['left'],
      }),
    )
    edges.push({ id: `e${r.id}`, source: 'self', target: id, sourceHandle: 'right', targetHandle: 'left', type: 'labeled', className: 'hd-edge-idle', data: { label: `${kind}：${short(r.scope)}`, dashed: true }, focusable: false })
  })
  const ly = stackY(incoming.length)
  incoming.forEach((r, i) => {
    const kind = DEPT_RELATION[r.kind as DeptRelationKind]
    const other = r.from_department
    const id = `n${r.id}`
    nodes.push(
      node(id, -(sideX + W / 2) - W, ly(i), {
        icon: UserGroupIcon,
        title: other.name,
        code: other.code,
        subtitle: r.scope,
        footer: `自 ${r.valid_from} 起`,
        footerIcon: Layers01Icon,
        pill: { label: kind, tone: KIND_TONE[r.kind] ?? 'neutral' },
        href: `/departments/${other.id}`,
        sources: ['right'],
      }),
    )
    edges.push({ id: `e${r.id}`, source: id, target: 'self', sourceHandle: 'right', targetHandle: 'left', type: 'labeled', className: 'hd-edge-idle', data: { label: `${kind}：${short(r.scope)}`, dashed: true }, focusable: false })
  })

  // 自身居中：上面的坐标以本部门左上角为原点，横向用卡片中心对齐
  for (const n of nodes) if (n.id === 'self' || n.id.startsWith('a')) n.position.x = -W / 2
  for (const n of nodes) if (n.id.startsWith('c')) n.position.x -= W / 2

  const core = Math.max(childSpan, W) / 2
  const sideExtent = sideX + W / 2 + W
  const width = (incoming.length ? sideExtent : core) + (outgoing.length ? sideExtent : core)
  const rows = ancestors.length + 1 + (children.length ? 1 : 0)
  const height = Math.max(rows * (H + VGAP) - VGAP, Math.max(outgoing.length, incoming.length) * (H + HGAP))
  const { ref, height: boxHeight } = useFlowHeight(Math.max(width, W * 3), height, 200)

  return (
    <div className="grid gap-2">
      <div ref={ref} className="hd-flow hd-flow-dots hd-flow-vertical bg-surface-sidebar border-line-subtle rounded-md border" style={{ height: boxHeight }}>
        <ReactFlow
          key={nodes.map((n) => n.id).join(',')}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          minZoom={0.15}
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
          <span className="hd-legend-idle hd-legend-soft" /> 实线：行政隶属（{asOf}，上级在上、下级在下）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="hd-legend-running hd-legend-soft" /> 虚线 + 标签：管理关系（右：本部门管理 / 协作的对象；左：管理本部门的）
        </span>
        <span>点卡片查看对应部门</span>
      </p>
    </div>
  )
}
