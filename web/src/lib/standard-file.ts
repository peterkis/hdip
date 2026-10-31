// 读取标准原文（docs/标准资料库-目录与原文实施计划.md 第 5 节）。
// 开发期身份在请求头里，浏览器直接打开接口地址带不上它，所以先取回文件、生成 blob: 地址，
// 由应用内的原文页用内嵌框显示；PDF 跳页用 #page=N（Chromium、Safari 内置阅读器都支持）。
// 不弹新窗口：异步取回后再开窗口会被拦截，部分内嵌浏览器也不允许顶层打开 blob: 地址。
// S0 认证改为 Cookie 后可换成直接链接。不用 orval 生成的函数：统一请求函数按文本读响应，会损坏二进制。
import { useEffect, useState } from 'react'
import { getCurrentUsername } from '@/lib/session'

export function fileViewerPath(editionId: number, fileId: number, page?: number | null) {
  return `/standards/library/editions/${editionId}/files/${fileId}${page ? `?page=${page}` : ''}`
}

type FileState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }

export function useStandardFileUrl(id: number): FileState {
  const [state, setState] = useState<{ id: number; value: FileState }>({ id, value: { status: 'loading' } })
  useEffect(() => {
    let url: string | null = null
    let alive = true
    const username = getCurrentUsername()
    fetch(`/api/standards/files/${id}/content`, { headers: username ? { 'X-HDIP-User': username } : {} })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(typeof body?.message === 'string' ? body.message : `原文读取失败（${res.status}）`)
        }
        return res.blob()
      })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setState({ id, value: { status: 'ready', url } })
      })
      .catch((e: unknown) => {
        if (alive) setState({ id, value: { status: 'error', message: e instanceof Error ? e.message : '原文读取失败' } })
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  // 换了文件、新结果还没回来时不显示上一份
  return state.id === id ? state.value : { status: 'loading' }
}
