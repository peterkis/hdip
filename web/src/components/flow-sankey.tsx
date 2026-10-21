// 组织总览的桑基图（@nivo/sankey，SVG）。只展示与点选：不拖动，点节点或连带交给页面打开清单。
// 颜色取语义令牌 --hd-chart-*（运行时读出实际值，SVG 属性里不能写 var()），切换深色主题时重读。
// 标签自己画（labels 层）：第一列在节点左侧，其余在右侧，带页面底色描边，压在连带上也看得清；
// 每列顶上写列标题（主分类 / 一级部门 / 服务单元…）。细节见 docs/design/ui-tokens.md 第 8.1 节。
import { ResponsiveSankey, type CustomSankeyLayerProps, type SankeyNodeDatum } from '@nivo/sankey'
import { useMemo } from 'react'
import type { FlowLink, FlowNode } from '@/lib/org-overview'
import { useTheme } from '@/lib/theme'
import type { ChartTone } from '@/lib/tones'

type N = FlowNode
type L = FlowLink & { startColor: string; endColor: string }

const TONES: (ChartTone | 'neutral')[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red', 'neutral']

interface Palette {
  tone: Record<string, string>
  text: string
  muted: string
  page: string
  font: string
  caption: string
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    tone: Object.fromEntries(TONES.map((t) => [t, v(`--hd-chart-${t}`)])),
    text: v('--hd-text-primary'),
    muted: v('--hd-text-muted'),
    page: v('--hd-surface-page'),
    font: v('--hd-font-sans'),
    caption: v('--hd-type-caption-size'),
  }
}

/** 主题（深色、强调色）变化后重新读取令牌 */
function usePalette(): Palette {
  const theme = useTheme()
  return useMemo(readPalette, [theme.mode, theme.accent])
}

const ROW = 30 // 每个节点至少占的高度（px）
const TOP = 28 // 列标题的位置

export function FlowSankey({
  nodes,
  links,
  onSelect,
  label,
  leftMargin = 132,
  rightMargin = 200,
}: {
  nodes: FlowNode[]
  links: FlowLink[]
  /** 点了节点（id）或连带（source、target） */
  onSelect: (sel: { node: string } | { source: string; target: string }) => void
  /** 图的无障碍名称 */
  label: string
  leftMargin?: number
  rightMargin?: number
}) {
  const p = usePalette()
  const data = useMemo(
    () => ({
      nodes,
      links: links.map((l) => ({ ...l, startColor: p.tone[l.tone], endColor: p.tone[l.tone] })),
    }),
    [nodes, links, p],
  )
  // 高度按节点最多的一列定：每个节点至少一行字的高度
  const height = useMemo(() => {
    const perColumn = new Map<string, number>()
    for (const n of nodes) perColumn.set(n.column, (perColumn.get(n.column) ?? 0) + 1)
    return Math.max(280, Math.max(0, ...perColumn.values()) * ROW + TOP + 16)
  }, [nodes])

  if (nodes.length === 0) return null

  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveSankey<N, L>
        data={data}
        margin={{ top: TOP + 8, right: rightMargin, bottom: 8, left: leftMargin }}
        label="name"
        align="justify"
        sort="input"
        colors={(n) => p.tone[n.tone]}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.35}
        nodeThickness={10}
        nodeSpacing={10}
        nodeInnerPadding={0}
        nodeBorderWidth={0}
        nodeBorderRadius={2}
        linkOpacity={0.35}
        linkHoverOpacity={0.6}
        linkHoverOthersOpacity={0.12}
        linkContract={1}
        enableLinkGradient
        linkBlendMode="normal"
        animate={false}
        layers={['links', 'nodes', (props) => <Labels {...props} palette={p} />]}
        nodeTooltip={({ node }) => <Tip title={node.name} note={node.note} value={node.value} />}
        linkTooltip={({ link }) => (
          <Tip title={`${link.source.name} → ${link.target.name}`} value={link.value} />
        )}
        onClick={(datum) => {
          if ('source' in datum) onSelect({ source: datum.source.id, target: datum.target.id })
          else onSelect({ node: datum.id })
        }}
        theme={{
          text: { fontFamily: p.font, fill: p.text },
          tooltip: { container: { background: 'transparent', boxShadow: 'none', padding: 0 } },
        }}
      />
    </div>
  )
}

function Tip({ title, note, value }: { title: string; note?: string; value: number }) {
  return (
    <div className="bg-surface-raised border-line text-fg rounded-md border px-2.5 py-1.5 text-caption whitespace-nowrap shadow-(--hd-elevation-popover)">
      <div className="text-fg-strong font-medium">{title}</div>
      <div className="text-fg-muted">
        {note && `${note} · `}
        {value}
      </div>
    </div>
  )
}

/** 节点标签与列标题 */
function Labels({ nodes, palette: p }: CustomSankeyLayerProps<N, L> & { palette: Palette }) {
  const columns = new Map<number, { x: number; title: string; first: boolean }>()
  const minX = Math.min(...nodes.map((n) => n.x0))
  for (const n of nodes) {
    if (!columns.has(n.x0)) columns.set(n.x0, { x: n.x0, title: n.column, first: n.x0 === minX })
  }
  return (
    <g style={{ fontFamily: p.font, fontSize: p.caption }}>
      {[...columns.values()].map((c) => (
        <text
          key={c.x}
          x={c.first ? c.x + 10 : c.x}
          y={-TOP + 4}
          textAnchor={c.first ? 'end' : 'start'}
          dominantBaseline="hanging"
          fill={p.muted}
        >
          {c.title}
        </text>
      ))}
      {nodes.map((n) => (
        <NodeLabel key={n.id} node={n} left={n.x0 === minX} palette={p} />
      ))}
    </g>
  )
}

function NodeLabel({ node: n, left, palette: p }: { node: SankeyNodeDatum<N, L>; left: boolean; palette: Palette }) {
  return (
    <text
      x={left ? n.x0 - 8 : n.x1 + 6}
      y={(n.y0 + n.y1) / 2}
      textAnchor={left ? 'end' : 'start'}
      dominantBaseline="central"
      fill={p.text}
      stroke={p.page}
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={{ pointerEvents: 'none' }}
    >
      {n.name}
      {n.note && (
        <tspan fill={p.muted} dx={6}>
          {n.note}
        </tspan>
      )}
      {n.kind !== 'unit' ? (
        <tspan fill={p.muted} dx={6}>
          {n.value}
        </tspan>
      ) : null}
    </text>
  )
}

