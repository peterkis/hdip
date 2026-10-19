// 拼音码：名称的拼音首字母（大写字母与数字），检索用、不唯一（迁移 0015）。
// 汉字按词语读音取首字母（“银行”取 YH）；字母数字原样大写；括号等其他字符丢弃。
// 多音字（几个读音的首字母不同）逐个列出供核对，不阻止保存。后端未收到拼音码时用 pypinyin 按同一规则生成。
import { pinyin, polyphonic } from 'pinyin-pro'

export const PINYIN_RE = /^[A-Z0-9]{1,64}$/

const OPTS = { pattern: 'first', toneType: 'none', type: 'array' } as const

/** 名称 → 拼音码 */
export function pinyinCode(name: string): string {
  return pinyin(name.trim(), OPTS)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 64)
}

export interface Polyphone {
  char: string
  /** 这个字可能的首字母（去重、大写） */
  letters: string[]
  /** 按词语读音取的首字母 */
  chosen: string
}

/** 名称里首字母有歧义的多音字（如“行”X / H、“重”Z / C） */
export function polyphones(name: string): Polyphone[] {
  const text = name.trim()
  const chosen = pinyin(text, OPTS)
  const all = polyphonic(text, OPTS)
  const out: Polyphone[] = []
  ;[...text].forEach((char, i) => {
    const letters = [...new Set((all[i] ?? []).map((x) => x.toUpperCase()))].filter((x) => /^[A-Z]$/.test(x))
    if (letters.length > 1) out.push({ char, letters, chosen: (chosen[i] ?? '').toUpperCase() })
  })
  return out
}
