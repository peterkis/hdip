// 所有变更表单共用的外壳：选择“加入哪张申请”（新建或自己的草稿），保存后跳到申请详情。
// 表单只负责拼出一个变更项；写入永远经变更申请，提交与确认在申请详情页另行操作。
// 统一规范 SC-16：字段错误一次全部标出并聚焦第一个；保存失败保留输入与请求键；有输入时关闭先确认一次（不连环确认）；
// 关闭后焦点回到打开表单的按钮（Base UI Dialog 自带）。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  createChangeRequest,
  getChangeRequest,
  updateChangeRequest,
  useGetChangeRequest,
  useListChangeRequests,
} from '@/api/generated/changes/changes'
import type { ChangeRequestWrite } from '@/api/generated/model'
import { FormErrorsContext, isFieldErrors, type FieldErrors } from '@/components/forms/fields'
import { fillNewCodes } from '@/components/forms/new-code'
import { Callout } from '@/components/kit/callout'
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

/** 返回 item（或批量操作的多个 item）表示校验通过；FieldErrors 表示逐个字段标红；字符串表示整体提示。 */
export type BuildItem = () => ChangeItemInput | ChangeItemInput[] | FieldErrors | string

/** 当前要加入的草稿里已有的变更项（新建申请时为空）。下拉选项据此补上“本申请新建”的对象 */
const DraftItemsContext = createContext<ChangeItemInput[]>([])

export function useDraftItems(): ChangeItemInput[] {
  return useContext(DraftItemsContext)
}

export function useAddItem() {
  const qc = useQueryClient()
  const navigate = useNavigate()
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
      /** 表单里有新建对象时，按它预留代码（同一次打开的表单不变，重试拿回同一批号） */
      requestKey?: string
    }) => {
      const raw = Array.isArray(item) ? item : [item]
      const items = requestKey ? await fillNewCodes(raw, requestKey) : raw
      if (target === 'new') return createChangeRequest({ items, note: note ?? null })
      const cr = await getChangeRequest(target)
      return updateChangeRequest(target, { items: [...cr.items, ...items], note: cr.note })
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
  // 有没有填过东西：表单里任一输入框、选择框发生输入就算；用来在关闭前确认一次
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
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
    const result = build()
    if (isFieldErrors(result)) {
      setFormError(null)
      setFieldErrors(result.fieldErrors)
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
      setFormError('没有可保存的变更项')
      return
    }
    add.mutate({ item: result, target: targetId ?? 'new', note, requestKey }, { onSuccess: () => onOpenChange(false) })
  }

  const error = formError ?? (add.error ? add.error.message : null)
  /** 取消、Esc、点遮罩都走这里：填过内容时先确认一次 */
  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true)
    if (dirty && !add.isPending) return setConfirmClose(true)
    onOpenChange(false)
  }
  // 标红后每次改动都按表单自己的 build() 重新检查：只清掉已经通过的字段，不因键入任意字符就清掉，
  // 也不给还没标红的字段新加错误（统一规范 R-ACT 7.3）
  useEffect(() => {
    const flagged = Object.keys(fieldErrors)
    if (flagged.length === 0) return
    const r = build()
    const still = isFieldErrors(r) ? r.fieldErrors : {}
    const next = Object.fromEntries(flagged.filter((k) => k in still).map((k) => [k, still[k]]))
    if (flagged.length !== Object.keys(next).length || flagged.some((k) => next[k] !== fieldErrors[k])) setFieldErrors(next)
  })
  const errorsCtx = { errors: fieldErrors, clear: () => {} }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className={wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}>
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onInput={() => setDirty(true)}
          onChange={() => setDirty(true)}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FormErrorsContext.Provider value={errorsCtx}>
            <DraftItemsContext.Provider value={draftItems}>
              <div className="grid max-h-[60vh] gap-3 overflow-y-auto px-0.5 pb-0.5">{children}</div>
            </DraftItemsContext.Provider>
          </FormErrorsContext.Provider>
          {fixedTarget === undefined && (
            <Field>
              <FieldLabel htmlFor="target">加入变更申请</FieldLabel>
              <NativeSelect id="target" className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                <NativeSelectOption value="new">新建一张变更申请</NativeSelectOption>
                {mine.map((d) => (
                  <NativeSelectOption key={d.id} value={String(d.id)}>
                    草稿 #{d.id}：{d.item_labels.join('、')}
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
              <p className="text-fg text-xs">关闭会丢弃这张表单里已填写的内容，还没有保存到任何申请。</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" autoFocus onClick={() => setConfirmClose(false)}>
                  继续填写
                </Button>
                <Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>
                  放弃并关闭
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                取消
              </Button>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? '保存中…' : (submitLabel ?? '保存到申请')}
              </Button>
            </DialogFooter>
          )}
          <p className="text-fg-secondary text-xs">保存后仍是草稿；在申请页提交、由确认人确认后，各项按业务日期适用。</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
