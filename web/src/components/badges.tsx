import { Badge } from '@/components/ui/badge'
import { CHANGE_STATUS, OPERATING_STATUS, type ChangeStatus, type OperatingStatus } from '@/lib/format'

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
