// 侧栏导航配置：按业务主题域分组。新增主题域 = 在 NAV_GROUPS 里加一组，不改外壳代码。
// planned = 规划中（不在当前 MVP 范围，设计文档第 1 节），进入统一的“规划中”页面。
import {
  Briefcase01Icon,
  Building03Icon,
  Certificate01Icon,
  DashboardSquare02Icon,
  Database01Icon,
  FileEditIcon,
  FolderLibraryIcon,
  GridViewIcon,
  Hospital01Icon,
  IdentityCardIcon,
  Link04Icon,
  Location01Icon,
  Stethoscope02Icon,
  Tag01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { Blocks } from 'lucide-react'
import type { AppIcon } from '@/components/kit/icon'

export interface NavItem {
  label: string
  icon: AppIcon
  /** 已实现的页面路径；规划中的条目为空 */
  to?: string
  /** 规划中条目的标识，对应 /planned/:key */
  planned?: string
  /** 需要的权限键（/api/me 的 permissions）；没有时侧栏不显示这一项 */
  permission?: string
}

export interface NavGroup {
  key: string
  label: string
  icon: AppIcon
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'org',
    label: '组织与关系',
    icon: Hospital01Icon,
    items: [
      { label: '组织总览', icon: DashboardSquare02Icon, to: '/organization-overview' },
      { label: '主体', icon: Hospital01Icon, to: '/institutions' },
      { label: '部门', icon: UserGroupIcon, to: '/departments' },
      { label: '院区', icon: Building03Icon, to: '/campuses' },
      { label: '服务单元', icon: GridViewIcon, to: '/service-units' },
    ],
  },
  {
    key: 'space',
    label: '空间与场所',
    icon: Location01Icon,
    items: [],
  },
  {
    key: 'people',
    label: '人员、资质与任职',
    icon: IdentityCardIcon,
    items: [
      // 人员、任用、部门归属（人员模块 P1，docs/HDIP 轻量人员模块设计…）
      { label: '人员名册', icon: IdentityCardIcon, to: '/persons', permission: 'person.view' },
      { label: '岗位与任职', icon: Briefcase01Icon, planned: 'position-appointment' },
      { label: '执业资质', icon: Certificate01Icon, planned: 'practice-qualification' },
      { label: '临床授权', icon: Stethoscope02Icon, planned: 'clinical-privilege' },
    ],
  },
  {
    key: 'standards',
    label: '标准与数据集',
    icon: Database01Icon,
    items: [
      { label: '分类方案', icon: Tag01Icon, to: '/dictionary/classification' },
      { label: '编码映射台账', icon: Link04Icon, to: '/standards/code-mapping' },
      { label: '标准数据集', icon: Database01Icon, planned: 'standard-datasets' },
      { label: '数据元', icon: Blocks, planned: 'data-elements' },
      { label: '数据目录', icon: FolderLibraryIcon, planned: 'data-catalog' },
    ],
  },
  {
    key: 'governance',
    label: '治理',
    icon: FileEditIcon,
    items: [{ label: '变更申请', icon: FileEditIcon, to: '/changes' }],
  },
]

export function itemPath(item: NavItem): string {
  return item.to ?? `/planned/${item.planned}`
}

/** 当前路径对应的分组与条目（用于面包屑）；没有条目的分组本身也可作为规划中页面 */
export function findNav(pathname: string): { group: NavGroup; item?: NavItem } | null {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => pathname === itemPath(i) || pathname.startsWith(`${itemPath(i)}/`))
    if (item) return { group, item }
    if (pathname === `/planned/${group.key}`) return { group }
  }
  return null
}

/** 规划中页面的标题：条目或整个分组 */
export function findPlanned(key: string): { group: NavGroup; item?: NavItem } | null {
  for (const group of NAV_GROUPS) {
    if (group.key === key && group.items.length === 0) return { group }
    const item = group.items.find((i) => i.planned === key)
    if (item) return { group, item }
  }
  return null
}
