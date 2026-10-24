// 列表的滚动位置：离开时记下，从详情返回时回到原来的位置（同一筛选 = 同一个 key）。
// 正文的滚动容器是外壳里的 <main>（components/layout.tsx），不是 window。记在 sessionStorage，只对本标签页有效。
import { useEffect } from 'react'

export function useScrollMemory(key: string, ready: boolean) {
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main || !ready) return
    const storeKey = `hdip.scroll:${key}`
    // 外壳换页时先回到顶部（同一轮 effect 里，父组件的在后），所以下一帧再恢复
    const restore = requestAnimationFrame(() => {
      try {
        const saved = Number(sessionStorage.getItem(storeKey))
        if (saved > 0) main.scrollTop = saved
      } catch {
        /* 本地存储不可用：不恢复 */
      }
    })
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(storeKey, String(main.scrollTop))
        } catch {
          /* 忽略 */
        }
      })
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(restore)
      cancelAnimationFrame(frame)
      main.removeEventListener('scroll', onScroll)
    }
  }, [key, ready])
}
