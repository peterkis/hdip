// 批量裁决待裁决的外部代码（编码映射台账）。
// 后端按源名称给出候选（名称相同 / 别名 / 曾用名 / 包含 / 相近），只是建议：
// 只有“名称相同、别名、曾用名”预先选中候选，“包含、相近”需要人点选；最终勾选哪些行由人决定。
// 两种生成方式：① 按各行选定的对象 ② 把所选各行统一解释为同一个对象（如同一个门诊单元、或“对象未建模”）。
// 都生成一张草稿（每行一项 external_code.assign），提交、确认后生效。
import { useMemo, useState } from 'react'
import { useListExternalCodes } from '@/api/generated/master/master'
import type { CodeSuggestion, ExternalCodeRow } from '@/api/generated/model'
import { useEffectiveDate, type DialogProps } from '@/components/forms/change-forms'
import { requireFields, SelectField, TextField } from '@/components/forms/fields'
import { ItemDialog, type ChangeItemInput } from '@/components/forms/item-dialog'
import { DepartmentSelect, UnitSelect } from '@/components/forms/ref-selects'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbRow, DbTable, ToggleChip } from '@/components/kit/database'
import { Tag, type Tone } from '@/components/kit/tag'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { UNMODELED_TYPE } from '@/lib/format'
import { cn } from '@/lib/utils'

const MATCH: Record<CodeSuggestion['match'], { label: string; tone: Tone; preselect: boolean }> = {
  exact: { label: '名称相同', tone: 'green', preselect: true },
  alias: { label: '别名', tone: 'green', preselect: true },
  former_name: { label: '曾用名', tone: 'blue', preselect: true },
  contains: { label: '包含', tone: 'yellow', preselect: false },
  similar: { label: '相近', tone: 'gray', preselect: false },
}

type Chosen = Record<number, CodeSuggestion | null>
const keyOf = (s: CodeSuggestion) => `${s.target_type}:${s.code}`

export function BatchAdjudicate({ namespaceId, q }: { namespaceId?: number; q?: string }) {
  const { asOf } = useApp()
  const [limit, setLimit] = useState(200)
  const [only, setOnly] = useState<'all' | 'suggested' | 'preselected'>('suggested')
  const { data: page, isPending } = useListExternalCodes({
    as_of: asOf,
    status: 'pending',
    suggest: true,
    limit,
    ...(namespaceId && { namespace_id: namespaceId }),
    ...(q && { q }),
  })
  const all = page?.rows ?? []
  const [chosen, setChosen] = useState<Chosen>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<'chosen' | 'uniform' | null>(null)

  // 预选：名称相同、别名、曾用名的第一个候选；人点选过的以人为准
  const pick = (r: ExternalCodeRow): CodeSuggestion | null =>
    r.id in chosen ? chosen[r.id] : ((r.suggestions ?? []).find((s) => MATCH[s.match].preselect) ?? null)
  const rows = useMemo(
    () =>
      all.filter((r) =>
        only === 'all' ? true : only === 'suggested' ? (r.suggestions ?? []).length > 0 : (r.suggestions ?? []).some((s) => MATCH[s.match].preselect),
      ),
    [all, only],
  )
  const picked = rows.filter((r) => selected.has(r.id))
  const ready = picked.filter((r) => pick(r))
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="grid gap-3">
      <Callout tone="info" title="批量裁决：按源名称给出候选，由你勾选确认">
        “名称相同、别名、曾用名”已预先选中候选；“包含、相近”只作提示，点一下候选才算选定。勾选要处理的行后，可以按各行选定的对象生成申请，
        也可以把所选各行统一解释为同一个对象（如同一个门诊单元、或“对象未建模”）。生成的是草稿，提交、确认后才生效。
      </Callout>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip label={`有候选 ${all.filter((r) => (r.suggestions ?? []).length).length}`} checked={only === 'suggested'} onChange={() => setOnly('suggested')} />
        <ToggleChip
          label={`已预选 ${all.filter((r) => (r.suggestions ?? []).some((s) => MATCH[s.match].preselect)).length}`}
          checked={only === 'preselected'}
          onChange={() => setOnly('preselected')}
        />
        <ToggleChip label={`全部待裁决 ${all.length}`} checked={only === 'all'} onChange={() => setOnly('all')} />
        {page && all.length < page.total && (
          <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 300)}>
            再载入 {Math.min(300, page.total - all.length)} 条（共 {page.total}）
          </Button>
        )}
      </div>

      {!isPending && rows.length === 0 ? (
        <DbEmpty title="没有符合条件的待裁决代码" hint="换个筛选试试，或切到“全部待裁决”。" />
      ) : (
        <DbTable
          columns={[
            { label: '', className: 'w-8' },
            { label: '代码' },
            { label: '源名称', className: 'min-w-36' },
            { label: '候选（点选）', className: 'min-w-64' },
          ]}
        >
          <tr className="border-line-subtle border-b">
            <td className="px-2 py-1.5" colSpan={4}>
              <label className="text-fg-muted flex items-center gap-2 text-caption">
                <input type="checkbox" className="accent-brand size-3.5" checked={allOn} onChange={toggleAll} />
                全选当前列出的 {rows.length} 条
              </label>
            </td>
          </tr>
          {rows.map((r) => {
            const cur = pick(r)
            return (
              <DbRow key={r.id} className={cn(selected.has(r.id) && 'bg-surface-selected')}>
                <DbCell>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${r.code}`}
                    className="accent-brand size-3.5"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </DbCell>
                <DbCell className="font-mono whitespace-nowrap">{r.code}</DbCell>
                <DbCell>{r.source_name ?? <span className="text-fg-disabled">—</span>}</DbCell>
                <DbCell className="py-1.5">
                  {(r.suggestions ?? []).length === 0 ? (
                    <span className="text-fg-disabled">没有候选，可用“统一解释”处理</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {(r.suggestions ?? []).map((s) => {
                        const on = cur !== null && keyOf(cur) === keyOf(s)
                        return (
                          <button
                            key={keyOf(s)}
                            type="button"
                            onClick={() => setChosen({ ...chosen, [r.id]: on ? null : s })}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs transition-colors',
                              on ? 'border-brand bg-brand-soft text-fg-strong' : 'border-line hover:bg-surface-hover text-fg-secondary',
                            )}
                            title={on ? '再点一次取消' : '选定这个对象'}
                          >
                            <span className="text-fg-muted">{s.target_type === 'department' ? '部门' : '单元'}</span>
                            {s.name}
                            {s.campus_name && <span className="text-fg-muted">· {s.campus_name}</span>}
                            <Tag tone={MATCH[s.match].tone} className="h-auto text-caption">
                              {MATCH[s.match].label}
                            </Tag>
                          </button>
                        )
                      })}
                    </span>
                  )}
                </DbCell>
              </DbRow>
            )
          })}
        </DbTable>
      )}

      {/* 选中后出现的操作条：贴在视口底部，移动端也可点 */}
      {picked.length > 0 && (
        <div className="bg-surface-raised border-line sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 shadow-md">
          <span className="text-fg-secondary text-xs">
            已选 <span className="text-fg-strong font-medium">{picked.length}</span> 条，其中 {ready.length} 条已选定对象
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              清除选择
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('uniform')}>
              统一解释为…
            </Button>
            <Button size="sm" disabled={ready.length === 0} onClick={() => setDialog('chosen')}>
              按选定对象生成申请（{ready.length}）
            </Button>
          </span>
        </div>
      )}

      {dialog === 'chosen' && (
        <ChosenDialog open onOpenChange={(o) => !o && setDialog(null)} rows={ready.map((r) => ({ row: r, target: pick(r)! }))} />
      )}
      {dialog === 'uniform' && <UniformDialog open onOpenChange={(o) => !o && setDialog(null)} rows={picked} />}
    </div>
  )
}

function assignItem(r: ExternalCodeRow, validFrom: string, evidence: string | null, target: Partial<ChangeItemInput>): ChangeItemInput {
  return {
    kind: 'external_code.assign',
    system_code: r.system_code,
    namespace_code: r.namespace_code,
    external_code: r.code,
    valid_from: validFrom,
    evidence_note: evidence,
    ...target,
  } as ChangeItemInput
}

function ChosenDialog({ rows, ...props }: DialogProps & { rows: { row: ExternalCodeRow; target: CodeSuggestion }[] }) {
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [evidence, setEvidence] = useState('')
  const count = (m: CodeSuggestion['match']) => rows.filter((x) => x.target.match === m).length
  return (
    <ItemDialog
      {...props}
      title={`按选定对象裁决 ${rows.length} 个代码`}
      description="每个代码生成一条解释，指向它这一行选定的部门或服务单元。判定说明会自动写上匹配依据（如“源名称与部门名称相同”），可再补充。"
      note={`批量裁决外部代码 ${rows.length} 条（按源名称候选）`}
      submitLabel={`生成 ${rows.length} 项`}
      build={() =>
        requireFields([['valid_from', !!validFrom, '请选择开始日']]) ??
        rows.map(({ row, target }) =>
          assignItem(
            row,
            validFrom,
            [`批量裁决：源名称“${row.source_name ?? ''}”与候选${MATCH[target.match].label === '包含' ? '（源名称包含对象名称）' : `（${MATCH[target.match].label}）`}`, evidence.trim()].filter(Boolean).join('；'),
            target.target_type === 'department'
              ? { target_type: 'department', department_code: target.code }
              : { target_type: 'service_unit', service_unit_code: target.code },
          ),
        )
      }
    >
      <p className="text-fg-secondary text-xs">
        {(['exact', 'alias', 'former_name', 'contains', 'similar'] as const)
          .filter((m) => count(m) > 0)
          .map((m) => `${MATCH[m].label} ${count(m)} 条`)
          .join('、')}
      </p>
      <TextField
        label="开始日"
        name="valid_from"
        type="date"
        required
        value={validFrom}
        onChange={setValidFrom}
        hint="开始日可以在过去；不能早于所指对象的设立日或开设日（不满足的那一项会在提交前列出）"
      />
      <TextField label="补充判定说明" value={evidence} onChange={setEvidence} placeholder="选填，如：经信息科核对 HIS 字典" />
    </ItemDialog>
  )
}

function UniformDialog({ rows, ...props }: DialogProps & { rows: ExternalCodeRow[] }) {
  const { asOf } = useApp()
  const [target, setTarget] = useState<'department' | 'service_unit' | 'unmodeled'>('service_unit')
  const [dept, setDept] = useState('')
  const [unit, setUnit] = useState('')
  const [unmodeled, setUnmodeled] = useState('')
  const [validFrom, setValidFrom] = useEffectiveDate()
  const [evidence, setEvidence] = useState('')
  return (
    <ItemDialog
      {...props}
      title={`统一解释 ${rows.length} 个代码`}
      description="把所选代码都解释为同一个对象。例如同一科室的多个专家号别都标识同一个门诊单元；或者它们标识的是平台尚未建模的对象。"
      note={`批量裁决外部代码 ${rows.length} 条（统一解释）`}
      submitLabel={`生成 ${rows.length} 项`}
      build={() =>
        requireFields([
          ['department', target !== 'department' || !!dept, '请选择部门'],
          ['unit', target !== 'service_unit' || !!unit, '请选择服务单元'],
          ['unmodeled', target !== 'unmodeled' || !!unmodeled, '请选择对象类别'],
          ['valid_from', !!validFrom, '请选择开始日'],
          ['evidence', !!evidence.trim(), '统一解释请写明判定依据'],
        ]) ??
        rows.map((r) =>
          assignItem(
            r,
            validFrom,
            evidence.trim(),
            target === 'department'
              ? { target_type: 'department', department_code: dept }
              : target === 'service_unit'
                ? { target_type: 'service_unit', service_unit_code: unit }
                : { target_type: 'unmodeled', unmodeled_type: unmodeled as never },
          ),
        )
      }
    >
      <p className="text-fg-secondary text-xs">
        所选：{rows.slice(0, 6).map((r) => r.source_name ?? r.code).join('、')}
        {rows.length > 6 && ` 等 ${rows.length} 个`}
      </p>
      <SelectField
        label="解释为"
        required
        value={target}
        onChange={(v) => setTarget(v as typeof target)}
        options={[
          { value: 'service_unit', label: '服务单元' },
          { value: 'department', label: '部门' },
          { value: 'unmodeled', label: '对象未建模（不进导出）' },
        ]}
      />
      {target === 'department' && <DepartmentSelect label="部门" name="department" required value={dept} onChange={setDept} />}
      {target === 'service_unit' && (
        <UnitSelect label="服务单元" name="unit" required value={unit} onChange={setUnit} hint={`列出 ${asOf} 有效或计划中的单元`} />
      )}
      {target === 'unmodeled' && (
        <SelectField
          label="对象类别"
          name="unmodeled"
          required
          value={unmodeled}
          onChange={setUnmodeled}
          placeholder="请选择"
          options={Object.entries(UNMODELED_TYPE).map(([value, label]) => ({ value, label }))}
        />
      )}
      <TextField label="开始日" name="valid_from" type="date" required value={validFrom} onChange={setValidFrom} hint="开始日可以在过去" />
      <TextField label="判定依据" name="evidence" required value={evidence} onChange={setEvidence} placeholder="如：均为心内科专家号别，标识心血管内科门诊单元" />
    </ItemDialog>
  )
}
