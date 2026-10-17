// 引用其他对象的下拉框：只显示名称、只能选择，值是对象代码（变更项按代码引用）。
// 选项 = 查看日期当天可选的已有对象 + 本张草稿里新建的对象（标“本申请新建”），
// 所以“新建部门 + 改挂单元”可以在同一张申请里完成。必须放在 ItemDialog 内使用。
import { useEffect, useRef, useState } from 'react'
import { useListCampuses, useListDepartments, useListInstitutions, useListServiceUnits } from '@/api/generated/master/master'
import { SelectField, type Option } from '@/components/forms/fields'
import { useDraftItems } from '@/components/forms/item-dialog'
import { useApp } from '@/lib/app-context'
import { DEPARTMENT_LIFECYCLE } from '@/lib/format'

const NEW = '（本申请新建）'

interface RefProps {
  label: string
  name: string
  value: string
  onChange: (code: string) => void
  required?: boolean
  hint?: string
  /** 不出现在选项里的代码（如“更换所属部门”时的当前部门、调整上级时的本部门与下级） */
  exclude?: string | string[]
  /** 空选项的文字；默认“请选择…” */
  placeholder?: string
}

/** 还未生效的对象在名称后标出开始日，提示“可以选，但开始日不能早于这天” */
function since(row: { not_yet_effective: boolean; version: { valid_from: string } }) {
  return row.not_yet_effective ? `（${row.version.valid_from} 起）` : ''
}

function withExclude(options: Option[], exclude?: string | string[]) {
  const set = new Set(Array.isArray(exclude) ? exclude : exclude ? [exclude] : [])
  return options.filter((o) => !set.has(o.value))
}

/** 所属部门：不列撤销、被替代的部门；非正式履职的部门标出生命周期 */
export function DepartmentSelect(p: RefProps) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data = [] } = useListDepartments({ as_of: asOf })
  const options: Option[] = [
    // 撤销、被替代的部门不能被选用；筹备、暂停的可以选，单元期间是否成立由后端按生命周期期间校验
    ...data
      .filter((d) => !['REVOKED', 'SUPERSEDED'].includes(d.version.lifecycle))
      .map((d) => ({
        value: d.code,
        label:
          (d.version.lifecycle === 'ACTIVE' ? d.version.name : `${d.version.name}（${DEPARTMENT_LIFECYCLE[d.version.lifecycle]}）`) +
          since(d),
      })),
    ...draft.flatMap((i) => (i.kind === 'department.create' ? [{ value: i.code, label: `${i.name}${NEW}` }] : [])),
  ]
  const shown = withExclude(options, p.exclude)
  const hint =
    shown.length === 0 ? '没有可选的部门。要改挂到新部门：先新建部门保存到草稿，再在这里把“加入变更申请”选为那张草稿' : p.hint
  return <SelectField {...p} hint={hint} options={shown} placeholder={p.placeholder ?? '请选择部门'} />
}

/** 所属院区：不列已停用的院区 */
export function CampusSelect(p: RefProps) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data = [] } = useListCampuses({ as_of: asOf })
  const options: Option[] = [
    ...data
      .filter((c) => c.version.operating_status !== 'SUSPENDED')
      .map((c) => ({ value: c.code, label: c.version.name + since(c) })),
    ...draft.flatMap((i) => (i.kind === 'campus.create' ? [{ value: i.code, label: `${i.fields.name}${NEW}` }] : [])),
  ]
  return <SelectField {...p} options={withExclude(options, p.exclude)} placeholder={p.placeholder ?? '请选择院区'} />
}

/**
 * 所属运营主体。给了 campusCode 且用户还没手动改过时，自动带出该院区的主要运营方；
 * 只有一个主体时直接选中它（绝大多数情况）。
 */
export function InstitutionSelect({ campusCode, ...p }: RefProps & { campusCode?: string }) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf })
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const options: Option[] = [
    ...institutions.map((i) => ({ value: i.code, label: i.version.name })),
    ...draft.flatMap((i) => (i.kind === 'institution.create' ? [{ value: i.code, label: `${i.fields.name}${NEW}` }] : [])),
  ]

  const primaryOf = (campus: string): string | undefined =>
    campuses.find((c) => c.code === campus)?.primary_operator?.code ??
    draft.flatMap((i) =>
      i.kind === 'operator_relation.create' && i.campus_code === campus && i.is_primary ? [i.institution_code] : [],
    )[0]

  // 用户手动选过之后不再自动覆盖；打开时已有值（如重新绑定带出当前主体）也不覆盖，除非院区改了
  const manual = useRef(false)
  const initialCampus = useRef(campusCode)
  const { onChange } = p
  const suggested = (campusCode && primaryOf(campusCode)) || (options.length === 1 ? options[0].value : '')
  const mayFill = !p.value || campusCode !== initialCampus.current
  useEffect(() => {
    if (!manual.current && mayFill && suggested && suggested !== p.value) onChange(suggested)
  }, [suggested, mayFill, p.value, onChange])

  const isAuto = !manual.current && !!p.value && p.value === suggested
  return (
    <SelectField
      {...p}
      onChange={(v) => {
        manual.current = true
        onChange(v)
      }}
      options={withExclude(options, p.exclude)}
      placeholder="请选择运营主体"
      hint={p.hint ?? (isAuto && campusCode ? '已按所属院区带出主要运营方，可改选' : undefined)}
    />
  )
}

/** 服务单元：查看日期当天有效或计划中的单元（给了 day 则为该日有效的），名称后附院区，便于区分同名单元 */
export function UnitSelect({ day, ...p }: RefProps & { day?: string }) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  // day：按某个业务日期列出当天有效的单元（如合并时前身须在生效日前一天仍有效）；默认查看日期
  const { data = [] } = useListServiceUnits(day ? { as_of: day, include_future: false } : { as_of: asOf })
  const options: Option[] = [
    ...data.map((u) => ({ value: u.code, label: `${u.version.name}（${u.version.campus_name}）` })),
    ...draft.flatMap((i) => (i.kind === 'service_unit.create' ? [{ value: i.code, label: `${i.fields.name}${NEW}` }] : [])),
  ]
  return <SelectField {...p} options={withExclude(options, p.exclude)} placeholder={p.placeholder ?? '请选择服务单元'} />
}

type Starting = { name: string; day: string }

/**
 * 所引用对象中最晚开始的那个（只看还未生效的、以及本申请新建的）。
 * 未来才生效的院区、部门现在就能挂单元、建关系——系统里登记的时间与业务生效日是两回事——
 * 只是开始日不能早于它们的开始日。
 */
function useLatestStart(refs: { campus?: string; department?: string; institution?: string }): Starting | null {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data: campuses = [] } = useListCampuses({ as_of: asOf })
  const { data: departments = [] } = useListDepartments({ as_of: asOf })
  const { data: institutions = [] } = useListInstitutions({ as_of: asOf })
  const found: Starting[] = []
  const pick = (rows: { code: string; not_yet_effective: boolean; version: { name: string; valid_from: string } }[], code?: string) => {
    const r = code && rows.find((x) => x.code === code)
    if (r && r.not_yet_effective) found.push({ name: r.version.name, day: r.version.valid_from })
  }
  pick(campuses, refs.campus)
  pick(departments, refs.department)
  pick(institutions, refs.institution)
  for (const i of draft) {
    if (i.kind === 'campus.create' && i.code === refs.campus) found.push({ name: i.fields.name, day: i.valid_from })
    if (i.kind === 'department.create' && i.code === refs.department && i.valid_from) found.push({ name: i.name, day: i.valid_from })
    if (i.kind === 'institution.create' && i.code === refs.institution) found.push({ name: i.fields.name, day: i.valid_from })
  }
  return found.sort((a, b) => b.day.localeCompare(a.day))[0] ?? null
}

/**
 * 开始日不早于所引用对象的开始日：选了未来生效的院区或部门时，把开始日推到那天并说明原因。
 * 只在所选对象变化时调整一次，之后用户仍可改（改早了由后端说明）。返回字段下方的提示。
 */
export function useStartFloor(
  day: string,
  setDay: (d: string) => void,
  refs: { campus?: string; department?: string; institution?: string },
): string | undefined {
  const latest = useLatestStart(refs)
  const key = latest ? `${latest.name}@${latest.day}` : ''
  const [moved, setMoved] = useState<string>('')
  useEffect(() => {
    if (latest && day < latest.day) {
      setDay(latest.day)
      setMoved(key)
    }
    // 只在所引用对象变化时调整
  }, [key])
  if (!latest) return undefined
  return `${latest.name}自 ${latest.day} 起才有记录，开始日不能早于这天${moved === key ? '，已自动调整' : ''}；现在登记，到日自动生效`
}
