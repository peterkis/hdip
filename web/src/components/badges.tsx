import { Badge } from '@/components/ui/badge'
import {
  CHANGE_STATUS,
  DEPARTMENT_STATUS,
  OPERATING_STATUS,
  UNIT_STATUS,
  type ChangeStatus,
  type DepartmentStatus,
  type OperatingStatus,
  type UnitStatus,
} from '@/lib/format'

export function OperatingStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'RUNNING' ? 'default' : status === 'SUSPENDED' ? 'destructive' : status === 'TRIAL_RUNNING' ? 'secondary' : 'outline'
  return <Badge variant={variant}>{OPERATING_STATUS[status as OperatingStatus] ?? status}</Badge>
}

export function ChangeStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'confirmed'
      ? 'default'
      : status === 'submitted'
        ? 'secondary'
        : status === 'returned'
          ? 'destructive'
          : 'outline'
  return <Badge variant={variant}>{CHANGE_STATUS[status as ChangeStatus] ?? status}</Badge>
}

export function UnitStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>{UNIT_STATUS[status as UnitStatus] ?? status}</Badge>
  )
}

export function DepartmentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'outline' : 'destructive'}>
      {DEPARTMENT_STATUS[status as DepartmentStatus] ?? status}
    </Badge>
  )
}
