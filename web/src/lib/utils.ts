import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 告诉 tailwind-merge 令牌新增的字号 text-caption、text-micro 属于字号组；
// 否则它会被当成文字颜色，与 text-fg-* 等颜色类合并时被误删（见 index.css 的 @theme）。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'micro'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
