// 标准资料库（F0 / F1，docs/标准资料库-F0F1开发计划.md）：外部标准原文的只读参考。
// 标准资料（每行一份结构化文档修订）→ 条目（数据元、值域表、代码）→ 出处与原记录。
// 写入只经本地导入命令；页面没有编辑、采用、发布动作。引用按原文显示：原文未写年份时只说“按本库目录定位”，
// 不写成原文指定了该年份；原文写明的年份本库没有收录时显示未解析，其他年份另列、不等价。
import { Book02Icon, Calendar03Icon, HashtagIcon, TextFontIcon } from '@hugeicons/core-free-icons'
import { useDeferredValue } from 'react'
import { Link, useParams } from 'react-router'
import type {
  Evidence,
  ReferenceOut,
  ReferenceTarget,
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
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, SearchBox } from '@/components/kit/database'
import { DetailFallback } from '@/components/kit/missing'
import { PropertyList } from '@/components/kit/property-list'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { Section } from '@/components/kit/section'
import { Tag, type Tone } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { stamp } from '@/lib/format'
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

// ---------------------------------------------------------------- 标准资料列表

export function StandardDocumentsPage() {
  usePageFrame('work')
  const list = useListStandardDocuments()
  const status = readStatus(list)
  const rows = (status === 'ready' ? list.data : undefined) ?? []
  const back = useListReturn({ scope: 'standards', ready: status === 'ready' })
  return (
    <>
      <PageHeader
        title="标准资料"
        description="已收录的卫生信息标准结构化资料，供查阅原文定义、值域与出处。只读参考：不表示医院已采用，也不判断院内数据是否合规。"
      />
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
              { label: '读取器' },
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
                <DbCell className="text-fg-muted font-mono text-caption whitespace-nowrap">
                  {d.reader}@{d.reader_version}
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
        <span>同一标准的不同整理修订分别成行；接入覆盖 = 已读入的源记录 / 所读成员里该标准的源记录</span>
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
  const entries = useSearchStandardEntries({ document_id: id, limit: 500 }, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  useCrumb(data && !isDenial(query.error) ? standardLabel(data.standard_no, data.standard_year) : null)
  if (!data || isDenial(query.error))
    return <DetailFallback what="标准资料" back={{ to: '/standards/library', label: '返回标准资料' }} query={query} invalid={!Number.isInteger(id)} />
  const p = data.package
  const top = (entries.data ?? []).filter((e) => e.entry_type !== 'code_row')
  const entriesStatus = readStatus(entries)
  return (
    <>
      <PageHeader
        title={standardLabel(data.standard_no, data.standard_year)}
        meta={
          <>
            结构化修订 <span className="font-mono">{data.reader}@{data.reader_version}</span> · 导入于 {stamp(data.imported_at)}
          </>
        }
      />
      <StaleNotice what="这份标准资料" query={query} />
      <PropertyList
        items={[
          { label: '标准号', icon: Book02Icon, value: data.standard_no },
          { label: '原文年份', icon: Calendar03Icon, value: data.standard_year },
          { label: '已接入', value: <Counts counts={data.counts} /> },
          { label: '接入覆盖', value: <Coverage d={data} /> },
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
        <Section title={`已接入的条目${entriesStatus === 'ready' ? `（${top.length}）` : ''}`}>
          {entriesStatus === 'loading' ? (
            <ReadLoading label="正在读取条目…" rows={2} />
          ) : entriesStatus === 'error' ? (
            <ReadError what="条目" query={entries} compact />
          ) : (
            <EntryTable rows={top} showDocument={false} />
          )}
          <p className="text-fg-muted text-caption">代码行在所属值域表里查看。</p>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 数据元检索

export function DataElementsPage() {
  usePageFrame('work')
  const [query, setQuery] = useReturnState('q', '', isString)
  const q = useDeferredValue(query.trim())
  const list = useSearchStandardEntries({ entry_type: 'data_element', ...(q && { q }) })
  const status = readStatus(list)
  const rows = (status === 'ready' ? list.data : undefined) ?? []
  const back = useListReturn({ scope: q, ready: status === 'ready', local: { q: query } })
  return (
    <>
      <PageHeader
        title="数据元"
        description="按名称或数据元标识符查找标准原文中的数据元，查看定义、类型、表示格式与允许值，以及它引用的值域和出处。"
      />
      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称或 DE 编号，如“身份证件类别”“DE02.01.031.00”" />} />
      <StaleNotice what="数据元" query={list} />
      {status === 'loading' ? (
        <ReadLoading label="正在查找数据元…" />
      ) : status === 'error' ? (
        <ReadError what="数据元" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty
          title={q ? `没有找到“${q}”` : '还没有接入数据元'}
          hint="这里只列已接入的条目；尚未接入的分册与记录见“标准资料”的接入覆盖。"
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <EntryTable rows={rows} showDocument />
        </div>
      )}
      <DbFooter>
        <span>
          {status === 'ready' ? (
            <>
              找到 <span className="text-fg-secondary">{rows.length}</span> 个数据元
            </>
          ) : (
            <Unknown reason="数据元尚未读取成功" />
          )}
        </span>
        <span>DE 编号只是检索标识；同一编号在不同标准版本里各是一条</span>
      </DbFooter>
    </>
  )
}

function EntryTable({ rows, showDocument }: { rows: StandardEntryRow[]; showDocument: boolean }) {
  if (rows.length === 0) return <p className="text-fg-muted text-xs">没有条目。</p>
  return (
    <DbTable
      columns={[
        { label: '名称', icon: TextFontIcon, className: 'min-w-40' },
        { label: '标识', icon: HashtagIcon },
        { label: '类型' },
        ...(showDocument ? [{ label: '所属标准', icon: Book02Icon }] : []),
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
          <DbCell className="whitespace-nowrap">
            <Tag tone="gray">{TYPE_LABEL[e.entry_type]}</Tag>
          </DbCell>
          {showDocument && (
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
            </Link>
          </>
        }
      />
      <StaleNotice what="这个条目" query={query} />
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
                  <ResolutionTag r={r.resolution} />
                </li>
              ))}
            </ul>
            <p className="text-fg-muted text-caption">只列解析到本条的引用；“按目录定位”表示原文未写年份。</p>
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
        { label: '原单元格', value: b.raw_cells.length > 0 && <span className="font-mono text-caption">{b.raw_cells.join(' | ')}</span> },
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

function ResolutionTag({ r }: { r: ReferenceOut['resolution'] }) {
  return <Tag tone={RESOLUTION[r].tone}>{RESOLUTION[r].label}</Tag>
}

function TargetLink({ t }: { t: ReferenceTarget }) {
  return (
    <Link className="text-fg-strong hover:underline" to={entryPath(t.entry_id)}>
      {standardLabel(t.document.standard_no, t.document.standard_year)} {t.identifier} {t.name}
    </Link>
  )
}

/** 原文引用的解析：说清楚是原文指定、目录定位还是未收录，不替原文补年份 */
function ReferenceView({ r }: { r: ReferenceOut }) {
  const cited = standardLabel(r.target_standard, r.target_year) + (r.target_identifier ? ` ${r.target_identifier}` : '')
  let note: string
  if (r.ref_kind === 'external_standard') note = `引用外部规范 ${cited}，本库尚未收录`
  else if (r.resolution === 'explicit') note = `原文指定 ${cited}`
  else if (r.resolution === 'catalog') note = `原文未写 ${r.target_standard} 的年份；下面是本库收录的相关版本，不表示原文指定了该年份`
  else if (r.resolution === 'candidates') note = `本库收录了多个可能的版本，原文没有指明是哪一个`
  else note = `本库尚未收录 ${cited}`
  return (
    <div className="border-line-subtle bg-surface-subtle grid gap-1.5 rounded-md border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <ResolutionTag r={r.resolution} />
        <span className="text-fg-secondary">{note}</span>
      </div>
      {r.targets.map((t) => (
        <TargetLink key={t.entry_id} t={t} />
      ))}
      {(r.other_versions ?? []).length > 0 && (
        <div className="grid gap-1">
          <span className="text-fg-muted text-caption">本库收录的其他年份（仅供阅读，不等价于原文所指版本）</span>
          {(r.other_versions ?? []).map((t) => (
            <TargetLink key={t.entry_id} t={t} />
          ))}
        </div>
      )}
    </div>
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
          { label: '资料记载的问题', value: issues.length > 0 ? issues.join('；') : <span className="text-fg-muted">无</span> },
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
