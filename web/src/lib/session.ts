// 开发期身份：当前用户名存在浏览器里，请求头 X-HDIP-User 带给后端。
// 认证方案确定后（设计文档第 12 节）只替换这里和后端 core/auth.py。
import { useSyncExternalStore } from 'react'

const KEY = 'hdip.user'
const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? 'solo'
  } catch {
    return 'solo'
  }
}

let current = read()

export function getCurrentUsername(): string {
  return current
}

export function setCurrentUsername(username: string) {
  current = username
  try {
    localStorage.setItem(KEY, username)
  } catch {
    // 无痕模式等情况下存不住，只在本次页面内有效
  }
  listeners.forEach((l) => l())
}

export function useCurrentUsername(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
