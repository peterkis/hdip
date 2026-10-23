// 业务状态 → 标签色。全应用统一从这里取，保证同一状态在任何页面颜色一致。
// 颜色含义（2026-10-21 Peter）：浅黄 = 计划（尚未开始、已经定了：计划中、筹建、筹备），橙 = 暂停，
// 绿 = 在用 / 生效，红 = 停用 / 撤销，灰 = 已结束，蓝 = 进行中。
import type { Tone } from '@/components/kit/tag'

/** 尚未生效的计划对象（“计划中”“某日 起”）：浅黄，表示“还没开始、已经定了”（2026-10-21 Peter） */
export const PLANNED_TONE: Tone = 'yellow'

/** 院区运营状态：筹建 → 试运行 → 运行 → 停用 */
export const OPERATING_STATUS_TONE: Record<string, Tone> = {
  PLANNING: PLANNED_TONE,
  TRIAL_RUNNING: 'blue',
  RUNNING: 'green',
  SUSPENDED: 'red',
}

/** 服务单元状态；“已退出”不是版本状态，由最后有效日推出 */
export const UNIT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  SUSPENDED: 'orange',
  RETIRED: 'gray',
}

/** 部门组织生命周期（被替代为拆并预留） */
export const DEPARTMENT_LIFECYCLE_TONE: Record<string, Tone> = {
  PREPARING: PLANNED_TONE,
  ACTIVE: 'green',
  SUSPENDED: 'orange',
  REVOKED: 'red',
  SUPERSEDED: 'brown',
}

/** 部门管理关系类型 */
export const DEPT_RELATION_TONE: Record<string, Tone> = {
  PROFESSIONAL_MGMT: 'blue',
  COLLABORATION: 'green',
  CAMPUS_MGMT: 'purple',
}

/** 部门管理主分类：分类是维度不是状态，用不同颜色便于区分，含义不分好坏 */
export const MAIN_CLASS_TONE: Record<string, Tone> = {
  CLINICAL: 'blue',
  MEDTECH: 'purple',
  SUPPORT: 'pink',
  ADMIN: 'brown',
  OPERATIONS: 'gray',
  RESEARCH_EDU: 'orange',
}

/** 变更申请状态 */
export const CHANGE_STATUS_TONE: Record<string, Tone> = {
  draft: 'gray',
  submitted: 'blue',
  confirmed: 'green',
  returned: 'orange',
  cancelled: 'gray',
}

/** 演变关系类型 */
export const LINEAGE_TONE: Record<string, Tone> = {
  SPLIT: 'purple',
  MERGE: 'pink',
}

/** 外部代码状态：待裁决需要处理，用黄色提示 */
export const CODE_STATUS_TONE: Record<string, Tone> = {
  pending: 'yellow',
  mapped: 'green',
  unmodeled: 'gray',
}

/** 部门层级（行政视图）：层级是维度不是状态，不用绿 / 黄 / 红 / 棕（已表示生命周期）；四级及以下同色 */
export const LEVEL_TONE: Record<number, Tone> = { 1: 'blue', 2: 'orange', 3: 'purple' }
export const levelTone = (level: number): Tone => LEVEL_TONE[level] ?? 'pink'

/** 统计图的颜色：标签色之外多一个青色（令牌 --hd-chart-<色>） */
export type ChartTone = Tone | 'teal'

// 统计图的分类配色：相邻两色须过色盲区分度校验（dataviz 校验脚本），所以不直接沿用标签色
//（标签色里蓝、紫相邻，绿色弱下几乎分不开）。图上每个节点都有名称标签，颜色不是唯一线索。

/** 院区：按代码排序后依次取色 */
export const CAMPUS_CHART_TONES: ChartTone[] = ['blue', 'orange', 'purple', 'pink', 'green', 'brown']

/** 部门管理主分类（图上用；标签仍用 MAIN_CLASS_TONE）；未分类为中性灰 */
export const MAIN_CLASS_CHART_TONE: Record<string, ChartTone> = {
  CLINICAL: 'blue',
  MEDTECH: 'orange',
  SUPPORT: 'purple',
  ADMIN: 'pink',
  OPERATIONS: 'green',
  RESEARCH_EDU: 'brown',
}

/** 编码治理图的解释状态：已对应的用蓝 / 绿 / 紫，未建模灰，待裁决橙 */
export const CODE_BREAKDOWN_TONE: Record<string, ChartTone> = {
  department: 'blue',
  service_unit: 'green',
  mixed: 'purple',
  unmodeled: 'gray',
  pending: 'orange',
}

/**
 * 任用类型：八种各用一色，按含义取色（2026-10-23 Peter：每种类型单独着色）。
 * 这一列表示“哪种用工形式”，不表示状态好坏（同部门主分类 MAIN_CLASS_TONE）；不用红、灰，免得像“停用 / 已结束”。
 * 两种主题下正文对比都 ≥ 6:1，相邻两色的底色或正文色差都清楚可辨（2026-10-23 按 tokens.css 计算）。
 */
export const ENGAGEMENT_TYPE_TONE: Record<string, Tone> = {
  STAFF: 'blue', // 在编：正式编制，最稳定
  CONTRACT: 'teal', // 合同（人事代理）：同为医院直接用工，与在编相邻的青色
  DISPATCH: 'brown', // 劳务派遣：由第三方单位用工，中性的大地色
  REHIRE: 'orange', // 退休返聘：资深、经验，暖色
  EXTERNAL: 'purple', // 外聘专家：专业与声望
  RESIDENT: 'green', // 规培：规范化培养中，成长
  VISITING: 'yellow', // 进修：短期来院学习，明亮、临时
  INTERN: 'pink', // 实习：学生，最年轻
}
