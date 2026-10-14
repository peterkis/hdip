// 轻提示的统一入口。用法：成功、轻量结果用 toast；需要用户逐条处理的校验错误仍留在页面里（Callout / 表单）。
import toast from 'react-hot-toast'

export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast(message),
  /** 异步操作：进行中 → 成功 / 失败 */
  promise: <T>(p: Promise<T>, msgs: { loading: string; success: string; error: (e: unknown) => string }) =>
    toast.promise(p, { loading: msgs.loading, success: msgs.success, error: msgs.error }),
}
