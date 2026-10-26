// 分类方案（配置字典）：维护人可直接修改，不经变更申请、不需确认；记录维护人与时间。
// 代码值不可改，不删除只停用。部门上的分类“赋值”仍在部门页经变更申请。
import { Add01Icon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import {
  useCreateClassificationCode,
  useCreateClassificationScheme,
  useUpdateClassificationCode,
  useUpdateClassificationScheme,
} from '@/api/generated/dictionary/dictionary'
import { useListClassificationSchemes } from '@/api/generated/master/master'
import type { ClassificationCodeOut, ClassificationSchemeOut } from '@/api/generated/model'
import { FormErrorsContext, requireFields, SelectField, TextField, useFocusFirstInvalid } from '@/components/forms/fields'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbRow, DbTable } from '@/components/kit/database'
import { ReadError, ReadLoading, readStatus, StaleNotice } from '@/components/kit/read-state'
import { Icon } from '@/components/kit/icon'
import { Tag } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { stamp } from '@/lib/format'
import { notify } from '@/lib/notify'
import { MAIN_CLASS_TONE } from '@/lib/tones'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

/** 代码多的方案（如外部分类体系）默认只显示前几项 */
const FOLD = 12

export function DictionaryPage() {
  usePageFrame('work')
  // 读取状态（U3R-03）：读取中、失败、真的没有方案分开说
  const list = useListClassificationSchemes()
  const status = readStatus(list)
  const schemes = list.data ?? []
  const { me } = useMe()
  const canEdit = me?.permissions.includes('dictionary.maintain') ?? false
  const [creating, setCreating] = useState(false)
  return (
    <>
      {creating && <SchemeDialog scheme={null} onClose={() => setCreating(false)} />}
      <PageHeader
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Icon icon={Add01Icon} inline="start" />
              登记分类方案
            </Button>
          )
        }
        title="分类方案" description="部门管理主分类，以及登记的外部分类体系（如病案科室分类）。每个方案写明用在部门、服务单元上各表示什么；代码以正式代码表为准。本页不按查看日期筛选：配置用于定义规则。" />
      {/* SC-12：轻量说明配置的保存语义；对象的分类赋值仍在对象页经变更申请 */}
      <Callout className="mb-6" title="配置字典：保存即生效，不经变更申请">
        维护人直接修改并记下维护人与时间；代码一经使用不可改、不删除，只能停用。给部门或服务单元设置分类请到各自的页面，那是业务数据，照常经变更申请。
      </Callout>
      <StaleNotice what="分类方案" query={list} />
      {status === 'loading' ? (
        <ReadLoading label="正在读取分类方案…" />
      ) : status === 'error' ? (
        <ReadError what="分类方案" query={list} />
      ) : schemes.length === 0 ? (
        <DbEmpty
          title="还没有登记分类方案"
          hint={canEdit ? '用右上角“登记分类方案”登记第一个方案。' : '有“维护字典”权限的人登记后会出现在这里。'}
        />
      ) : (
        <div className="grid gap-8">
          {schemes.map((s) => (
            <SchemeSection key={s.id} scheme={s} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  )
}

function SchemeSection({ scheme, canEdit }: { scheme: ClassificationSchemeOut; canEdit: boolean }) {
  const [editing, setEditing] = useState<ClassificationCodeOut | 'new' | null>(null)
  const [editingScheme, setEditingScheme] = useState(false)
  const [expanded, setExpanded] = useState(scheme.codes.length <= FOLD)
  const update = useUpdate()
  const shown = expanded ? scheme.codes : scheme.codes.slice(0, FOLD)
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {/* SC-12：方案名称 + 版本 + 单 / 多选 → 用于部门 / 服务单元的含义 → 用途边界 */}
        <div className="grid gap-1">
          <h2 className="text-fg-strong text-section font-semibold">
            {scheme.name} <span className="text-fg-muted text-xs font-normal">{scheme.version} · {scheme.is_exclusive ? '单选' : '可多选'}</span>
          </h2>
          <p className="text-fg-secondary text-xs">
            用于部门：{scheme.meaning_for_department ?? '不适用'} · 用于服务单元：{scheme.meaning_for_unit ?? '不适用'}
          </p>
          {scheme.purpose && <p className="text-fg-muted text-caption">{scheme.purpose}</p>}
        </div>
        {canEdit && (
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingScheme(true)}>
              编辑方案
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
              <Icon icon={Add01Icon} inline="start" />
              新增代码
            </Button>
          </span>
        )}
      </div>
      <DbTable
        columns={[
          { label: '名称 / 代码', className: 'min-w-32' },
          { label: '按什么判断', className: 'min-w-56' },
          { label: '需要防止的误判', className: 'min-w-56' },
          { label: '最近维护' },
          { label: '' },
        ]}
      >
        {shown.map((c) => (
          <DbRow key={c.id} className={cn(!c.is_active && 'text-fg-muted')}>
            <DbCell className="whitespace-nowrap">
              <span className="grid justify-items-start gap-0.5">
                <span>
                  <Tag tone={c.is_active ? (MAIN_CLASS_TONE[c.code] ?? 'gray') : 'gray'}>{c.name}</Tag>
                  {!c.is_active && <span className="text-fg-muted ml-2 text-caption">已停用（历史引用仍可读）</span>}
                </span>
                <span className="text-fg-muted font-mono text-caption select-all">{c.code}</span>
              </span>
            </DbCell>
            <DbCell className="py-2 whitespace-normal">{c.criterion ?? '—'}</DbCell>
            <DbCell className="text-fg-secondary py-2 whitespace-normal">{c.caution ?? '—'}</DbCell>
            <DbCell className="text-fg-muted text-caption whitespace-nowrap">
              {c.updated_by ? `${c.updated_by.display_name} · ${stamp(c.updated_at)}` : '初始配置'}
            </DbCell>
            <DbCell className="text-right whitespace-nowrap">
              {canEdit && (
                <>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(c)}>
                    编辑
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate(
                        { codeId: c.id, data: { is_active: !c.is_active } },
                        { onSuccess: () => notify.success(`已${c.is_active ? '停用' : '恢复'}“${c.name}”`) },
                      )
                    }
                  >
                    {c.is_active ? '停用' : '恢复'}
                  </Button>
                </>
              )}
            </DbCell>
          </DbRow>
        ))}
      </DbTable>
      {!expanded && (
        <Button variant="ghost" size="sm" className="text-fg-muted justify-self-start" onClick={() => setExpanded(true)}>
          展开全部 {scheme.codes.length} 项
        </Button>
      )}
      {editingScheme && <SchemeDialog scheme={scheme} onClose={() => setEditingScheme(false)} />}
      {editing && (
        <CodeDialog scheme={scheme} code={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  )
}

function useUpdate() {
  const qc = useQueryClient()
  return useUpdateClassificationCode({
    mutation: { onSuccess: () => qc.invalidateQueries(), onError: (e) => notify.error(e.message) },
  })
}

/** 新增或编辑一个代码；直接保存（配置），不经变更申请 */
function CodeDialog({ scheme, code, onClose }: { scheme: ClassificationSchemeOut; code: ClassificationCodeOut | null; onClose: () => void }) {
  const qc = useQueryClient()
  const update = useUpdate()
  const create = useCreateClassificationCode({
    mutation: { onSuccess: () => qc.invalidateQueries(), onError: (e) => notify.error(e.message) },
  })
  const [f, setF] = useState({
    code: code?.code ?? '',
    name: code?.name ?? '',
    criterion: code?.criterion ?? '',
    caution: code?.caution ?? '',
    sort_order: String(code?.sort_order ?? (scheme.codes.length + 1) * 10),
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const focus = useFocusFirstInvalid()
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (v: string) => setF({ ...f, [k]: v }) })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const bad = requireFields([
      ['name', !!f.name.trim(), '请填写名称'],
      ['code', !!code || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(f.code.trim()), '代码只能包含字母、数字、点、下划线、短横线'],
      ['sort_order', /^\d+$/.test(f.sort_order), '排序须是整数'],
    ])
    if (bad) {
      setErrors(bad.fieldErrors)
      focus.focusFirst()
      return
    }
    const body = { name: f.name.trim(), criterion: f.criterion, caution: f.caution, sort_order: Number(f.sort_order) }
    const done = () => {
      notify.success(code ? `已保存“${body.name}”` : `已新增“${body.name}”`)
      onClose()
    }
    if (code) update.mutate({ codeId: code.id, data: body }, { onSuccess: done })
    else create.mutate({ schemeCode: scheme.code, data: { ...body, code: f.code.trim() } }, { onSuccess: done })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form ref={focus.ref} onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{code ? `编辑：${code.name}` : `新增代码：${scheme.name}`}</DialogTitle>
            <DialogDescription>保存即生效，不需确认。{code ? '代码值不可改。' : '代码一经保存不可改、不删除，只能停用。'}</DialogDescription>
          </DialogHeader>
          <FormErrorsContext.Provider
            value={{
              errors,
              clear: (n) =>
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next[n]
                  return next
                }),
            }}
          >
            <div className="grid gap-3">
              <TextField label="名称" name="name" required {...bind('name')} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="代码" name="code" required disabled={!!code} hint="按正式代码表原样填写（如 03.05）" {...bind('code')} />
                <TextField label="排序" name="sort_order" {...bind('sort_order')} />
              </div>
              <TextField label="按什么判断" {...bind('criterion')} />
              <TextField label="需要防止的误判" {...bind('caution')} />
            </div>
          </FormErrorsContext.Provider>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={update.isPending || create.isPending}>
              保存配置
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 登记或编辑分类方案（配置，保存即生效）。代码与单选 / 多选新建后不可改。 */
function SchemeDialog({ scheme, onClose }: { scheme: ClassificationSchemeOut | null; onClose: () => void }) {
  const qc = useQueryClient()
  const opts = { mutation: { onSuccess: () => qc.invalidateQueries(), onError: (e: Error) => notify.error(e.message) } }
  const create = useCreateClassificationScheme(opts)
  const update = useUpdateClassificationScheme(opts)
  const [f, setF] = useState({
    code: scheme?.code ?? '',
    name: scheme?.name ?? '',
    version: scheme?.version ?? '',
    purpose: scheme?.purpose ?? '',
    exclusive: scheme ? (scheme.is_exclusive ? 'yes' : 'no') : 'no',
    for_department: scheme?.meaning_for_department ?? '',
    for_unit: scheme?.meaning_for_unit ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const focus = useFocusFirstInvalid()
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (v: string) => setF({ ...f, [k]: v }) })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const bad = requireFields([
      ['name', !!f.name.trim(), '请填写名称'],
      ['code', !!scheme || /^[A-Z][A-Z0-9_]{0,63}$/.test(f.code.trim()), '代码只能用大写字母、数字、下划线，且以字母开头'],
      ['version', !!scheme || !!f.version.trim(), '请填写版本（如 HQMS2020、2024 版）'],
      ['for_department', !!(f.for_department.trim() || f.for_unit.trim()), '至少写明用于部门或服务单元时的含义'],
    ])
    if (bad) {
      setErrors(bad.fieldErrors)
      focus.focusFirst()
      return
    }
    const done = () => {
      notify.success(scheme ? `已保存“${f.name.trim()}”` : `已登记“${f.name.trim()}”`)
      onClose()
    }
    const common = {
      name: f.name.trim(),
      purpose: f.purpose,
      meaning_for_department: f.for_department,
      meaning_for_unit: f.for_unit,
    }
    if (scheme) update.mutate({ schemeCode: scheme.code, data: common }, { onSuccess: done })
    else
      create.mutate(
        { data: { ...common, code: f.code.trim(), version: f.version.trim(), is_exclusive: f.exclusive === 'yes' } },
        { onSuccess: done },
      )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form ref={focus.ref} onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{scheme ? `编辑方案：${scheme.name}` : '登记分类方案'}</DialogTitle>
            <DialogDescription>
              保存即生效，不需确认。外部分类体系（如病案科室分类）的代码以正式代码表为准，不臆造。写明这个方案用在部门、服务单元上各表示什么；留空表示不适用。
            </DialogDescription>
          </DialogHeader>
          <FormErrorsContext.Provider
            value={{
              errors,
              clear: (n) =>
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next[n]
                  return next
                }),
            }}
          >
            <div className="grid gap-3">
              <TextField label="名称" name="name" required {...bind('name')} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="方案代码" name="code" required disabled={!!scheme} hint="大写字母、数字、下划线；不可改" {...bind('code')} />
                <TextField label="版本" name="version" required disabled={!!scheme} {...bind('version')} />
              </div>
              <SelectField
                label="同一时点"
                required
                disabled={!!scheme}
                value={f.exclusive}
                onChange={(v) => setF({ ...f, exclusive: v })}
                options={[
                  { value: 'no', label: '可有多个（多选）' },
                  { value: 'yes', label: '只有一个（单选）' },
                ]}
              />
              <TextField label="用于部门时表示" name="for_department" hint="如“专业定位”“病案统计科别参考”；留空 = 不用于部门" {...bind('for_department')} />
              <TextField label="用于服务单元时表示" name="for_unit" hint="如“服务专业”“住院单元病案统计科别”；留空 = 不用于服务单元" {...bind('for_unit')} />
              <TextField label="用途与边界" hint="如“不代表执业许可”“不能直接作为当前上报字典”" {...bind('purpose')} />
            </div>
          </FormErrorsContext.Provider>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              保存配置
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
