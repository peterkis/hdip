// 业务状态 → 标签色。全应用统一从这里取，保证同一状态在任何页面颜色一致。
import type { Tone } from '@/components/kit/tag'

/** 院区运营状态：筹建 → 试运行 → 运行 → 停用 */
export const OPERATING_STATUS_TONE: Record<string, Tone> = {
  PLANNING: 'gray',
  TRIAL_RUNNING: 'blue',
  RUNNING: 'green',
  SUSPENDED: 'red',
}

/** 服务单元状态；“已退出”不是版本状态，由最后有效日推出 */
export const UNIT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  SUSPENDED: 'yellow',
  RETIRED: 'gray',
}

/** 部门状态（弃用、被替代为预留） */
export const DEPARTMENT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green',
  INACTIVE: 'red',
  DEPRECATED: 'gray',
  SUPERSEDED: 'brown',
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
