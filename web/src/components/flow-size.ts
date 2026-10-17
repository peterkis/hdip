// 关系图容器高度：图按容器宽度等比缩小时，高度跟着缩，窄屏上不留大片空白。
import { useEffect, useRef, useState } from 'react'

export function useFlowHeight(graphWidth: number, graphHeight: number, min = 160) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 与 fitView 的 padding 0.1 对应：图占容器的 1 / 1.2
  const scale = width ? Math.min(1, width / (graphWidth * 1.2)) : 1
  return { ref, height: Math.max(min, Math.round(graphHeight * scale * 1.2) + 24) }
}
