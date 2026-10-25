// 表单编辑通知（统一规范 R-ACT 7.3）：不产生原生 input / change 事件的编辑（点标签 ×、选项胶囊、增删后继、
// “按名称重新生成”）调用 markDirty()，好让表单外壳在关闭前确认。原生输入框、下拉由外壳自己监听，不必调用。
// 纯浏览（切换查看哪个后继、展开说明）不要调用。表单外壳之外使用时为空操作（如列表页的筛选胶囊）。
import { createContext, useContext } from 'react'

export const FormEditContext = createContext<{ markDirty: () => void }>({ markDirty: () => {} })

export function useMarkDirty(): () => void {
  return useContext(FormEditContext).markDirty
}
