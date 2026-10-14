// 引用其他对象的下拉框：只显示名称、只能选择，值是对象代码（变更项按代码引用）。
// 选项 = 查看日期当天可选的已有对象 + 本张草稿里新建的对象（标“本申请新建”），
// 所以“新建部门 + 改挂单元”可以在同一张申请里完成。必须放在 ItemDialog 内使用。
import { useEffect, useRef } from 'react'
import { useListCampuses, useListDepartments, useListInstitutions } from '@/api/generated/master/master'
import { SelectField, type Option } from '@/components/forms/fields'
import { useDraftItems } from '@/components/forms/item-dialog'
import { useApp } from '@/lib/app-context'

const NEW = '（本申请新建）'

interface RefProps {
  label: string
  name: string
  value: string
  onChange: (code: string) => void
  required?: boolean
  hint?: string
  /** 不出现在选项里的代码（如“更换所属部门”时的当前部门） */
  exclude?: string
}

function withExclude(options: Option[], exclude?: string) {
  return exclude ? options.filter((o) => o.value !== exclude) : options
}

/** 所属部门：只列在用部门（停用部门不能被新建或改挂的单元选用） */
export function DepartmentSelect(p: RefProps) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data = [] } = useListDepartments({ as_of: asOf })
  const options: Option[] = [
    ...data.filter((d) => d.status === 'ACTIVE').map((d) => ({ value: d.code, label: d.name })),
    ...draft.flatMap((i) => (i.kind === 'department.create' ? [{ value: i.code, label: `${i.name}${NEW}` }] : [])),
  ]
  return <SelectField {...p} options={withExclude(options, p.exclude)} placeholder="请选择部门" />
}

/** 所属院区：不列已停用的院区 */
export function CampusSelect(p: RefProps) {
  const { asOf } = useApp()
  const draft = useDraftItems()
  const { data = [] } = useListCampuses({ as_of: asOf })
  const options: Option[] = [
    ...data.filter((c) => c.version.operating_status !== 'SUSPENDED').map((c) => ({ value: c.code, label: c.version.name })),
    ...draft.flatMap((i) => (i.kind === 'campus.create' ? [{ value: i.code, label: `${i.fields.name}${NEW}` }] : [])),
  ]
  return <SelectField {...p} options={withExclude(options, p.exclude)} placeholder="请选择院区" />
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
