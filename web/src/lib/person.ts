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
