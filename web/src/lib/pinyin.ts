// 拼音码：名称的拼音首字母（大写字母与数字），检索用、不唯一（迁移 0015）。
// 汉字按词语读音取首字母（“银行”取 YH）；字母数字原样大写；括号等其他字符丢弃。
// 多音字（几个读音的首字母不同）逐个列出供核对，不阻止保存。后端未收到拼音码时用 pypinyin 按同一规则生成。
import { pinyin, polyphonic } from 'pinyin-pro'

export const PINYIN_RE = /^[A-Z0-9]{1,64}$/

const OPTS = { pattern: 'first', toneType: 'none', type: 'array' } as const

/**
 * 固定读音：院内名称里只按这个首字母取，不再提示多音字（如“区”固定取 Q，不取姓氏读音 ōu 的 O；
 * 2026-10-19 Peter 决定）。要再加字，在这里加一行。
 */
const FIXED: Record<string, string> = {
  区: 'Q',
}

/**
 * 拼音码的两种用法：组织名称（院区、部门、服务单元，“区”固定取 Q）；
 * 人名（首字按姓氏读音：单 S、曾 Z、解 X、仇 Q、区 O，FIXED 不适用；人员设计第 7.2 节）。
 */
export type PinyinMode = 'org' | 'person'

const optsFor = (mode: PinyinMode) => (mode === 'person' ? ({ ...OPTS, surname: 'head' } as const) : OPTS)

/** 名称 → 拼音码 */
export function pinyinCode(name: string, mode: PinyinMode = 'org'): string {
  const text = name.trim()
  const chars = [...text]
  return pinyin(text, optsFor(mode))
    .map((x, i) => (mode === 'org' ? (FIXED[chars[i]] ?? x) : x))
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
export function polyphones(name: string, mode: PinyinMode = 'org'): Polyphone[] {
  const text = name.trim()
  const chosen = pinyin(text, optsFor(mode))
  const all = polyphonic(text, OPTS)
  const out: Polyphone[] = []
  ;[...text].forEach((char, i) => {
    if (mode === 'org' && FIXED[char]) return
    const letters = [...new Set((all[i] ?? []).map((x) => x.toUpperCase()))].filter((x) => /^[A-Z]$/.test(x))
    if (letters.length > 1) out.push({ char, letters, chosen: (chosen[i] ?? '').toUpperCase() })
  })
  return out
}
