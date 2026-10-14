// 所有变更表单共用的外壳：选择“加入哪张申请”（新建或自己的草稿），保存后跳到申请详情。
// 表单只负责拼出一个变更项；写入永远经变更申请，提交与确认在申请详情页另行操作。
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  createChangeRequest,
  getChangeRequest,
  updateChangeRequest,
  useListChangeRequests,
} from '@/api/generated/changes/changes'
import type { ChangeRequestWrite } from '@/api/generated/model'
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
import { useCurrentUsername } from '@/lib/session'
import { notify } from '@/lib/notify'

export type ChangeItemInput = ChangeRequestWrite['items'][number]

/** 返回 item 表示校验通过；返回字符串表示表单内的错误提示。 */
export type BuildItem = () => ChangeItemInput | string

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
  const { data: drafts = [] } = useListChangeRequests({ status: 'draft' }, { query: { enabled: open } })
  const mine = drafts.filter((d) => d.created_by.username === username)
  const [target, setTarget] = useState<string>('new')
  const [formError, setFormError] = useState<string | null>(null)
  const add = useAddItem()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const item = build()
    if (typeof item === 'string') {
      setFormError(item)
      return
    }
    setFormError(null)
    const t = fixedTarget ?? (target === 'new' ? 'new' : Number(target))
    add.mutate({ item, target: t }, { onSuccess: () => onOpenChange(false) })
  }

  const error = formError ?? (add.error ? add.error.message : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">{children}</div>
          {fixedTarget === undefined && (
            <Field>
              <FieldLabel htmlFor="target">加入变更申请</FieldLabel>
              <NativeSelect
                id="target"
                className="w-full"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
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
          <p className="text-muted-foreground text-xs">
            保存后为草稿，需在申请页“提交”，再由确认人“确认”后才生效。
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
