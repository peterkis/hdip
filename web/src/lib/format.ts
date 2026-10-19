// 码值与字段的中文名称，以及日期显示。码值与后端 schemas/items.py 保持一致。

export const OPERATING_STATUS = {
  PLANNING: '筹建',
  TRIAL_RUNNING: '试运行',
  RUNNING: '运行',
  SUSPENDED: '停用',
} as const
export type OperatingStatus = keyof typeof OPERATING_STATUS
export const OPERATING_STATUS_ORDER: OperatingStatus[] = [
  'PLANNING',
  'TRIAL_RUNNING',
  'RUNNING',
  'SUSPENDED',
]

export const RELATION_TYPE = {
  OPERATE: '运营',
  REGISTER: '登记',
  MANAGE: '管理',
  CHARGE: '收费',
} as const
export type RelationType = keyof typeof RELATION_TYPE

export const UNIT_STATUS = {
  ACTIVE: '在用',
  SUSPENDED: '暂停',
} as const
export type UnitStatus = keyof typeof UNIT_STATUS

// 部门组织生命周期：筹备 → 正式履职 ⇄ 暂停履职 → 撤销；被替代留给部门拆并
export const DEPARTMENT_LIFECYCLE = {
  PREPARING: '筹备',
  ACTIVE: '正式履职',
  SUSPENDED: '暂停履职',
  REVOKED: '撤销',
  SUPERSEDED: '被替代',
} as const
export type DepartmentLifecycle = keyof typeof DEPARTMENT_LIFECYCLE
/** 从当前生命周期可以变到哪些（与后端 LIFECYCLE_NEXT 一致） */
export const LIFECYCLE_NEXT: Record<DepartmentLifecycle, DepartmentLifecycle[]> = {
  PREPARING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
  SUPERSEDED: [],
}

export const DEPT_RELATION = {
  PROFESSIONAL_MGMT: '专业管理',
  COLLABORATION: '协作',
  CAMPUS_MGMT: '院区管理',
} as const
export type DeptRelationKind = keyof typeof DEPT_RELATION

/** 行政视图中的组织层级 */
export function levelName(level: number): string {
  return ['', '一级部门', '二级部门', '三级部门', '四级部门'][level] ?? `${level} 级部门`
}

/** 层级短名（关系图卡片角标用）：一级、二级… */
export function levelShort(level: number): string {
  return ['', '一级', '二级', '三级', '四级'][level] ?? `${level} 级`
}

export const ESTABLISHMENT_FORM = {
  STANDING: '常设部门',
  TEMPORARY: '经批准的临时部门',
} as const
export type EstablishmentForm = keyof typeof ESTABLISHMENT_FORM

/** 外部代码的解释指向“对象未建模”时的对象类别（设计 D3） */
export const UNMODELED_TYPE = {
  NURSING_UNIT: '护理单元',
  WARD: '病区',
  LOCATION: '地点',
  STAT_GROUP: '统计分组',
  COMPOSITE: '旧系统复合记录',
  OTHER: '其他',
} as const
export type UnmodeledType = keyof typeof UNMODELED_TYPE

/** 外部代码在查看日期的状态：没有任何解释即待裁决 */
export const CODE_STATUS = {
  pending: '待裁决',
  mapped: '已映射',
  unmodeled: '对象未建模',
} as const
export type CodeStatus = keyof typeof CODE_STATUS

export const TARGET_TYPE = {
  department: '部门',
  service_unit: '服务单元',
  unmodeled: '对象未建模',
} as const
export type TargetType = keyof typeof TARGET_TYPE

export const SOURCE_KIND = {
  HIS: 'HIS',
  MEDICAL_RECORD: '病案系统',
  INTEROP: '互联互通',
  OTHER: '其他',
} as const

export const CHANGE_STATUS = {
  draft: '草稿',
  submitted: '已提交',
  confirmed: '已确认',
  returned: '已退回',
  cancelled: '已撤销',
} as const
export type ChangeStatus = keyof typeof CHANGE_STATUS

export const FIELD_LABELS: Record<string, string> = {
  version_no: '版本',
  valid_from: '生效起',
  valid_to: '生效止',
  name: '名称',
  nature: '主体性质',
  unified_credit_code: '统一社会信用代码',
  medical_reg_code: '医疗机构登记代码',
  license_no: '执业许可证号',
  license_valid_from: '许可证有效期起',
  license_valid_to: '许可证有效期止',
  node_role: '节点角色（已停用）',
  public_name: '对外名称',
  address: '地址',
  admin_division_code: '行政区划代码',
  phone: '电话',
  actual_open_date: '实际启用日期',
  operating_status: '运营状态',
  id: '关系编号',
  relation_type: '关系类型',
  is_primary: '主要运营方',
  code: '代码',
  unit_type: '单元类型',
  department: '所属部门',
  department_name: '所属部门',
  campus: '院区',
  campus_name: '院区',
  institution: '运营主体',
  institution_name: '运营主体',
  status: '单元状态',
  scope_note: '范围说明',
  department_status: '部门状态',
  department_lifecycle: '部门生命周期',
  short_name: '简称',
  description: '职责说明',
  establishment_form: '设立形式',
  temporary_until: '临时部门期限',
  lifecycle: '组织生命周期',
  admin_grade: '行政级别',
  duties: '承担职责',
  basis_note: '依据',
  affiliation: '主体归属',
  class_code: '分类代码',
  class_name: '分类',
  alias_kind: '别名类别',
  value: '别名',
  parent: '直接上级',
  relation_kind: '关系类型',
  from_department: '管理方 / 协作一方',
  to_department: '对象部门',
  scope: '事项 / 范围',
  ended_links: '同时结束',
  source_name: '源名称',
  semantic_note: '含义说明',
  assignment_id: '解释编号',
  target: '指向',
  evidence_note: '判定说明',
}

/** 选项表里的码值名称，按字段名索引：{ node_role: {HIGH_TECH: '高新院区'}, unit_type: {...} } */
export type OptionLabels = Record<string, Record<string, string>>

/** 今天（浏览器本地日期），YYYY-MM-DD。 */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/** 期间显示：闭区间，结束为空即长期有效。 */
export function period(from: string, to: string | null | undefined): string {
  // 结束日早于开始日 = 生效前已被更正的版本，从未生效
  if (to && to < from) return `${from} 起（生效前已更正，未生效）`
  return `${from} ~ ${to ?? '长期'}`
}

/** 不带时区的时间戳，原样显示到分钟。 */
export function stamp(value: string | null | undefined): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—'
}

export function formatValue(field: string, value: unknown, labels: OptionLabels = {}): string {
  if (field === 'valid_to' && value === null) return '长期'
  if (field === 'parent' && value === null) return '无（一级部门）'
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'operating_status') return OPERATING_STATUS[value as OperatingStatus] ?? String(value)
  if (field === 'relation_type') return RELATION_TYPE[value as RelationType] ?? String(value)
  if (field === 'status') return UNIT_STATUS[value as UnitStatus] ?? String(value)
  if (field === 'lifecycle' || field === 'department_lifecycle')
    return DEPARTMENT_LIFECYCLE[value as DepartmentLifecycle] ?? String(value)
  if (field === 'establishment_form') return ESTABLISHMENT_FORM[value as EstablishmentForm] ?? String(value)
  if (field === 'alias_kind') return value === 'SEARCH_CODE' ? '检索码' : '别名'
  if (field === 'relation_kind') return DEPT_RELATION[value as DeptRelationKind] ?? String(value)
  if (Array.isArray(value)) return value.length ? value.join('、') : '—'
  if (labels[field]) return labels[field][value as string] ?? String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}
