// orval 生成的请求统一走这里：同源 /api（开发时由 Vite 代理到 FastAPI）。
// 日期一律是 YYYY-MM-DD 字符串，时间戳是不带时区的 ISO 字符串，原样传递与显示，不做时区转换。
import { getCurrentUsername } from '@/lib/session'

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** 从后端错误体里取出可读的中文信息：业务错误 {message, problems}，参数校验 {detail: [...]}。 */
function readMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; detail?: unknown }
    if (typeof b.message === 'string') return b.message
    if (Array.isArray(b.detail)) {
      return b.detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const where = (d.loc ?? []).filter((x) => x !== 'body').join('.')
          return where ? `${where}：${d.msg}` : d.msg
        })
        .join('；')
    }
    if (typeof b.detail === 'string') return b.detail
  }
  return `请求失败（${status}）`
}

export const hdipFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const username = getCurrentUsername()
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(username ? { 'X-HDIP-User': username } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, body, readMessage(res.status, body))
  return body as T
}
