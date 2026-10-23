// 任用类型标签：按任用一级类别着色（lib/tones.ts 的 ENGAGEMENT_TYPE_TONE），人员名册、详情、部门人员共用。
import { Tag } from '@/components/kit/tag'
import { useApp } from '@/lib/app-context'
import { ENGAGEMENT_TYPE_TONE } from '@/lib/tones'

export function EngagementTypeTag({ code }: { code: string }) {
  const { optionLabels } = useApp()
  return <Tag tone={ENGAGEMENT_TYPE_TONE[code] ?? 'gray'}>{optionLabels.engagement_type?.[code] ?? code}</Tag>
}
