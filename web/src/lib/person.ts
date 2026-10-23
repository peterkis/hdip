// 人员模块的码值名称与标签色（人员设计第 3、5 节）。状态由查看日期的任用派生，不存储。
import type { Tone } from '@/components/kit/tag'
import { PLANNED_TONE } from '@/lib/tones'

export const PERSON_STATUS: Record<string, string> = {
  ENGAGED: '有效任用',
  PLANNED: '计划中',
  NONE: '无效任用',
}

export const PERSON_STATUS_TONE: Record<string, Tone> = {
  ENGAGED: 'green',
  PLANNED: PLANNED_TONE,
  NONE: 'gray',
}

export const NAME_REASON: Record<string, string> = {
  INITIAL: '登记',
  RENAME: '更名',
  CORRECTION: '更正误录',
}

export const WORK_NO_REASON: Record<string, string> = {
  INITIAL: '登记',
  CHANGE: '换号',
  CORRECTION: '更正误录',
}

interface Assignment {
  kind: string
  void: boolean
  valid_from: string
  valid_to?: string | null
}

/**
 * 某日的主部门归属：只取当天有效、kind = PRIMARY 的一条；附加归属不算主部门。
 * 没有时为 undefined（暂未分配）——即使当天有附加归属（2026-10-23 收尾）。
 */
export function primaryOn<A extends Assignment>(assignments: A[], day: string): A | undefined {
  return assignments.find(
    (a) => a.kind === 'PRIMARY' && !a.void && a.valid_from <= day && (!a.valid_to || a.valid_to >= day),
  )
}
