// 所有变更表单共用的外壳：选择“加入哪张申请”（新建或自己的草稿），保存后跳到申请详情。
// 表单只负责拼出一个变更项；写入永远经变更申请，提交与确认在申请详情页另行操作。
// 统一规范 SC-16 / R-ACT 7.3（U3R-01 修订）：
// - build() 是纯函数：只按当前值返回结果，不切换面板、不改状态、不发请求；外壳在提交时调用，标红后每次改动也会调用重查。
//   提交未通过时要切到出错面板（如拆分的后继），写在 reveal 里——只在点“保存到申请”未通过时调用。
// - 字段错误一次全部标出并聚焦第一个；之后只清掉已通过的字段。整体提示（build 返回字符串）重查通过才消失。
// - 有改动时关闭（取消、×、Esc、点遮罩）先确认一次；改动 = 原生输入 / 下拉 + 控件经 kit/form-edit 的 markDirty() 报告的编辑。
// - 保存中不关闭、不重复保存、字段暂不可改；失败后输入、所选后继、目标草稿和请求键都保留，可直接重试。
// 关闭后焦点回到打开表单的按钮（Base UI Dialog 自带）。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  createChangeRequest,
  getChangeRequest,
  updateChangeRequest,
  useGetChangeRequest,
  useListChangeRequests,
} from '@/api/generated/changes/changes'
import type { ChangeRequestWrite } from '@/api/generated/model'
import { ApiError } from '@/api/fetcher'
import { FormErrorsContext, isFieldErrors, type FieldErrors } from '@/components/forms/fields'
import { fillNewCodes } from '@/components/forms/new-code'
import { Callout } from '@/components/kit/callout'
import { FormEditContext } from '@/components/kit/form-edit'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify'
import { useCurrentUsername } from '@/lib/session'

export type ChangeItemInput = ChangeRequestWrite['items'][number]

/**
 * 纯函数：返回 item（或批量操作的多个 item）表示校验通过；FieldErrors 表示逐个字段标红；字符串表示整体提示（不保存）。
 * 空数组也不保存（“没有可保存的变更项”）。不要在里面 setState——外壳会在每次渲染时调用它重查。
 */
export type BuildItem = () => ChangeItemInput | ChangeItemInput[] | FieldErrors | string

const EMPTY_ITEMS = '没有可保存的变更项'

/** 当前要加入的草稿里已有的变更项（新建申请时为空）。下拉选项据此补上“本申请新建”的对象 */
const DraftItemsContext = createContext<ChangeItemInput[]>([])

export function useDraftItems(): ChangeItemInput[] {
  return useContext(DraftItemsContext)
}

/**
 * 保存结果是否未确定：没拿到服务端答复（网络中断），或服务端 / 代理出错（5xx）。
 * 服务端先提交再组装响应，响应出错不能证明没有写入（审查 F04）；只有明确的业务拒绝（4xx）才说没有写入
 */
export function saveUncertain(error: Error | null | undefined): boolean {
  return !!error && (!(error instanceof ApiError) || error.status >= 500)
}

/** 关闭确认的说明：只丢弃本地输入；上次保存结果未确定时不宣称“没有保存”，提示去核对 */
export function closeWarning(what: string, error: Error | null | undefined): string {
  return saveUncertain(error)
    ? `关闭只丢弃${what}；上一次保存的结果未确定，可能已经写入申请。关闭后请到变更申请“我的草稿”核对，不要重复新建。`
    : `关闭会丢弃${what}，还没有保存到任何申请。`
}

/**
 * 保存失败的说明（迁移 0022 之后）：
 * - 网络中断等没拿到服务端答复，或服务端 / 代理出错（5xx）：结果未确定，服务端可能已写入；内容不改直接再保存会先核对、不会重复。
 * - 409：同一次保存的请求键已写入过别的内容（上次其实已成功、之后又改过），服务端的说明已写明去核对哪张申请。
 * - 412：草稿在读取之后被别处改过，这次没有写入（以免覆盖），服务端说明已写明。
 * - 其他被拒（校验未通过等）：没有写入，改好后再保存。
 */
export function saveFailureText(error: Error, kept: string): string {
  if (saveUncertain(error))
    return `保存结果未确定：${error.message}。服务端可能已经写入；内容不改直接再保存会先核对，不会重复；改过内容再保存时，如果上次其实已写入，会提示你去核对那张申请。${kept}。`
  if (error instanceof ApiError && (error.status === 409 || error.status === 412)) return `${error.message}${kept}。`
  return `保存未成功：${error.message}。${kept}，改好后可再次保存。`
}

export function useAddItem() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  // 本次打开的表单已发出的请求体，按“提交内容”记住：内容没改的重试原样重发（不重读草稿、不再追加一遍），
  // 服务端才能认出是同一次保存；内容改过就重新组装——若上次其实已写入，服务端会拒绝并说明（迁移 0022）
  const sent = useRef<{ fp: string; target: number | 'new'; body: ChangeRequestWrite } | null>(null)
  return useMutation({
    mutationFn: async ({
      item,
      target,
      note,
      requestKey,
    }: {
      item: ChangeItemInput | ChangeItemInput[]
      target: number | 'new'
      note?: string
      /** 本次打开表单的请求键：预留代码按它取号，写草稿也带上它——同一次打开里重试拿回同一批号，
       *  且服务端已写入过的（响应丢失）不再新建第二张、不再重复追加（迁移 0022） */
      requestKey?: string
    }) => {
      const raw = Array.isArray(item) ? item : [item]
      const fp = JSON.stringify({ raw, target, note: note ?? null })
      const send = (t: number | 'new', body: ChangeRequestWrite) => (t === 'new' ? createChangeRequest(body) : updateChangeRequest(t, body))
      // 按最新草稿组装：加入已有草稿时带上读到的 updated_at 作为前提，草稿之后被别处改过，服务端拒绝（412）而不覆盖
      const build = async () => {
        const items = requestKey ? await fillNewCodes(raw, requestKey) : raw
        const request_key = requestKey ?? null
        let body: ChangeRequestWrite
        if (target === 'new') body = { items, note: note ?? null, request_key }
        else {
          const cr = await getChangeRequest(target)
          body = { items: [...cr.items, ...items], note: cr.note, request_key, expected_updated_at: cr.updated_at }
        }
        sent.current = { fp, target, body }
        return body
      }
      const body = sent.current?.fp === fp ? sent.current.body : await build()
      try {
        return await send(target, body)
      } catch (e) {
        // 412 只在请求键还没写入过时出现（写入过的重试先被认出）：上次没有写入，按最新草稿重新组装再保存一次，
        // 中间的修改得以保留，也不会重复追加
        if (e instanceof ApiError && e.status === 412 && target !== 'new') return send(target, await build())
        throw e
      }
    },
    onSuccess: async (cr, { target, item }) => {
      const n = Array.isArray(item) ? `（${item.length} 项）` : ''
      notify.success(target === 'new' ? `已保存到新草稿 #${cr.id}${n}` : `已加入草稿 #${cr.id}${n}`)
      await qc.invalidateQueries()
      navigate(`/changes/${cr.id}`)
    },
  })
}

export function ItemDialog({
  open,
  onOpenChange,
  title,
  description,
  build,
  reveal,
  fixedTarget,
  wide,
  note,
  submitLabel,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  build: BuildItem
  /** 点“保存到申请”未通过时调用（只在这时）：把首个错误所在的面板切出来；之后外壳把焦点放到第一个标红字段 */
  reveal?: (errors: FieldErrors) => void
  /** 在申请详情页“添加变更项”时固定加入该草稿 */
  fixedTarget?: number
  /** 带图示的表单（拆分、合并）用宽弹窗 */
  wide?: boolean
  /** 新建草稿时的变更说明（批量操作用来写明来源） */
  note?: string
  /** 保存按钮文字，默认“保存到申请” */
  submitLabel?: string
  children: ReactNode
}) {
  const username = useCurrentUsername()
  // 打开时总是重取，草稿可能刚在别处创建
  const { data: drafts = [] } = useListChangeRequests({ status: 'draft' }, { query: { enabled: open, staleTime: 0 } })
  const mine = drafts.filter((d) => d.created_by.username === username)
  const [target, setTarget] = useState<string>('new')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // 本次打开期间有没有改过：原生输入框、下拉的输入由表单监听；标签 ×、选项胶囊、增删后继等由控件 markDirty()。
  // 保守策略：改过再改回原值仍算改过（关闭时多问一次，不会漏问）
  const [dirty, setDirty] = useState(false)
  const markDirty = useCallback(() => setDirty(true), [])
  const editCtx = useMemo(() => ({ markDirty }), [markDirty])
  const [confirmClose, setConfirmClose] = useState(false)
  // “继续填写”后把焦点放回关闭前所在的字段
  const resumeFocus = useRef<HTMLElement | null>(null)
  // 防重入：pending 状态要等下一次渲染才可见，连按回车 / 双击保存时靠它挡住第二次请求
  const saving = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  // 每次校验未通过加一；标红渲染完成后把焦点放到第一个出错字段（按页面顺序）
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    if (focusTick) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusTick])
  const add = useAddItem()
  // 预留代码用的请求键：表单打开期间不变（弹窗只在打开时挂载，关闭即丢弃）
  const [requestKey] = useState(() => crypto.randomUUID())

  const targetId = fixedTarget ?? (target === 'new' ? undefined : Number(target))
  const { data: draft } = useGetChangeRequest(targetId ?? 0, { query: { enabled: open && !!targetId } })
  const draftItems = (targetId && draft?.id === targetId ? draft.items : []) as ChangeItemInput[]

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving.current) return
    const result = build()
    if (isFieldErrors(result)) {
      setFormError(null)
      setFieldErrors(result.fieldErrors)
      reveal?.(result)
      setFocusTick((t) => t + 1)
      return
    }
    if (typeof result === 'string') {
      setFieldErrors({})
      setFormError(result)
      return
    }
    setFormError(null)
    setFieldErrors({})
    if (Array.isArray(result) && result.length === 0) {
      setFormError(EMPTY_ITEMS)
      return
    }
    saving.current = true
    add.mutate(
      { item: result, target: targetId ?? 'new', note, requestKey },
      {
        onSuccess: () => onOpenChange(false),
        onSettled: () => {
          saving.current = false
        },
      },
    )
  }

  const pending = add.isPending
  const error =
    formError ?? (add.error ? saveFailureText(add.error, '已填写的内容都还在') : null)
  /** 取消、×、Esc、点遮罩都走这里：保存中不关闭（请求已发出，关掉也撤不回）；改过内容时先确认一次 */
  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true)
    if (pending || confirmClose) return
    if (dirty) {
      const active = document.activeElement
      resumeFocus.current = active instanceof HTMLElement && formRef.current?.contains(active) ? active : null
      return setConfirmClose(true)
    }
    onOpenChange(false)
  }
  // 先把焦点移回字段、再收起确认条：按钮卸载时若仍有焦点，Dialog 会把焦点收回弹窗本身
  const resume = () => {
    const el = resumeFocus.current
    ;(el?.isConnected ? el : formRef.current?.querySelector<HTMLElement>('input, select, textarea'))?.focus()
    setConfirmClose(false)
  }
  // 出过错后每次改动都按表单自己的 build() 重新检查（统一规范 R-ACT 7.3）：
  // 字段错误只清掉已经通过的，不因键入任意字符就清掉，也不给还没标红的字段新加错误；
  // 整体提示在 build 不再返回它（且已能生成变更项）时才消失，仍是字符串时换成最新的说法。
  // build 是纯函数，这里不切换面板、不移动焦点。
  useEffect(() => {
    const flagged = Object.keys(fieldErrors)
    if (flagged.length === 0 && formError === null) return
    const r = build()
    if (flagged.length > 0) {
      const still = isFieldErrors(r) ? r.fieldErrors : {}
      const next = Object.fromEntries(flagged.filter((k) => k in still).map((k) => [k, still[k]]))
      if (flagged.length !== Object.keys(next).length || flagged.some((k) => next[k] !== fieldErrors[k])) setFieldErrors(next)
    }
    if (formError !== null) {
      if (typeof r === 'string') {
        if (r !== formError) setFormError(r)
      } else if (!isFieldErrors(r) && !(Array.isArray(r) && r.length === 0)) setFormError(null)
    }
  })
  const errorsCtx = { errors: fieldErrors, clear: () => {} }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className={wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}>
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onInput={markDirty}
          onChange={markDirty}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FormEditContext.Provider value={editCtx}>
            <FormErrorsContext.Provider value={errorsCtx}>
              <DraftItemsContext.Provider value={draftItems}>
                {/* 保存中整组停用（含自定义按钮），免得改了的内容随成功跳转丢失 */}
                <fieldset disabled={pending} className="-m-1 grid max-h-[60vh] min-w-0 gap-3 overflow-y-auto p-1.5">
                  {children}
                </fieldset>
              </DraftItemsContext.Provider>
            </FormErrorsContext.Provider>
          </FormEditContext.Provider>
          {fixedTarget === undefined && (
            <Field>
              <FieldLabel htmlFor="target">加入变更申请</FieldLabel>
              <NativeSelect
                id="target"
                className="w-full"
                value={target}
                disabled={pending}
                onChange={(e) => setTarget(e.target.value)}
              >
                <NativeSelectOption value="new">新建一张变更申请</NativeSelectOption>
                {mine.map((d) => (
                  <NativeSelectOption key={d.id} value={String(d.id)}>
                    草稿 #{d.id}：{draftSummary(d.item_labels)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {error && (
            <Callout tone="danger">{error}</Callout>
          )}
          {confirmClose ? (
            <div role="alertdialog" aria-label="放弃已填写的内容" className="bg-surface-subtle grid gap-3 rounded-lg px-3 py-3">
              <p className="text-fg text-xs">{closeWarning('这张表单里已填写的内容', add.error)}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" autoFocus onClick={resume}>
                  继续填写
                </Button>
                <Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>
                  放弃并关闭
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => requestClose(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? '保存中…' : (submitLabel ?? '保存到申请')}
              </Button>
            </DialogFooter>
          )}
          <p className="text-fg-secondary text-xs">保存后仍是草稿；在申请页提交、由确认人确认后，各项按业务日期适用。</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 草稿的变更项概要：同类合并计数（“登记外部代码 ×55”），最多列 3 类，其余写“等 N 类” */
function draftSummary(labels: string[]): string {
  const counts = new Map<string, number>()
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  const parts = [...counts].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l))
  return parts.length > 3 ? `${parts.slice(0, 3).join('、')} 等 ${parts.length} 类` : parts.join('、')
}
