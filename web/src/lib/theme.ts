// 主题切换：只在 <html> 上切 .dark 与 data-accent，令牌层（styles/tokens.css）完成其余一切。
// 记在浏览器本地，刷新后保持。
import { useSyncExternalStore } from 'react'

export type Mode = 'light' | 'dark'
export type Accent = 'blue' | 'purple' | 'teal'

interface Theme {
  mode: Mode
  accent: Accent
}

const KEY = 'hdip.theme'
const listeners = new Set<() => void>()
let current: Theme = read()

function read(): Theme {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Theme>
    return { mode: v.mode === 'dark' ? 'dark' : 'light', accent: v.accent ?? 'blue' }
  } catch {
    return { mode: 'light', accent: 'blue' }
  }
}

function apply(t: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', t.mode === 'dark')
  if (t.accent === 'blue') root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', t.accent)
}

/** 应用启动时调用一次 */
export function initTheme() {
  apply(current)
}

export function setTheme(patch: Partial<Theme>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* 本地存储不可用时只在本次会话生效 */
  }
  apply(current)
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
