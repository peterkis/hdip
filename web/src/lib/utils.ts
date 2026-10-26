import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 告诉 tailwind-merge 令牌新增的字号 text-caption、text-micro、text-work-title、text-section 属于字号组；
// 否则它会被当成文字颜色，与 text-fg-* 等颜色类合并时被误删（见 index.css 的 @theme）。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'micro', 'work-title', 'section'] }],
    },
  },
})

/** 滚动方式：用户要求减少动效时直接跳到位，否则平滑滚动（每次调用时读取，偏好改了立即生效） */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
