// 新建对象的代码由系统分配（迁移 0015，后端 services/codes.py）：
// 表单拼变更项时先写占位符 newCode('department', 0)，同一表单里其他项（设置上级、挂单元）也引用这个占位符；
// 点“保存到申请”时，ItemDialog 按占位符向后端预留代码（同一次打开的表单用同一个请求键，重试拿回同一批号），
// 把占位符整体换成真实代码后再写入草稿。之后预演、提交、确认都用这个号。
import { reserveCodes } from '@/api/generated/changes/changes'
import type { ReserveBodyObjectType } from '@/api/generated/model'

export type CodeObject = ReserveBodyObjectType

export const CODE_RULE: Record<CodeObject, { prefix: string; width: number; label: string }> = {
  campus: { prefix: 'C', width: 3, label: '院区' },
  department: { prefix: 'D', width: 6, label: '部门' },
  service_unit: { prefix: 'SU', width: 6, label: '服务单元' },
  person: { prefix: 'P', width: 6, label: '人员' },
}

export function codeRuleText(type: CodeObject): string {
  const r = CODE_RULE[type]
  return `${r.prefix} 加 ${r.width} 位数字`
}

const TOKEN = /@@new:(campus|department|service_unit|person):(\d+)@@/g

/** 占位符：保存时换成系统分配的代码。slot 区分同一表单里的多个新对象 */
export function newCode(type: CodeObject, slot = 0): string {
  return `@@new:${type}:${slot}@@`
}

export function isNewCode(code: string): boolean {
  return code.startsWith('@@new:')
}

/** 变更项里有占位符时预留代码并替换；没有占位符原样返回 */
export async function fillNewCodes<T>(items: T, requestKey: string): Promise<T> {
  const json = JSON.stringify(items)
  const need = new Map<CodeObject, number>()
  for (const m of json.matchAll(TOKEN)) {
    const type = m[1] as CodeObject
    need.set(type, Math.max(need.get(type) ?? 0, Number(m[2]) + 1))
  }
  if (need.size === 0) return items
  const codes = new Map<CodeObject, string[]>()
  for (const [type, count] of need) {
    const out = await reserveCodes({ object_type: type, request_key: requestKey, count })
    codes.set(type, out.codes)
  }
  return JSON.parse(json.replace(TOKEN, (_, type: CodeObject, slot: string) => codes.get(type)![Number(slot)]))
}
