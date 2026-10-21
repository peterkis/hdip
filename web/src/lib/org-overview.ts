// 组织总览的聚合：服务布局桑基图、部门 × 院区矩阵、点选清单、概况计数都从这里算出，
// 同一份筛选结果出四种输出，数字才一致。纯函数，不发请求。
import type { CampusRow, DepartmentRow, ServiceUnitRow, SourceSystemOut } from '@/api/generated/model'
import { levelName } from '@/lib/format'
import { CAMPUS_CHART_TONES, CODE_BREAKDOWN_TONE, MAIN_CLASS_CHART_TONE, type ChartTone } from '@/lib/tones'

/** 部门管理主分类的显示顺序（方案里的顺序）；没有主分类的归“未分类”，排最后 */
export const CLASS_ORDER = ['CLINICAL', 'MEDTECH', 'SUPPORT', 'ADMIN', 'OPERATIONS', 'RESEARCH_EDU']
export const NO_CLASS = 'NONE'

/** 地址栏里的筛选条件；空串 = 不筛 */
export interface Scope {
  inst: string
  campus: string
  cls: string
  type: string
  /** 部门（含其下级部门） */
  dept: string
  /** 含计划中的单元（查看日期之后才开始） */
  planned: boolean
  /** 含暂停的单元 */
  suspended: boolean
}

// ------------------------------------------------------------------ 部门树

export interface DeptIndex {
  byId: Map<number, DepartmentRow>
  /** 一级部门 → 本部门的隶属链 */
  chain: (id: number) => DepartmentRow[]
  /** 按一级部门的主分类 */
  classOf: (id: number) => string
  /** 树的先序顺序（主分类 → 代码），用于排序 */
  order: Map<number, number>
}

export function indexDepartments(departments: DepartmentRow[]): DeptIndex {
  const byId = new Map(departments.map((d) => [d.id, d]))
  const chain = (id: number): DepartmentRow[] => {
    const out: DepartmentRow[] = []
    const seen = new Set<number>()
    let d = byId.get(id)
    while (d && !seen.has(d.id)) {
      seen.add(d.id)
      out.unshift(d)
      d = d.parent ? byId.get(d.parent.id) : undefined
    }
    return out
  }
  const classOf = (id: number) => chain(id)[0]?.main_class?.code ?? NO_CLASS
  const children = new Map<number | null, DepartmentRow[]>()
  for (const d of departments) {
    const p = d.parent && byId.has(d.parent.id) ? d.parent.id : null
    children.set(p, [...(children.get(p) ?? []), d])
  }
  const rank = (code: string) => {
    const i = CLASS_ORDER.indexOf(code)
    return i < 0 ? CLASS_ORDER.length : i
  }
  const order = new Map<number, number>()
  const byCode = (a: DepartmentRow, b: DepartmentRow) => a.code.localeCompare(b.code)
  const visit = (list: DepartmentRow[]) => {
    for (const d of list) {
      order.set(d.id, order.size)
      visit([...(children.get(d.id) ?? [])].sort(byCode))
    }
  }
  const roots = children.get(null) ?? []
  visit([...roots].sort((a, b) => rank(classOf(a.id)) - rank(classOf(b.id)) || byCode(a, b)))
  return { byId, chain, classOf, order }
}

// ------------------------------------------------------------------ 范围与概况

const isPlanned = (u: ServiceUnitRow) => u.not_yet_effective
const isSuspended = (u: ServiceUnitRow) => !u.not_yet_effective && u.version.status === 'SUSPENDED'

export function unitsInScope(units: ServiceUnitRow[], idx: DeptIndex, s: Scope): ServiceUnitRow[] {
  return units
    .filter((u) => {
      const v = u.version
      if (isPlanned(u) && !s.planned) return false
      if (isSuspended(u) && !s.suspended) return false
      if (s.inst && String(v.institution_id) !== s.inst) return false
      if (s.campus && String(v.campus_id) !== s.campus) return false
      if (s.type && u.unit_type !== s.type) return false
      if (s.cls && idx.classOf(v.department_id) !== s.cls) return false
      if (s.dept && !idx.chain(v.department_id).some((d) => String(d.id) === s.dept)) return false
      return true
    })
    .sort((a, b) => unitOrder(idx, a, b))
}

function unitOrder(idx: DeptIndex, a: ServiceUnitRow, b: ServiceUnitRow) {
  return (
    (idx.order.get(a.version.department_id) ?? 0) - (idx.order.get(b.version.department_id) ?? 0) ||
    a.version.campus_code.localeCompare(b.version.campus_code) ||
    a.code.localeCompare(b.code)
  )
}

export interface Summary {
  /** 查看日期当天正式履职的部门 */
  activeDepts: number
  /** 当天在用（已生效、状态在用） */
  active: number
  suspended: number
  planned: number
  /** 当天在两个及以上院区有在运营单元（含暂停）的部门 */
  crossCampus: DepartmentRow[]
  /** 正式履职、当天没有在运营单元的部门（行政、职能部门多半如此，不是遗漏） */
  idle: DepartmentRow[]
}

/** 全院概况：只随查看日期变化，不受图内筛选影响 */
export function summarize(units: ServiceUnitRow[], departments: DepartmentRow[]): Summary {
  const current = units.filter((u) => !u.not_yet_effective)
  const campusesOf = new Map<number, Set<number>>()
  for (const u of current) {
    const set = campusesOf.get(u.version.department_id) ?? new Set()
    set.add(u.version.campus_id)
    campusesOf.set(u.version.department_id, set)
  }
  const active = departments.filter((d) => !d.not_yet_effective && d.version.lifecycle === 'ACTIVE')
  return {
    activeDepts: active.length,
    active: current.filter((u) => u.version.status === 'ACTIVE').length,
    suspended: current.filter((u) => u.version.status === 'SUSPENDED').length,
    planned: units.filter(isPlanned).length,
    crossCampus: departments.filter((d) => (campusesOf.get(d.id)?.size ?? 0) >= 2),
    idle: active.filter((d) => !campusesOf.has(d.id)),
  }
}

// ------------------------------------------------------------------ 桑基图

export type FlowKind = 'class' | 'campus' | 'dept' | 'unit' | 'system' | 'namespace' | 'status'

export interface FlowNode {
  id: string
  kind: FlowKind
  /** 显示名称（不叫 label：nivo 会用自己的 label 覆盖） */
  name: string
  /** 名称后的弱化说明（院区、计划、上级部门） */
  note?: string
  /** 所在列的标题 */
  column: string
  tone: ChartTone | 'neutral'
}

export interface FlowLink {
  source: string
  target: string
  value: number
  tone: ChartTone | 'neutral'
}

export interface Flow {
  nodes: FlowNode[]
  links: FlowLink[]
  /** 节点、连带背后的服务单元（服务布局图）；键为节点 id 或“源>目标” */
  units: Map<string, ServiceUnitRow[]>
}

export const linkKey = (source: string, target: string) => `${source}>${target}`

class FlowBuilder {
  nodes = new Map<string, FlowNode>()
  links = new Map<string, FlowLink>()
  units = new Map<string, ServiceUnitRow[]>()

  node(n: FlowNode, unit?: ServiceUnitRow) {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n)
    if (unit) this.units.set(n.id, [...(this.units.get(n.id) ?? []), unit])
  }

  link(source: string, target: string, tone: FlowLink['tone'], value = 1, unit?: ServiceUnitRow) {
    const key = linkKey(source, target)
    const l = this.links.get(key)
    if (l) l.value += value
    else this.links.set(key, { source, target, value, tone })
    if (unit) this.units.set(key, [...(this.units.get(key) ?? []), unit])
  }

  build(sortNodes?: (a: FlowNode, b: FlowNode) => number): Flow {
    const nodes = [...this.nodes.values()]
    if (sortNodes) nodes.sort(sortNodes)
    return { nodes, links: [...this.links.values()], units: this.units }
  }
}

export const campusShort = (name: string) => name.replace(/院区$/, '')

/**
 * 按分类：主分类 → 一级部门 → 二级部门 … → 服务单元。
 * 单元挂在它自己所属的部门上（不上卷）；部门节点的宽度是它及其下级部门的单元数。
 * 每个部门只有一个上级、每个一级部门只有一个主分类，所以整张图是树，多列也不会拼出不存在的路径。
 */
export function classFlow(units: ServiceUnitRow[], idx: DeptIndex, classNames: Map<string, string>): Flow {
  const f = new FlowBuilder()
  for (const u of units) {
    const chain = idx.chain(u.version.department_id)
    if (chain.length === 0) continue
    const cls = idx.classOf(u.version.department_id)
    const tone = MAIN_CLASS_CHART_TONE[cls] ?? 'gray'
    const clsId = `cls:${cls}`
    f.node({ id: clsId, kind: 'class', name: classNames.get(cls) ?? '未分类', column: '主分类', tone }, u)
    let prev = clsId
    for (const d of chain) {
      const id = `d:${d.id}`
      f.node({ id, kind: 'dept', name: d.version.name, column: levelName(d.level), tone }, u)
      f.link(prev, id, tone, 1, u)
      prev = id
    }
    const uid = `u:${u.id}`
    const note = [campusShort(u.version.campus_name), u.not_yet_effective && `${u.version.valid_from} 起`, isSuspended(u) && '暂停']
      .filter(Boolean)
      .join(' · ')
    f.node({ id: uid, kind: 'unit', name: u.version.name, note, column: '服务单元', tone }, u)
    f.link(prev, uid, tone, 1, u)
  }
  return f.build()
}

/** 按院区：院区 → 单元所属的部门，只有两列（第三列会让不同院区的单元在部门节点处混在一起） */
export function campusFlow(units: ServiceUnitRow[], idx: DeptIndex, campuses: CampusRow[]): Flow {
  const tones = campusTones(campuses)
  const f = new FlowBuilder()
  for (const u of units) {
    const d = idx.byId.get(u.version.department_id)
    if (!d) continue
    const cid = `c:${u.version.campus_id}`
    const tone = tones.get(u.version.campus_id) ?? 'gray'
    f.node({ id: cid, kind: 'campus', name: u.version.campus_name, column: '院区', tone }, u)
    const did = `d:${d.id}`
    f.node({ id: did, kind: 'dept', name: d.version.name, note: d.parent?.name, column: '所属部门', tone: 'neutral' }, u)
    f.link(cid, did, tone, 1, u)
  }
  const campusRank = new Map(campuses.map((c) => [`c:${c.id}`, c.code]))
  return f.build((a, b) =>
    a.kind === 'campus' && b.kind === 'campus'
      ? (campusRank.get(a.id) ?? '').localeCompare(campusRank.get(b.id) ?? '')
      : a.kind === 'dept' && b.kind === 'dept'
        ? (idx.order.get(Number(a.id.slice(2))) ?? 0) - (idx.order.get(Number(b.id.slice(2))) ?? 0)
        : 0,
  )
}

export function campusTones(campuses: CampusRow[]): Map<number, ChartTone> {
  return new Map(
    [...campuses].sort((a, b) => a.code.localeCompare(b.code)).map((c, i) => [c.id, CAMPUS_CHART_TONES[i % CAMPUS_CHART_TONES.length]]),
  )
}

// ------------------------------------------------------------------ 编码治理图

/** 解释状态（与后端 NamespaceOut.breakdown 的键一致），按图上从上到下的顺序 */
export const BREAKDOWN = {
  department: '指向部门',
  service_unit: '指向服务单元',
  mixed: '部门与单元都有',
  unmodeled: '对象未建模',
  pending: '待裁决',
} as const
export type BreakdownKey = keyof typeof BREAKDOWN

/** 解释状态在编码映射台账里对应的筛选值 */
export const LEDGER_STATUS: Record<BreakdownKey, string> = {
  department: 'mapped',
  service_unit: 'mapped',
  mixed: 'mapped',
  unmodeled: 'unmodeled',
  pending: 'pending',
}

export interface Governance extends Flow {
  total: number
  counts: Record<BreakdownKey, number>
}

/** 来源系统 → 字典 → 解释状态。按源记录去重计数（一条源记录按院区条件有多条解释，只算一次） */
export function governanceFlow(systems: SourceSystemOut[]): Governance {
  const f = new FlowBuilder()
  const counts = Object.fromEntries(Object.keys(BREAKDOWN).map((k) => [k, 0])) as Record<BreakdownKey, number>
  let total = 0
  for (const sys of systems) {
    for (const ns of sys.namespaces) {
      if (ns.code_count === 0) continue
      const sid = `sys:${sys.id}`
      const nid = `ns:${ns.id}`
      f.node({ id: sid, kind: 'system', name: sys.name, column: '来源系统', tone: 'neutral' })
      f.node({ id: nid, kind: 'namespace', name: ns.name, column: '字典', tone: 'neutral' })
      f.link(sid, nid, 'neutral', ns.code_count)
      total += ns.code_count
      for (const key of Object.keys(BREAKDOWN) as BreakdownKey[]) {
        const n = ns.breakdown?.[key] ?? 0
        if (!n) continue
        counts[key] += n
        const tid = `st:${key}`
        f.node({ id: tid, kind: 'status', name: BREAKDOWN[key], column: '解释状态', tone: CODE_BREAKDOWN_TONE[key] })
        f.link(nid, tid, CODE_BREAKDOWN_TONE[key], n)
      }
    }
  }
  const order = (n: FlowNode) => (n.kind === 'status' ? Object.keys(BREAKDOWN).indexOf(n.id.slice(3)) : 0)
  return { ...f.build((a, b) => order(a) - order(b)), total, counts }
}

// ------------------------------------------------------------------ 部门 × 院区矩阵

export interface MatrixRow {
  dept: DepartmentRow
  /** 相对于矩阵里最上层的部门的缩进层级 */
  depth: number
  /** 院区 id → 该部门（本身，不含下级）在该院区的单元 */
  cells: Map<number, ServiceUnitRow[]>
}

/** 行 = 有单元的部门及其上级（按部门树排列），列 = 院区 */
export function matrixRows(units: ServiceUnitRow[], idx: DeptIndex): MatrixRow[] {
  const rows = new Map<number, MatrixRow>()
  for (const u of units) {
    const chain = idx.chain(u.version.department_id)
    chain.forEach((d, i) => {
      if (!rows.has(d.id)) rows.set(d.id, { dept: d, depth: i, cells: new Map() })
    })
    const row = rows.get(u.version.department_id)
    if (!row) continue
    row.cells.set(u.version.campus_id, [...(row.cells.get(u.version.campus_id) ?? []), u])
  }
  return [...rows.values()].sort((a, b) => (idx.order.get(a.dept.id) ?? 0) - (idx.order.get(b.dept.id) ?? 0))
}
