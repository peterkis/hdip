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

// INACTIVE 之外的两个为部门拆分合并预留，MVP 不会出现
export const DEPARTMENT_STATUS = {
  ACTIVE: '在用',
  INACTIVE: '停用',
  DEPRECATED: '弃用',
  SUPERSEDED: '被替代',
} as const
export type DepartmentStatus = keyof typeof DEPARTMENT_STATUS

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
  node_role: '节点角色',
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
  affected_units: '仍挂在该部门下的单元（只提示，不处置）',
}

/** 选项表里的码值名称，按字段名索引：{ node_role: {HIGH_TECH: '高新院区'}, unit_type: {...} } */
export type OptionLabels = Record<string, Record<string, string>>

/** 今天（浏览器本地日期），YYYY-MM-DD。 */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/** 期间显示：闭区间，结束为空即长期有效。 */
export function period(from: string, to: string | null | undefined): string {
  return `${from} ~ ${to ?? '长期'}`
}

/** 不带时区的时间戳，原样显示到分钟。 */
export function stamp(value: string | null | undefined): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—'
}

export function formatValue(field: string, value: unknown, labels: OptionLabels = {}): string {
  if (field === 'valid_to' && value === null) return '长期'
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'operating_status') return OPERATING_STATUS[value as OperatingStatus] ?? String(value)
  if (field === 'relation_type') return RELATION_TYPE[value as RelationType] ?? String(value)
  if (field === 'status') return UNIT_STATUS[value as UnitStatus] ?? String(value)
  if (field === 'department_status') return DEPARTMENT_STATUS[value as DepartmentStatus] ?? String(value)
  if (labels[field]) return labels[field][value as string] ?? String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}
