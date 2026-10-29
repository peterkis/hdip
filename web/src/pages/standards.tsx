// 标准资料库（F0 / F1 / F2 第一批，docs/标准资料库-F0F1开发计划.md、标准资料库-F2开发计划.md）：外部标准原文的只读参考。
// 标准资料（每行一份结构化文档修订）→ 条目（数据元、值域表、代码）→ 出处与原记录。
// 写入只经本地导入命令；页面没有编辑、采用、发布动作。引用按原文显示：原文未写年份时只说“按本库目录定位”，
// 不写成原文指定了该年份；原文写明的年份本库没有收录时显示未解析，其他年份另列、不等价。
// 读取器版本是本系统的“处理修订”，不是标准版本：列表默认只给当前处理修订，历史处理修订按链接仍可打开。
import { Book02Icon, Calendar03Icon, HashtagIcon, TextFontIcon } from '@hugeicons/core-free-icons'
import { keepPreviousData } from '@tanstack/react-query'
import { useDeferredValue, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import type {
  DocumentRef,
  Evidence,
  ProvenanceSourceIssuesItem,
  ReferenceOut,
  ReferenceTarget,
  SearchStandardEntriesParams,
  StandardDocumentRow,
  StandardEntryDetail,
  StandardEntryRow,
} from '@/api/generated/model'
import {
  useGetStandardDocument,
  useGetStandardEntry,
  useListStandardDocuments,
  useSearchStandardEntries,
} from '@/api/generated/standards/standards'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox, ToggleChip } from '@/components/kit/database'
import { DetailFallback } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { Section } from '@/components/kit/section'
import { Segmented } from '@/components/kit/segmented'
import { Tag, type Tone } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { stamp } from '@/lib/format'
import { scrollBehavior } from '@/lib/utils'
import { isString, useListReturn, useReturnState } from '@/lib/scroll-memory'

const TYPE_LABEL: Record<StandardEntryRow['entry_type'], string> = {
  data_element: '数据元',
  value_domain: '值域表',
  code_row: '代码',
}

/** 标准号与原文年份：“WS/T 363.3—2023”；年份是原文年份，不是整理或导入年份 */
export function standardLabel(no: string, year?: string | null) {
  return year ? `${no}—${year}` : no
}

export function entryPath(id: number) {
  return `/standards/library/entries/${id}`
}

/** 处理修订：读取器版本，不是标准版本 */
function revisionLabel(d: { reader_version: string }) {
  return `读取器 v${d.reader_version}`
}

function RevisionTag({ d }: { d: { is_current: boolean } }) {
  return d.is_current ? <Tag tone="gray">当前处理修订</Tag> : <Tag tone="yellow">历史处理修订</Tag>
}

/** 历史处理修订的提示：存在更新的处理修订（不是新版标准） */
function NewerRevision({ newer, what }: { newer?: DocumentRef | null; what: string }) {
  if (!newer) return null
  return (
    <Callout tone="warning" title={`存在更新的处理修订 v${newer.reader_version}`} className="mb-6">
      这是历史处理修订里的{what}，保留供查阅。同一来源文档已由 {revisionLabel(newer)} 重新整理：
      <Link className="text-fg-strong hover:underline" to={`/standards/library/${newer.id}`}>
        {standardLabel(newer.standard_no, newer.standard_year)}（{revisionLabel(newer)}）
      </Link>
      。读取器版本是本库的处理修订，不是标准版本；标准原文年份不变。
    </Callout>
  )
}

// ---------------------------------------------------------------- 标准资料列表

export function StandardDocumentsPage() {
  usePageFrame('work')
  const [params, setParams] = useSearchParams()
  const all = params.get('history') === '1'
  const list = useListStandardDocuments(all ? { include_superseded: true } : undefined)
  const status = readStatus(list)
  const rows = (status === 'ready' ? list.data : undefined) ?? []
  const back = useListReturn({ scope: `standards|${all}`, ready: status === 'ready' })
  return (
    <>
      <PageHeader
        title="标准资料"
        description="已收录的卫生信息标准结构化资料，供查阅原文定义、值域与出处。只读参考：不表示医院已采用，也不判断院内数据是否合规。"
      />
      <DbToolbar>
        <ToggleChip
          label="显示历史处理修订"
          checked={all}
          onChange={(v) => setParams(v ? { history: '1' } : {}, { replace: true })}
        />
      </DbToolbar>
      <StaleNotice what="标准资料" query={list} />
      {status === 'loading' ? (
        <ReadLoading label="正在读取标准资料…" />
      ) : status === 'error' ? (
        <ReadError what="标准资料" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty title="还没有收录标准资料" hint="标准资料由维护人用本地导入命令读入（api/scripts/import_standards.py）。" />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <DbTable
            columns={[
              { label: '标准', icon: Book02Icon, className: 'min-w-40' },
              { label: '已接入', icon: HashtagIcon },
              { label: '接入覆盖' },
              { label: '来源包', className: 'min-w-48' },
              { label: '处理修订' },
            ]}
          >
            {rows.map((d) => (
              <DbRow key={d.id} returnId={d.id}>
                <DbCell>
                  <Link className="text-fg-strong font-medium hover:underline" to={`/standards/library/${d.id}`}>
                    {standardLabel(d.standard_no, d.standard_year)}
                  </Link>
                  {d.title && <div className="text-fg-muted text-caption">{d.title}</div>}
                </DbCell>
                <DbCell className="text-fg-secondary whitespace-nowrap">
                  <Counts counts={d.counts} />
                </DbCell>
                <DbCell className="whitespace-nowrap">
                  <Coverage d={d} />
                </DbCell>
                <DbCell className="text-fg-secondary text-caption break-all">{d.package_file}</DbCell>
                <DbCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-fg-secondary text-caption">{revisionLabel(d)}</span>
                    {all && <RevisionTag d={d} />}
                  </span>
                </DbCell>
              </DbRow>
            ))}
          </DbTable>
        </div>
      )}
      <DbFooter>
        <span>
          共 <span className="text-fg-secondary">{status === 'ready' ? rows.length : <Unknown reason="标准资料尚未读取成功" />}</span> 份结构化资料
        </span>
        <span>
          {all ? '同一来源文档的各个处理修订分别成行' : '只列当前处理修订'}；接入覆盖 = 已读入的源记录 / 所读成员里该标准的源记录
        </span>
      </DbFooter>
    </>
  )
}

function Counts({ counts }: { counts: Record<string, number> }) {
  const parts = (Object.keys(TYPE_LABEL) as StandardEntryRow['entry_type'][])
    .filter((t) => counts[t])
    .map((t) => `${TYPE_LABEL[t]} ${counts[t]}`)
  return <>{parts.length ? parts.join(' · ') : '—'}</>
}

function Coverage({ d }: { d: StandardDocumentRow }) {
  const full = d.covered_keys >= d.total_records
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">
        {d.covered_keys} / {d.total_records}
      </span>
      <Tag tone={full ? 'green' : 'yellow'}>{full ? '全部接入' : '部分接入'}</Tag>
    </span>
  )
}

// ---------------------------------------------------------------- 标准资料详情

export function StandardDocumentDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const query = useGetStandardDocument(id, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  useCrumb(data && !isDenial(query.error) ? standardLabel(data.standard_no, data.standard_year) : null)
  if (!data || isDenial(query.error))
    return <DetailFallback what="标准资料" back={{ to: '/standards/library', label: '返回标准资料' }} query={query} invalid={!Number.isInteger(id)} />
  const p = data.package
  return (
    <>
      <PageHeader
        title={standardLabel(data.standard_no, data.standard_year)}
        meta={
          <>
            {revisionLabel(data)} · {data.is_current ? '当前处理修订' : '历史处理修订'} · 导入于 {stamp(data.imported_at)}
          </>
        }
      />
      <StaleNotice what="这份标准资料" query={query} />
      <NewerRevision newer={data.newer_revision} what="结构化资料" />
      <PropertyList
        items={[
          { label: '标准号', icon: Book02Icon, value: data.standard_no },
          { label: '原文年份', icon: Calendar03Icon, value: data.standard_year },
          { label: '已接入', value: <Counts counts={data.counts} /> },
          { label: '接入覆盖', value: <Coverage d={data} /> },
          {
            label: '处理修订',
            value: (
              <ul className="grid gap-1">
                {data.revisions.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                    {r.id === data.id ? (
                      <span className="text-fg-strong">{revisionLabel(r)}（本页）</span>
                    ) : (
                      <Link className="text-fg-secondary hover:underline" to={`/standards/library/${r.id}`}>
                        {revisionLabel(r)}
                      </Link>
                    )}
                    <RevisionTag d={r} />
                  </li>
                ))}
              </ul>
            ),
          },
          { label: '原文版本标记', value: data.source_version && <span className="font-mono">{data.source_version}</span> },
          { label: '原文件摘要', value: data.source_sha256 && <span className="font-mono text-caption break-all">{data.source_sha256}</span> },
          {
            label: '官方原文',
            value: data.source_url && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <a className="text-fg-secondary break-all hover:underline" href={data.source_url} target="_blank" rel="noreferrer">
                  {data.source_url}
                </a>
                <Tag tone="gray">外部链接 · 未核实可访问</Tag>
              </span>
            ),
          },
        ]}
      />
      <div className="mt-8 grid gap-8">
        <Section title="来源包">
          <PropertyList
            items={[
              { label: '文件', value: <span className="break-all">{p.file_name}</span> },
              { label: '大小', value: `${p.bytes.toLocaleString()} 字节 · ${p.member_count} 个成员` },
              {
                label: '摘要核对',
                value: (
                  <span className="grid gap-1">
                    <span className="font-mono text-caption break-all">{p.sha256}</span>
                    {p.sha_check === 'matched' ? (
                      <Tag tone="green" className="justify-self-start">与清单摘要一致</Tag>
                    ) : (
                      <Tag tone="gray" className="justify-self-start">未与清单摘要比对</Tag>
                    )}
                  </span>
                ),
              },
              { label: '发布清单', value: p.release_id && <span className="font-mono">{p.release_id}</span> },
              {
                label: '来源链接',
                value: p.source_url && (
                  <a className="text-fg-secondary break-all hover:underline" href={p.source_url} target="_blank" rel="noreferrer">
                    {p.source_url}
                  </a>
                ),
              },
              { label: '保存位置', value: <span className="font-mono text-caption break-all">{p.stored_path}</span> },
              {
                label: '读取的成员',
                value: (
                  <ul className="grid gap-1">
                    {data.members.map((m) => (
                      <li key={String(m.path)} className="font-mono text-caption break-all">
                        {String(m.path)}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </Section>
        <Section title="已接入的条目">
          <EntryBrowser
            fixed={{ document_id: data.id, top_level: true }}
            scopeKey={`doc|${data.id}`}
            what="条目"
            placeholder="名称或 DE / CV 编号"
            columns="document"
            footnote="数据元与值域表；代码行在所属值域表里查看"
          />
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 数据元检索

export function DataElementsPage() {
  usePageFrame('work')
  return (
    <>
      <PageHeader
        title="数据元"
        description="按名称或数据元标识符查找标准原文中的数据元，查看定义、类型、表示格式与允许值，以及它引用的值域和出处。"
      />
      <EntryBrowser
        fixed={{ entry_type: 'data_element' }}
        scopeKey="de"
        what="数据元"
        placeholder="名称或 DE 编号，如“身份证件类别”“DE02.01.031.00”"
        columns="search"
        filters="data_element"
        footnote="只列当前处理修订；DE 编号只是检索标识，同一编号在不同标准版本里各是一条"
      />
    </>
  )
}

// ---------------------------------------------------------------- 值域与代码

export function ValueDomainsPage() {
  usePageFrame('work')
  const [params, setParams] = useSearchParams()
  const codes = params.get('tab') === 'codes'
  const setTab = (v: 'tables' | 'codes') => {
    const next = new URLSearchParams(params)
    if (v === 'codes') next.set('tab', 'codes')
    else next.delete('tab')
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeader
        title="值域与代码"
        description="按值域名称或 CV 编号查找值域表，进入后按原顺序查看代码、含义、出处与原记录；也可以直接按码值或代码名称检索。"
      />
      <div className="mb-3">
        <Segmented
          label="检索对象"
          value={codes ? 'codes' : 'tables'}
          onChange={setTab}
          options={[
            { value: 'tables', label: '值域表' },
            { value: 'codes', label: '代码' },
          ]}
        />
      </div>
      {codes ? (
        <EntryBrowser
          key="codes"
          fixed={{ entry_type: 'code_row' }}
          scopeKey="codes"
          what="代码"
          placeholder="码值或代码名称，如“01”“护照”"
          columns="codes"
          filters="value_domain"
          footnote="不同值域表里的相同码值各是一行，不合并；含义以所属值域表为准"
        />
      ) : (
        <EntryBrowser
          key="tables"
          fixed={{ entry_type: 'value_domain' }}
          scopeKey="cv"
          what="值域表"
          placeholder="值域名称或 CV 编号，如“身份证件类别”“CV02.01.101”"
          columns="search"
          filters="value_domain"
          footnote="只列当前处理修订；CV 编号只是检索标识"
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------- 条目列表（服务端筛选、计数、分页）

const PAGE = 50
type Paging = { scope: string; offset: number }
const isPaging = (v: unknown): v is Paging =>
  !!v && typeof v === 'object' && isString((v as Paging).scope) && Number.isInteger((v as Paging).offset) && (v as Paging).offset >= 0

/**
 * 条目列表：检索词、标准 / 分册 / 原文年份筛选都交给服务端，在计数与分页之前生效；总数是匹配总数。
 * 筛选写在网址里（可分享），检索词与页码是本页状态（从详情返回时恢复）；集合条件一变就回到第一页。
 */
function EntryBrowser({
  fixed,
  scopeKey,
  what,
  placeholder,
  columns,
  filters,
  footnote,
}: {
  fixed: SearchStandardEntriesParams
  scopeKey: string
  what: string
  placeholder: string
  columns: 'search' | 'codes' | 'document'
  filters?: 'data_element' | 'value_domain'
  footnote: string
}) {
  const [params, setParams] = useSearchParams()
  const series = filters ? (params.get('series') ?? '') : ''
  const part = filters ? (params.get('part') ?? '') : ''
  const year = filters ? (params.get('year') ?? '') : ''
  const [query, setQuery] = useReturnState('q', '', isString)
  const q = useDeferredValue(query.trim())
  const scope = `${scopeKey}|${series}|${part}|${year}|${q}`
  const [paging, setPaging] = useReturnState('paging', { scope, offset: 0 }, isPaging)
  if (paging.scope !== scope) setPaging({ scope, offset: 0 })
  const offset = paging.scope === scope ? paging.offset : 0
  // 翻页后回到列表顶部，从新一页的第一条读起
  const goto = (next: number) => {
    setPaging({ scope, offset: next })
    document.querySelector('main')?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }

  const docs = useListStandardDocuments(undefined, { query: { enabled: !!filters } })
  const docsStatus = readStatus(docs)
  const withType = (docs.data ?? []).filter((d) => !filters || (d.counts[filters] ?? 0) > 0)
  const uniq = (xs: string[]) => [...new Set(xs)]
  const seriesOptions = uniq(withType.map((d) => d.series)).map((v) => ({ value: v, label: v }))
  const partOptions = uniq(withType.filter((d) => !series || d.series === series).map((d) => d.standard_no)).map((v) => ({ value: v, label: v }))
  const yearOptions = uniq(withType.map((d) => d.standard_year).filter(isString)).map((v) => ({ value: v, label: v }))
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k === 'series') next.delete('part')
    setParams(next, { replace: true })
  }

  const list = useSearchStandardEntries(
    {
      ...fixed,
      ...(q && { q }),
      ...(series && { series }),
      ...(part && { standard_no: part }),
      ...(year && { standard_year: year }),
      offset,
      limit: PAGE,
    },
    { query: { placeholderData: keepPreviousData } },
  )
  const status = readStatus(list)
  const page = status === 'ready' ? list.data : undefined
  const rows = page?.items ?? []
  const total = page?.total ?? 0
  const back = useListReturn({ scope, ready: status === 'ready', local: { q: query, paging } })
  const filtered = !!(q || series || part || year)
  return (
    <>
      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder={placeholder} />}>
        {filters && (
          <>
            <FilterPill label="标准" icon={Book02Icon} value={series} onChange={(v) => set('series', v)} options={seriesOptions} optionsStatus={docsStatus} />
            <FilterPill label="分册" value={part} onChange={(v) => set('part', v)} options={partOptions} optionsStatus={docsStatus} />
            <FilterPill label="原文年份" icon={Calendar03Icon} value={year} onChange={(v) => set('year', v)} options={yearOptions} optionsStatus={docsStatus} />
          </>
        )}
      </DbToolbar>
      <StaleNotice what={what} query={list} />
      {status === 'loading' ? (
        <ReadLoading label={`正在查找${what}…`} />
      ) : status === 'error' ? (
        <ReadError what={what} query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty
          title={filtered ? `没有符合条件的${what}` : `还没有接入${what}`}
          hint="这里只列已接入的条目；尚未接入的分册与记录见“标准资料”的接入覆盖。"
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <EntryTable rows={rows} columns={columns} />
        </div>
      )}
      <DbFooter>
        <span>
          {status === 'ready' ? (
            total > 0 ? (
              <>
                第 <span className="text-fg-secondary tabular-nums">{offset + 1}–{offset + rows.length}</span> 条，共{' '}
                <span className="text-fg-secondary tabular-nums">{total}</span> 个{what}
              </>
            ) : (
              <>共 0 个{what}</>
            )
          ) : (
            <Unknown reason={`${what}尚未读取成功`} />
          )}
        </span>
        {status === 'ready' && total > PAGE && (
          <span className="inline-flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => goto(Math.max(0, offset - PAGE))}>
              上一页
            </Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE >= total} onClick={() => goto(offset + PAGE)}>
              下一页
            </Button>
          </span>
        )}
        <span>{footnote}</span>
      </DbFooter>
    </>
  )
}

function EntryTable({ rows, columns }: { rows: StandardEntryRow[]; columns: 'search' | 'codes' | 'document' }) {
  if (columns === 'codes')
    return (
      <DbTable
        columns={[
          { label: '码值', icon: HashtagIcon },
          { label: '名称', icon: TextFontIcon, className: 'min-w-32' },
          { label: '所属值域表', className: 'min-w-48' },
          { label: '所属标准', icon: Book02Icon },
        ]}
      >
        {rows.map((e) => (
          <DbRow key={e.id} returnId={e.id}>
            <DbCell className="font-mono whitespace-nowrap">
              <Link className="text-fg-strong font-medium hover:underline" to={entryPath(e.id)}>
                {e.identifier}
              </Link>
            </DbCell>
            <DbCell>{e.name}</DbCell>
            <DbCell>
              {e.parent && (
                <Link className="text-fg-secondary hover:underline" to={entryPath(e.parent.id)}>
                  <span className="font-mono text-caption">{e.parent.identifier}</span> {e.parent.name}
                </Link>
              )}
            </DbCell>
            <DbCell className="text-fg-secondary whitespace-nowrap">{standardLabel(e.document.standard_no, e.document.standard_year)}</DbCell>
          </DbRow>
        ))}
      </DbTable>
    )
  return (
    <DbTable
      columns={[
        { label: '名称', icon: TextFontIcon, className: 'min-w-40' },
        { label: '标识', icon: HashtagIcon },
        ...(columns === 'document' ? [{ label: '类型' }] : [{ label: '所属标准', icon: Book02Icon }]),
      ]}
    >
      {rows.map((e) => (
        <DbRow key={e.id} returnId={e.id}>
          <DbCell>
            <Link className="text-fg-strong font-medium hover:underline" to={entryPath(e.id)}>
              {e.name ?? '（无名称）'}
            </Link>
          </DbCell>
          <DbCell className="text-fg-secondary font-mono text-caption whitespace-nowrap">{e.identifier}</DbCell>
          {columns === 'document' ? (
            <DbCell className="whitespace-nowrap">
              <Tag tone="gray">{TYPE_LABEL[e.entry_type]}</Tag>
            </DbCell>
          ) : (
            <DbCell className="text-fg-secondary whitespace-nowrap">{standardLabel(e.document.standard_no, e.document.standard_year)}</DbCell>
          )}
        </DbRow>
      ))}
    </DbTable>
  )
}

// ---------------------------------------------------------------- 条目详情

export function StandardEntryDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const query = useGetStandardEntry(id, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  useCrumb(data && !isDenial(query.error) ? `${data.identifier ?? ''} ${data.name ?? ''}`.trim() : null)
  if (!data || isDenial(query.error))
    return <DetailFallback what="标准条目" back={{ to: '/standards/data-elements', label: '返回数据元' }} query={query} invalid={!Number.isInteger(id)} />
  const doc = data.document
  return (
    <>
      <PageHeader
        title={data.name ?? data.identifier ?? '标准条目'}
        meta={
          <>
            {TYPE_LABEL[data.entry_type]} <span className="font-mono">{data.identifier}</span> ·{' '}
            <Link className="hover:underline" to={`/standards/library/${doc.id}`}>
              {standardLabel(doc.standard_no, doc.standard_year)}
            </Link>{' '}
            · {revisionLabel(doc)} · {doc.is_current ? '当前处理修订' : '历史处理修订'}
          </>
        }
      />
      <StaleNotice what="这个条目" query={query} />
      <NewerRevision newer={data.newer_revision} what={TYPE_LABEL[data.entry_type]} />
      {data.data_element && <DataElementBodyView data={data} />}
      {data.value_domain && <ValueDomainBodyView data={data} />}
      {data.code_row && <CodeRowBodyView data={data} />}
      <div className="mt-8 grid gap-8">
        {data.value_domain && <CodesSection data={data} />}
        {(data.referenced_by ?? []).length > 0 && (
          <Section title={`引用它的条目（${(data.referenced_by ?? []).length}）`}>
            <ul className="grid gap-1.5 text-xs">
              {(data.referenced_by ?? []).map((r) => (
                <li key={r.entry.id} className="flex flex-wrap items-center gap-1.5">
                  <Link className="text-fg-strong hover:underline" to={entryPath(r.entry.id)}>
                    {r.entry.name}
                  </Link>
                  <span className="text-fg-muted font-mono text-caption">{r.entry.identifier}</span>
                  <span className="text-fg-muted">{standardLabel(r.entry.document.standard_no, r.entry.document.standard_year)}</span>
                  <ResolutionTag r={r.resolution} labelCheck={r.label_check} />
                  {r.match_basis === 'prefix_variant' && <Tag tone="gray">来源前缀为 WS</Tag>}
                  <LabelCheckTag c={r.label_check} />
                </li>
              ))}
            </ul>
            <p className="text-fg-muted text-caption">只列同一处理修订里解析到本条的引用；“按目录定位”表示原文未写年份。名称不一致的需人工核对。</p>
          </Section>
        )}
        <ProvenanceSection data={data} />
        <Section title="原记录">
          <details className="border-line-subtle rounded-md border">
            <summary className="text-fg-secondary cursor-pointer px-3 py-2 text-xs">
              展开资料中的原始记录（{data.provenance.member}
              {data.provenance.json_pointer}）
            </summary>
            <pre className="bg-surface-subtle text-fg-secondary max-h-[32rem] overflow-auto px-3 py-2 font-mono text-caption whitespace-pre-wrap break-all">
              {JSON.stringify(data.raw, null, 2)}
            </pre>
          </details>
        </Section>
      </div>
    </>
  )
}

function DataElementBodyView({ data }: { data: StandardEntryDetail }) {
  const b = data.data_element!
  return (
    <PropertyList
      items={[
        { label: '数据元标识符', icon: HashtagIcon, value: <span className="font-mono">{b.identifier}</span> },
        { label: '定义', value: b.definition || null },
        { label: '数据类型', value: b.data_type && <span className="font-mono">{b.data_type}</span> },
        { label: '表示格式', value: b.format && <span className="font-mono">{b.format}</span> },
        {
          label: '允许值',
          value:
            b.allowed_value_nature === 'empty' ? (
              <span className="text-fg-muted">原文未填写</span>
            ) : (
              <div className="grid gap-2">
                <span className="whitespace-pre-line">{b.allowed_values}</span>
                {(data.references ?? []).map((r) => (
                  <ReferenceView key={r.field} r={r} />
                ))}
              </div>
            ),
        },
        { label: '数据元版本', value: b.version },
        { label: '所在章节', value: b.section },
      ]}
    />
  )
}

function ValueDomainBodyView({ data }: { data: StandardEntryDetail }) {
  const b = data.value_domain!
  return (
    <PropertyList
      items={[
        { label: '值域代码', icon: HashtagIcon, value: <span className="font-mono">{b.identifier}</span> },
        { label: '定义', value: b.definition || null },
        { label: '编码结构', value: b.structure || null },
        { label: '原文段落', value: b.definition_raw && <span className="text-fg-secondary whitespace-pre-line">{b.definition_raw}</span> },
      ]}
    />
  )
}

function CodeRowBodyView({ data }: { data: StandardEntryDetail }) {
  const b = data.code_row!
  return (
    <PropertyList
      items={[
        { label: '码值', icon: HashtagIcon, value: <span className="font-mono">{b.code}</span> },
        { label: '名称', value: b.name || null },
        { label: '说明', value: b.description || null },
        {
          label: '所属值域表',
          value: data.parent && (
            <Link className="hover:underline" to={entryPath(data.parent.id)}>
              {data.parent.identifier} {data.parent.name}
            </Link>
          ),
        },
        { label: '层级', value: b.hierarchy_level != null ? `第 ${b.hierarchy_level} 层${b.parent_code ? `，上级 ${b.parent_code}` : ''}` : null },
        {
          label: '原单元格',
          value: b.raw_cells.length > 0 && (
            <span className="font-mono text-caption">
              {b.raw_cells.map((c, i) => (
                <span key={i}>
                  {i > 0 && ' | '}
                  {c ?? <span className="text-fg-muted">（未提供）</span>}
                </span>
              ))}
            </span>
          ),
        },
      ]}
    />
  )
}

function CodesSection({ data }: { data: StandardEntryDetail }) {
  return (
    <Section title={`代码（${(data.codes ?? []).length}）`}>
      <DbTable columns={[{ label: '码值', icon: HashtagIcon }, { label: '名称', icon: TextFontIcon, className: 'min-w-40' }, { label: '说明' }]}>
        {(data.codes ?? []).map((c) => (
          <DbRow key={c.id}>
            <DbCell className="font-mono whitespace-nowrap">
              <Link className="text-fg-strong hover:underline" to={entryPath(c.id)}>
                {c.code}
              </Link>
            </DbCell>
            <DbCell>{c.name}</DbCell>
            <DbCell className="text-fg-secondary">{c.description}</DbCell>
          </DbRow>
        ))}
      </DbTable>
      <p className="text-fg-muted text-caption">码值按原文字符串显示，保留前导零；源记录中重复出现的码值各占一行，不按码值合并。</p>
    </Section>
  )
}

const RESOLUTION: Record<ReferenceOut['resolution'], { label: string; tone: Tone }> = {
  explicit: { label: '原文指定', tone: 'green' },
  catalog: { label: '按目录定位', tone: 'blue' },
  unresolved: { label: '本库未收录', tone: 'gray' },
  candidates: { label: '多个候选', tone: 'orange' },
}

/** 编号定位成功不等于语义匹配：名称不一致时不用成功色，改称“按编号定位” */
function ResolutionTag({ r, labelCheck }: { r: ReferenceOut['resolution']; labelCheck?: ReferenceTarget['label_check'] }) {
  if (labelCheck === 'different' && (r === 'explicit' || r === 'catalog')) return <Tag tone="gray">按编号定位</Tag>
  return <Tag tone={RESOLUTION[r].tone}>{RESOLUTION[r].label}</Tag>
}

function LabelCheckTag({ c }: { c?: ReferenceTarget['label_check'] }) {
  if (c === 'different') return <Tag tone="orange">名称不一致 · 待核对</Tag>
  if (c === 'minor') return <Tag tone="gray">名称写法不同</Tag>
  return null
}

function TargetLink({ t, revision }: { t: ReferenceTarget; revision?: boolean }) {
  return (
    <Link className="text-fg-strong hover:underline" to={entryPath(t.entry_id)}>
      {standardLabel(t.document.standard_no, t.document.standard_year)} {t.identifier} {t.name}
      {revision && <span className="text-fg-muted">（{revisionLabel(t.document)}）</span>}
    </Link>
  )
}

/** 来源引用名称与本库表名称：不一致时并列显示，供人工核对 */
function NamePair({ label, t }: { label?: string | null; t: ReferenceTarget }) {
  if (!label || !t.label_check || t.label_check === 'same') return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-0.5">
      <dt className="text-fg-muted">来源引用名称</dt>
      <dd className="text-fg-secondary">{label}</dd>
      <dt className="text-fg-muted">本库表名称</dt>
      <dd className="text-fg-secondary">{t.name}</dd>
    </dl>
  )
}

const RELATED_TITLE: Record<'other_part' | 'other_revision' | 'prefix_variant_conflict', string> = {
  other_part: '其他分册的同编号表',
  other_revision: '其他处理修订的同标识条目',
  prefix_variant_conflict: '前缀差异的同编号表（名称不一致，未定位）',
}

/** 原文引用的解析：说清楚是原文指定、目录定位还是未收录，不替原文补年份、不改指 */
function ReferenceView({ r }: { r: ReferenceOut }) {
  const cited = standardLabel(r.target_standard, r.target_year) + (r.target_identifier ? ` ${r.target_identifier}` : '')
  const first = r.targets[0]
  const mismatch = r.targets.length === 1 && first.label_check === 'different'
  let note: ReactNode
  if (r.ref_kind === 'external_standard') note = `引用外部规范 ${cited}，本库尚未收录`
  else if (r.identifier_incomplete) note = `原文值域编号不完整（“${r.identifier_as_written ?? ''}”），不解析、不补全`
  else if (mismatch) note = '编号可定位，但来源名称与目标表名称不一致，语义尚未确认'
  else if (r.match_basis === 'prefix_variant' && r.resolution_note) note = r.resolution_note
  else if (r.resolution === 'explicit') note = `原文指定 ${cited}`
  else if (r.resolution === 'catalog') note = `原文未写 ${r.target_standard} 的年份；下面是本库收录的相关版本，不表示原文指定了该年份`
  else if (r.resolution === 'candidates')
    note = r.target_year ? `原文写明 ${r.target_year} 年，本库该年份有多个候选，不自动选择` : '原文未写年份，本库存在多个候选，不自动选择'
  else if ((r.related ?? []).length > 0) note = `按原文 ${cited} 未解析到本库条目；下面的资料只供参考，不是解析结果`
  else note = `本库尚未收录 ${cited}`
  const related = r.related ?? []
  const groups = (['other_part', 'prefix_variant_conflict', 'other_revision'] as const)
    .map((k) => ({ k, items: related.filter((x) => x.kind === k) }))
    .filter((g) => g.items.length > 0)
  return (
    <div className="border-line-subtle bg-surface-subtle grid gap-1.5 rounded-md border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <ResolutionTag r={r.resolution} labelCheck={r.targets.length === 1 ? first.label_check : undefined} />
        {r.match_basis === 'prefix_variant' && <Tag tone="gray">来源前缀为 WS，本库收录为 WS/T</Tag>}
        {r.targets.length === 1 && <LabelCheckTag c={first.label_check} />}
        <span className="text-fg-secondary">{note}</span>
      </div>
      {r.identifier_normalized && (
        <span className="text-fg-muted text-caption">
          原文编号写作“{r.identifier_as_written}”，按 {r.target_identifier} 定位阅读；原文不改。
        </span>
      )}
      {r.targets.map((t) => (
        <div key={t.entry_id} className="grid gap-1">
          <TargetLink t={t} revision={r.resolution === 'candidates'} />
          <NamePair label={r.target_label} t={t} />
        </div>
      ))}
      {(r.other_versions ?? []).length > 0 && (
        <div className="grid gap-1">
          <span className="text-fg-muted text-caption">本库收录的其他年份（仅供阅读，不等价于原文所指版本）</span>
          {(r.other_versions ?? []).map((t) => (
            <TargetLink key={t.entry_id} t={t} />
          ))}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.k} className="border-line-subtle grid gap-1 border-t pt-1.5">
          <span className="text-fg-muted text-caption">
            {RELATED_TITLE[g.k]}：{g.items[0].note}
          </span>
          {g.items.map((x) => (
            <TargetLink key={x.target.entry_id} t={x.target} revision={g.k === 'other_revision'} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 资料记载的问题：文字原样；对象按“键：值”展开成可读文字（原对象在原记录里） */
function IssueText({ issue }: { issue: ProvenanceSourceIssuesItem }) {
  if (typeof issue === 'string') return <>{issue}</>
  return (
    <span className="text-caption">
      {Object.entries(issue).map(([k, v], i) => (
        <span key={k}>
          {i > 0 && '；'}
          <span className="text-fg-muted font-mono">{k}</span>：{typeof v === 'string' ? v : JSON.stringify(v)}
        </span>
      ))}
    </span>
  )
}

const AVAILABILITY: Record<Evidence['availability'], { label: string; tone: Tone }> = {
  in_package: { label: '包内有，暂未提供打开', tone: 'blue' },
  external: { label: '外部链接 · 未核实可访问', tone: 'gray' },
  not_in_package: { label: '未随包提供', tone: 'yellow' },
}

function ProvenanceSection({ data }: { data: StandardEntryDetail }) {
  const p = data.provenance
  const pdfPages = p.pdf_pages ?? []
  const printedPages = p.printed_pages ?? []
  const issues = p.source_issues ?? []
  const evidence = p.evidence ?? []
  return (
    <Section title="出处">
      <PropertyList
        items={[
          { label: '包内成员', value: <span className="font-mono text-caption break-all">{p.member}</span> },
          { label: '记录位置', value: <span className="font-mono text-caption">{p.json_pointer}</span> },
          { label: '源记录 ID', value: p.record_id && <span className="font-mono text-caption break-all">{p.record_id}</span> },
          { label: 'PDF 物理页', value: pdfPages.length > 0 ? pdfPages.join('、') : null },
          { label: '印刷页码', value: printedPages.length > 0 ? printedPages.join('、') : null },
          { label: '表内位置', value: p.table_ref },
          { label: '资料复核状态', value: p.qa_status && <span className="font-mono text-caption">{p.qa_status}</span> },
          { label: '资料导入标记', value: p.import_gate && <span className="font-mono text-caption">{p.import_gate}</span> },
          {
            label: '资料记载的问题',
            value:
              issues.length > 0 ? (
                <ul className="grid gap-1">
                  {issues.map((x, i) => (
                    <li key={i}>
                      <IssueText issue={x} />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-fg-muted">无</span>
              ),
          },
          {
            label: '原件与图证',
            value:
              evidence.length === 0 ? null : (
                <ul className="grid gap-1.5">
                  {evidence.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                      <Tag tone={AVAILABILITY[e.availability].tone}>{AVAILABILITY[e.availability].label}</Tag>
                      {e.url ? (
                        <a className="text-fg-secondary break-all hover:underline" href={e.url} target="_blank" rel="noreferrer">
                          {e.label}
                        </a>
                      ) : (
                        <span className="text-fg-secondary font-mono text-caption break-all">{e.path}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />
      <p className="text-fg-muted text-caption">
        复核状态与导入标记是资料包里记载的原值，只说明资料整理情况；不表示标准现行与否，也不表示医院已采用。资料记了图证路径不等于图随包提供。
      </p>
    </Section>
  )
}
