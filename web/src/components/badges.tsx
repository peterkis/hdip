// 业务状态标签：统一用 Tag，颜色取 lib/tones.ts，任何页面同一状态同一颜色。
import { Tag } from '@/components/kit/tag'
import {
  CHANGE_STATUS,
  OPERATING_STATUS,
  UNIT_STATUS,
  type ChangeStatus,
  type OperatingStatus,
  type UnitStatus,
} from '@/lib/format'
import { CHANGE_STATUS_TONE, OPERATING_STATUS_TONE, UNIT_STATUS_TONE } from '@/lib/tones'

export function OperatingStatusBadge({ status }: { status: string }) {
  return <Tag tone={OPERATING_STATUS_TONE[status] ?? 'gray'}>{OPERATING_STATUS[status as OperatingStatus] ?? status}</Tag>
}

export function ChangeStatusBadge({ status }: { status: string }) {
  return <Tag tone={CHANGE_STATUS_TONE[status] ?? 'gray'}>{CHANGE_STATUS[status as ChangeStatus] ?? status}</Tag>
}

export function UnitStatusBadge({ status }: { status: string }) {
  return <Tag tone={UNIT_STATUS_TONE[status] ?? 'gray'}>{UNIT_STATUS[status as UnitStatus] ?? status}</Tag>
}
