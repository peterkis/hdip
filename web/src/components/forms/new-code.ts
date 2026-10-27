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

/** 占位符的槽位；不是占位符（已分配的真实代码）返回 -1 */
export function slotOf(code: string): number {
  const m = /^@@new:[a-z_]+:(\d+)@@$/.exec(code)
  return m ? Number(m[1]) : -1
}

export function isNewCode(code: string): boolean {
  return code.startsWith('@@new:')
}

/**
 * 占位符 → 预留位置的绑定，属于一次打开的表单（PR #2 复审 P2-B）。
 * 占位符里的编号是本次编辑的对象身份（可以稀疏、不复用）；取号用的是这里的预留位置：
 * 第一次保存时按出现顺序连续分配，之后只增不改——保留的对象重试拿回同一个号，删掉的对象占着的位置不会给别的对象，
 * 只在编辑中出现过、从未保存的对象不占位置。所以取号数量只随“参与过保存的对象”增长，不随编辑身份增长。
 */
export type CodeBinding = Map<string, number>

/** 变更项里有占位符时预留代码并替换；没有占位符原样返回。binding 不传 = 每次按出现顺序连续分配 */
export async function fillNewCodes<T>(items: T, requestKey: string, binding: CodeBinding = new Map()): Promise<T> {
  const json = JSON.stringify(items)
  const tokens = [...new Set([...json.matchAll(TOKEN)].map((m) => m[0]))]
  if (tokens.length === 0) return items
  const typeOf = (token: string) => token.split(':')[1] as CodeObject
  const need = new Map<CodeObject, number>()
  for (const token of tokens) {
    const type = typeOf(token)
    if (!binding.has(token)) {
      const used = [...binding].filter(([k]) => typeOf(k) === type).map(([, v]) => v)
      binding.set(token, Math.max(-1, ...used) + 1)
    }
    need.set(type, Math.max(need.get(type) ?? 0, binding.get(token)! + 1))
  }
  const codes = new Map<CodeObject, string[]>()
  for (const [type, count] of need) {
    const out = await reserveCodes({ object_type: type, request_key: requestKey, count })
    codes.set(type, out.codes)
  }
  return JSON.parse(json.replace(TOKEN, (token: string, type: CodeObject) => codes.get(type)![binding.get(token)!]))
}
