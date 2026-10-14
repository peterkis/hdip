// 所有变更表单共用的外壳：选择“加入哪张申请”（新建或自己的草稿），保存后跳到申请详情。
// 表单只负责拼出一个变更项；写入永远经变更申请，提交与确认在申请详情页另行操作。
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
import { Alert, AlertDescription } from '@/components/ui/alert'
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

/** 返回 item 表示校验通过；FieldErrors 表示逐个字段标红；字符串表示整体提示。 */
export type BuildItem = () => ChangeItemInput | FieldErrors | string

/** 当前要加入的草稿里已有的变更项（新建申请时为空）。下拉选项据此补上“本申请新建”的对象 */
const DraftItemsContext = createContext<ChangeItemInput[]>([])

export function useDraftItems(): ChangeItemInput[] {
  return useContext(DraftItemsContext)
}

export function useAddItem() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async ({ item, target }: { item: ChangeItemInput; target: number | 'new' }) => {
      if (target === 'new') return createChangeRequest({ items: [item] })
      const cr = await getChangeRequest(target)
      return updateChangeRequest(target, { items: [...cr.items, item], note: cr.note })
    },
    onSuccess: async (cr, { target }) => {
      notify.success(target === 'new' ? `已保存到新草稿 #${cr.id}` : `已加入草稿 #${cr.id}`)
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
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  build: BuildItem
  /** 在申请详情页“添加变更项”时固定加入该草稿 */
  fixedTarget?: number
  children: ReactNode
}) {
  const username = useCurrentUsername()
  // 打开时总是重取，草稿可能刚在别处创建
  const { data: drafts = [] } = useListChangeRequests({ status: 'draft' }, { query: { enabled: open, staleTime: 0 } })
  const mine = drafts.filter((d) => d.created_by.username === username)
  const [target, setTarget] = useState<string>('new')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const formRef = useRef<HTMLFormElement>(null)
  // 每次校验未通过加一；标红渲染完成后把焦点放到第一个出错字段（按页面顺序）
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    if (focusTick) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusTick])
  const add = useAddItem()

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
    add.mutate({ item: result, target: targetId ?? 'new' }, { onSuccess: () => onOpenChange(false) })
  }

  const error = formError ?? (add.error ? add.error.message : null)
  const errorsCtx = {
    errors: fieldErrors,
    clear: (name: string) =>
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      }),
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
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
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? '保存中…' : '保存到申请'}
            </Button>
          </DialogFooter>
          <p className="text-muted-foreground text-xs">保存后为草稿，需在申请页“提交”，再由确认人“确认”后才生效。</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
