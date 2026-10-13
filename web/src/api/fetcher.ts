// orval 生成的请求统一走这里：同源 /api（开发时由 Vite 代理到 FastAPI）。
// 日期一律是 YYYY-MM-DD 字符串，时间戳是不带时区的 ISO 字符串，原样传递与显示，不做时区转换。

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`)
  }
}

export const hdipFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, body)
  return { data: body, status: res.status, headers: res.headers } as T
}
