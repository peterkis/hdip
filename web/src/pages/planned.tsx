// 规划中的主题域 / 条目：在侧栏占位，说明尚不在当前范围（设计文档第 1 节、CLAUDE.md“范围外”）。
import { useParams } from 'react-router'
import { Callout } from '@/components/kit/callout'
import { useCrumb } from '@/components/shell/crumbs'
import { findPlanned, NAV_GROUPS } from '@/components/shell/nav'
import { PageHeader, usePageFrame } from '@/components/layout'

export function PlannedPage() {
  usePageFrame('document')
  const key = useParams().key ?? ''
  const found = findPlanned(key)
  useCrumb(found ? null : '未知页面')
  if (!found) {
    return <PageHeader title="没有这个页面" description="请从左侧栏选择。" />
  }
  const { group, item } = found
  const siblings = item ? group.items.filter((i) => i !== item) : []
  return (
    <>
      <PageHeader title={item?.label ?? group.label} description={`${group.label} · 规划中`} />
      <Callout title="规划中，尚未纳入当前范围">
        {item?.note ??
          `这个${item ? '条目' : '主题域'}先在导航中占位，便于看清平台的整体结构。当前维护组织与关系（主体、院区、运营关系、部门、服务单元）与人员（名册、任用、部门归属、部门任职）；其余主题域在某条验收剧本需要时，再按同样的“变更申请 → 确认 → 版本”方式逐步引入。`}
      </Callout>
      {siblings.length > 0 && (
        <p className="text-fg-muted mt-4 text-xs">
          同属“{group.label}”的还有：{siblings.map((s) => s.label).join('、')}。
        </p>
      )}
      <p className="text-fg-muted mt-2 text-xs">
        已规划的主题域：{NAV_GROUPS.map((g) => g.label).join('、')}。
      </p>
    </>
  )
}
