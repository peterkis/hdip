// 标准目录与原文（docs/标准资料库-目录与原文实施计划.md 第 6 节）：一行一项标准（标准号 + 年份）。
// 目录来自原件层（官网“卫生健康委员会”分类快照 + Drive 归档），只读；状态只记官方来源核实到的，
// 没有官方状态的一律“待核实”，不当作现行。已有结构化成果按标准号 + 年份、原文摘要在读取时挂上。
import { Book02Icon, Calendar03Icon, File02Icon, Layers01Icon } from '@hugeicons/core-free-icons'
import { useDeferredValue } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { StandardEditionDetail, StandardEditionRow, StandardFileOut } from '@/api/generated/model'
import { useGetStandardEdition, useSearchStandardEditions } from '@/api/generated/standards/standards'
import { ApiError } from '@/api/fetcher'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox } from '@/components/kit/database'
import { DetailFallback } from '@/components/kit/missing'
import { MoreActions } from '@/components/kit/more-actions'
import { PropertyList } from '@/components/kit/property-list'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { InlineLink, Section } from '@/components/kit/section'
import { Tag, type Tone } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { stamp } from '@/lib/format'
import { isString, useListReturn, useReturnState } from '@/lib/scroll-memory'
import { fileViewerPath, useStandardFileUrl } from '@/lib/standard-file'
import { scrollBehavior } from '@/lib/utils'
import { Counts, EntryBrowser, revisionLabel, RevisionTag, standardLabel } from '@/pages/standards'

type EditionStatus = StandardEditionRow['status']

const STATUS: Record<EditionStatus, { label: string; tone: Tone }> = {
  current: { label: '现行', tone: 'green' },
  upcoming: { label: '即将实施', tone: 'blue' },
  abolished: { label: '废止', tone: 'red' },
  unverified: { label: '待核实', tone: 'gray' },
}

const SERIES_LABEL: Record<string, string> = {
  GB: '国家标准（强制）',
  'GB/T': '国家标准（推荐）',
  WS: '行业标准（强制）',
  'WS/T': '行业标准（推荐）',
}

const ROLE_LABEL: Record<StandardFileOut['role'], string> = {
  TEXT: '正文',
  BOUND: '合订',
  ORIGINAL_FORMAT: '官方原格式',
  ERRATA: '修改单',
  PAGE_IMAGE: '原页图',
}

export function editionPath(id: number) {
  return `/standards/library/editions/${id}`
}

/** 状态 + 核实日期：“现行 · 核实于 2026-10-30”；待核实不写日期 */
export function EditionStatusView({ e }: { e: Pick<StandardEditionRow, 'status' | 'verified_on'> }) {
  const s = STATUS[e.status]
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Tag tone={s.tone}>{s.label}</Tag>
      {e.verified_on && <span className="text-fg-muted text-caption whitespace-nowrap">核实于 {e.verified_on}</span>}
    </span>
  )
}

function FilesSummary({ e }: { e: StandardEditionRow }) {
  const parts = [
    e.text_files > 0 && `正文 ${e.text_files} 份`,
    e.page_images > 0 && `页图 ${e.page_images} 张`,
    e.other_files > 0 && `其他 ${e.other_files} 份`,
  ].filter(Boolean)
  return parts.length ? <>{parts.join(' · ')}</> : <span className="text-fg-muted">仅目录</span>
}

// ---------------------------------------------------------------- 标准目录

const PAGE = 50
type Paging = { scope: string; offset: number }
const isPaging = (v: unknown): v is Paging =>
  !!v && typeof v === 'object' && isString((v as Paging).scope) && Number.isInteger((v as Paging).offset) && (v as Paging).offset >= 0

const STATUS_OPTIONS = (Object.keys(STATUS) as EditionStatus[]).map((k) => ({ value: k, label: STATUS[k].label }))
const SERIES_OPTIONS = Object.keys(SERIES_LABEL).map((k) => ({ value: k, label: k }))
const YES_NO = [
  { value: '1', label: '有' },
  { value: '0', label: '没有' },
]

export function StandardCatalogPage() {
  usePageFrame('work')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const series = params.get('series') ?? ''
  const status = (params.get('status') ?? '') as EditionStatus | ''
  const text = params.get('text') ?? ''
  const structured = params.get('structured') ?? ''
  const [query, setQuery] = useReturnState('q', '', isString)
  const q = useDeferredValue(query.trim())
  const scope = `editions|${series}|${status}|${text}|${structured}|${q}`
  const [paging, setPaging] = useReturnState('paging', { scope, offset: 0 }, isPaging)
  if (paging.scope !== scope) setPaging({ scope, offset: 0 })
  const offset = paging.scope === scope ? paging.offset : 0
  const goto = (next: number) => {
    setPaging({ scope, offset: next })
    document.querySelector('main')?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const list = useSearchStandardEditions({
    ...(q && { q }),
    ...(series && { series }),
    ...(status && { status }),
    ...(text && { has_text: text === '1' }),
    ...(structured && { structured: structured === '1' }),
    offset,
    limit: PAGE,
  })
  const read = readStatus(list)
  const page = read === 'ready' ? list.data : undefined
  const rows = page?.items ?? []
  const total = page?.total ?? 0
  const back = useListReturn({ scope, ready: read === 'ready', local: { q: query, paging } })
  const filtered = !!(q || series || status || text || structured)
  return (
    <>
      <PageHeader
        title="标准资料"
        description="卫生健康信息相关标准的目录与原文：名称、官方状态与日期、本地原文，以及已整理的数据元与值域。只读参考：不表示医院已采用，也不判断院内数据是否合规。"
        actions={<MoreActions items={[{ label: '查看结构化处理修订', onClick: () => navigate('/standards/library/revisions') }]} />}
      />
      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称或标准号，如“数据元目录”“363.3”" />}>
        <FilterPill label="系列" icon={Book02Icon} value={series} onChange={(v) => set('series', v)} options={SERIES_OPTIONS} />
        <FilterPill label="状态" value={status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
        <FilterPill label="原文" icon={File02Icon} value={text} onChange={(v) => set('text', v)} options={YES_NO} />
        <FilterPill label="结构化成果" icon={Layers01Icon} value={structured} onChange={(v) => set('structured', v)} options={YES_NO} />
      </DbToolbar>
      <StaleNotice what="标准目录" query={list} />
      {read === 'loading' ? (
        <ReadLoading label="正在读取标准目录…" />
      ) : read === 'error' ? (
        <ReadError what="标准目录" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty
          title={filtered ? '没有符合条件的标准' : '还没有登记标准目录'}
          hint={filtered ? undefined : '标准目录由维护人用本地导入命令登记（api/scripts/import_catalog.py）。'}
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <DbTable
            columns={[
              { label: '标准', icon: Book02Icon, className: 'min-w-64' },
              { label: '状态' },
              { label: '实施日期', icon: Calendar03Icon },
              { label: '原文', icon: File02Icon },
              { label: '结构化成果', icon: Layers01Icon },
            ]}
          >
            {rows.map((e) => (
              <DbRow key={e.id} returnId={e.id}>
                <DbCell>
                  <Link className="text-fg-strong font-medium hover:underline" to={editionPath(e.id)}>
                    {e.title}
                  </Link>
                  <div className="text-fg-muted text-caption">
                    {standardLabel(e.standard_no, e.standard_year)} · {SERIES_LABEL[e.series] ?? e.series}
                  </div>
                </DbCell>
                <DbCell>
                  <EditionStatusView e={e} />
                </DbCell>
                <DbCell className="text-fg-secondary tabular-nums whitespace-nowrap">{e.effective_on ?? <span className="text-fg-muted">未登记</span>}</DbCell>
                <DbCell className="text-fg-secondary whitespace-nowrap">
                  <FilesSummary e={e} />
                </DbCell>
                <DbCell className="text-fg-secondary whitespace-nowrap">
                  {Object.keys(e.counts).length ? <Counts counts={e.counts} /> : null}
                </DbCell>
              </DbRow>
            ))}
          </DbTable>
        </div>
      )}
      <DbFooter>
        <span>
          {read === 'ready' ? (
            total > 0 ? (
              <>
                第 <span className="text-fg-secondary tabular-nums">{offset + 1}–{offset + rows.length}</span> 项，共{' '}
                <span className="text-fg-secondary tabular-nums">{total}</span> 项标准
              </>
            ) : (
              <>共 0 项标准</>
            )
          ) : (
            <Unknown reason="标准目录尚未读取成功" />
          )}
        </span>
        {read === 'ready' && total > PAGE && (
          <span className="inline-flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => goto(Math.max(0, offset - PAGE))}>
              上一页
            </Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE >= total} onClick={() => goto(offset + PAGE)}>
              下一页
            </Button>
          </span>
        )}
        <span>一项标准 = 标准号 + 年份；状态取官方目录，没有官方状态的是“待核实”</span>
      </DbFooter>
    </>
  )
}

// ---------------------------------------------------------------- 标准详情

type TabKey = 'overview' | 'files' | 'content' | 'records'

export function StandardEditionDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const query = useGetStandardEdition(id, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  const [params, setParams] = useSearchParams()
  useCrumb(data && !isDenial(query.error) ? standardLabel(data.standard_no, data.standard_year) : null)
  if (!data || isDenial(query.error))
    return <DetailFallback what="标准" back={{ to: '/standards/library', label: '返回标准资料' }} query={query} invalid={!Number.isInteger(id)} />
  const structured = data.revisions.length > 0
  const keys: TabKey[] = ['overview', 'files', ...(structured ? (['content', 'records'] as TabKey[]) : [])]
  const asked = params.get('tab') as TabKey | null
  const tab: TabKey = asked && keys.includes(asked) ? asked : 'overview'
  const setTab = (v: TabKey) =>
    setParams(
      (p) => {
        if (v === 'overview') p.delete('tab')
        else p.set('tab', v)
        return p
      },
      { replace: true },
    )
  // 同版有多份正文时不替人选一份：转到“原文与附件”并列查看
  const texts = data.files.filter((f) => f.role === 'TEXT' || f.role === 'BOUND' || f.role === 'ORIGINAL_FORMAT')
  return (
    <>
      <PageHeader
        title={data.title}
        meta={
          <>
            {standardLabel(data.standard_no, data.standard_year)} · {SERIES_LABEL[data.series] ?? data.series} · {STATUS[data.status].label}
          </>
        }
        actions={
          texts.length === 1 ? (
            <Button variant="outline" nativeButton={false} render={<Link to={fileViewerPath(data.id, texts[0].id)} />}>
              打开原文
            </Button>
          ) : texts.length > 1 ? (
            <Button variant="outline" onClick={() => setTab('files')}>
              查看原文（{texts.length} 份）
            </Button>
          ) : null
        }
      />
      <StaleNotice what="这项标准" query={query} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList variant="line" className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="files">原文与附件（{data.files.length}）</TabsTrigger>
          {structured && <TabsTrigger value="content">结构化内容</TabsTrigger>}
          {structured && <TabsTrigger value="records">来源与处理记录（{data.revisions.length}）</TabsTrigger>}
        </TabsList>
      </Tabs>
      <div className="mt-4 grid gap-6">
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'files' && <Files data={data} />}
        {tab === 'content' && (
          <EntryBrowser
            fixed={{ standard_no: data.standard_no, standard_year: data.standard_year, top_level: true }}
            scopeKey={`edition|${data.id}`}
            what="条目"
            placeholder="名称或 DE / CV 编号"
            columns="document"
            footnote="当前处理修订的数据元与值域表；代码行在所属值域表里查看"
          />
        )}
        {tab === 'records' && <Records data={data} />}
      </div>
    </>
  )
}

function Overview({ data }: { data: StandardEditionDetail }) {
  const c = data.current
  return (
    <>
      <Section title="目录信息">
        <PropertyList
          items={[
            { label: '标准号', icon: Book02Icon, value: standardLabel(data.standard_no, data.standard_year) },
            { label: '性质', value: SERIES_LABEL[data.series] ?? data.series },
            { label: '官网写法', value: c.catalog_code },
            { label: '官网分类', value: c.catalog_category },
            { label: '发布日期', icon: Calendar03Icon, value: c.issued_on },
            { label: '实施日期', icon: Calendar03Icon, value: c.effective_on },
            { label: '废止日期', icon: Calendar03Icon, value: c.abolished_on ?? (data.status === 'abolished' ? <span className="text-fg-muted">官方目录未给出</span> : null) },
            { label: '状态', value: <EditionStatusView e={data} /> },
            {
              label: '核实依据',
              value:
                c.basis_url || c.basis_note ? (
                  <span className="grid gap-0.5">
                    {c.basis_note && <span>{c.basis_note}</span>}
                    {c.basis_url && (
                      <a className="text-fg-secondary break-all hover:underline" href={c.basis_url} target="_blank" rel="noreferrer">
                        官方详情页
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="text-fg-muted">没有官方来源；状态待核实</span>
                ),
            },
            {
              label: '在线阅读',
              value: c.online_url && (
                <a className="text-fg-secondary break-all hover:underline" href={c.online_url} target="_blank" rel="noreferrer">
                  官网在线阅读
                </a>
              ),
            },
          ]}
        />
        {data.status === 'unverified' && (
          <p className="text-fg-muted text-caption">这项标准不在已取得的官方目录里，状态与日期待核实；不能因为没有废止日期就当作现行。</p>
        )}
      </Section>
      {(c.difference || c.file_identity || c.note) && (
        <Section title={c.difference || c.file_identity ? '目录与文件的差异' : '整理说明'}>
          <PropertyList
            items={[
              c.difference && { label: '差异类别', value: <Tag tone="yellow">{c.difference}</Tag> },
              c.file_identity && { label: '文件内标识', value: c.file_identity },
              c.note && {
                label: '整理说明',
                value: (
                  <ul className="grid gap-1">
                    {c.note.split('；').map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ),
              },
            ].filter((x) => !!x)}
          />
          <p className="text-fg-muted text-caption">官方目录条目是入口，文件封面是证据；两边写法都保留，不按封面改写目录。</p>
        </Section>
      )}
      <Section title={`登记历史（${data.versions.length}）`}>
        <ol className="grid gap-2">
          {[...data.versions].reverse().map((v) => (
            <li key={v.seq} className="text-xs">
              <span className="text-fg-muted tabular-nums">{stamp(v.recorded_at)}</span>
              <span className="text-fg-strong ml-3 font-medium">第 {v.seq} 次登记</span>
              <span className="text-fg-secondary ml-2">{v.change_note}</span>
            </li>
          ))}
        </ol>
        <p className="text-fg-muted text-caption">目录信息每改一次追加一次登记，旧的保留；这是目录记录的修订，不是标准版本。</p>
      </Section>
    </>
  )
}

function Files({ data }: { data: StandardEditionDetail }) {
  if (data.files.length === 0)
    return (
      <Callout tone="info" title="没有登记原文">
        官网目录没有提供这项标准的原文，Drive 归档里也没有取得。找到原文后放进资料目录的收件箱，重建原件层再登记。
      </Callout>
    )
  const pages = data.files.filter((f) => f.page_image)
  // 页图是否成套记在目录的整理说明里（原件层按 Drive 清单的全套页数核对）
  const partial = (data.current.note ?? '').split('；').filter((x) => x.includes('页图'))
  return (
    <>
      {pages.length > 0 && partial.length > 0 && (
        <Callout tone="warning" title={`只有部分原页图（${pages.length} 张）`}>
          {partial.join('；')}。部分页图不能当作完整原文。
        </Callout>
      )}
      <DbTable
        columns={[
          { label: '文件', icon: File02Icon, className: 'min-w-64' },
          { label: '角色' },
          { label: '来源与身份核对', className: 'min-w-40' },
          { label: '大小' },
          { label: '' },
        ]}
      >
        {data.files.map((f) => (
          <DbRow key={f.id}>
            <DbCell>
              <span className="text-fg-strong break-all">{f.file_name}</span>
              <div className="text-fg-muted font-mono text-caption">{f.sha256.slice(0, 12)}…</div>
              {f.note && <div className="text-fg-muted text-caption">{f.note}</div>}
            </DbCell>
            <DbCell className="whitespace-nowrap">
              <Tag tone={f.role === 'TEXT' ? 'gray' : 'blue'}>{ROLE_LABEL[f.role]}</Tag>
            </DbCell>
            <DbCell className="text-fg-secondary">
              <div>{f.source}</div>
              <div className="text-fg-muted text-caption">{f.identity_check}</div>
            </DbCell>
            <DbCell className="text-fg-secondary tabular-nums whitespace-nowrap">{formatBytes(f.bytes)}</DbCell>
            <DbCell className="whitespace-nowrap">
              <InlineLink to={fileViewerPath(data.id, f.id)}>打开</InlineLink>
            </DbCell>
          </DbRow>
        ))}
      </DbTable>
      <p className="text-fg-muted text-caption">
        {pages.length > 0 && '原页图一张是一页，不是完整原文；'}
        “来自官网”不等于身份已核对，下载成功也不等于现行。同版有多份不同字节的正文时并列保留，不指定首选。
      </p>
    </>
  )
}

function Records({ data }: { data: StandardEditionDetail }) {
  return (
    <DbTable
      columns={[
        { label: '处理修订', className: 'min-w-40' },
        { label: '已接入' },
        { label: '来源包', className: 'min-w-48' },
        { label: '所据原文', className: 'min-w-40' },
      ]}
    >
      {data.revisions.map((r) => {
        const file = data.files.find((f) => f.id === r.file_id)
        return (
          <DbRow key={r.document.id}>
            <DbCell>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Link className="text-fg-strong font-medium hover:underline" to={`/standards/library/${r.document.id}`}>
                  {revisionLabel(r.document)}
                </Link>
                <RevisionTag d={r.document} />
              </span>
            </DbCell>
            <DbCell className="text-fg-secondary whitespace-nowrap">
              <Counts counts={r.counts} />
              <div className="text-fg-muted text-caption tabular-nums">
                {r.covered_keys} / {r.total_records} 条源记录
              </div>
            </DbCell>
            <DbCell className="text-fg-secondary text-caption break-all">{r.package_file}</DbCell>
            <DbCell className="text-fg-secondary">
              {file ? (
                <span className="break-all">{file.file_name}</span>
              ) : (
                <span className="text-fg-muted">
                  未登记本修订所据的原文
                  {r.source_sha256 && <span className="font-mono">（摘要 {r.source_sha256.slice(0, 12)}…）</span>}
                </span>
              )}
            </DbCell>
          </DbRow>
        )
      })}
    </DbTable>
  )
}

export function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

// ---------------------------------------------------------------- 原文页

/** 应用内显示原文：PDF 与页图用内嵌框，官方原格式（DOCX）浏览器不能直接显示，只给下载 */
export function StandardFileViewerPage() {
  usePageFrame('canvas')
  const params = useParams()
  const editionId = Number(params.id)
  const fileId = Number(params.fileId)
  const [search] = useSearchParams()
  const page = Number(search.get('page')) || null
  const valid = Number.isInteger(editionId) && Number.isInteger(fileId)
  const query = useGetStandardEdition(editionId, { query: { enabled: valid } })
  const { data } = query
  const file = data?.files.find((f) => f.id === fileId)
  useCrumb(data && file && !isDenial(query.error) ? `${standardLabel(data.standard_no, data.standard_year)} 原文` : null)
  if (!data || isDenial(query.error) || !file)
    return (
      <DetailFallback
        what="原文文件"
        back={{ to: data ? editionPath(data.id) + '?tab=files' : '/standards/library', label: data ? '返回原文与附件' : '返回标准资料' }}
        query={data && !file ? { isError: true, error: new ApiError(404, null, '找不到这个原文文件'), refetch: query.refetch } : query}
        invalid={!valid}
      />
    )
  return <FileViewer edition={data} file={file} page={page} />
}

function FileViewer({ edition, file, page }: { edition: StandardEditionDetail; file: StandardFileOut; page: number | null }) {
  const state = useStandardFileUrl(file.id)
  const showable = file.media_type === 'application/pdf' || file.media_type.startsWith('image/')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={file.file_name}
        meta={
          <>
            <Link className="hover:underline" to={editionPath(edition.id)}>
              {edition.title}（{standardLabel(edition.standard_no, edition.standard_year)}）
            </Link>{' '}
            · {ROLE_LABEL[file.role]} · {file.source} · {formatBytes(file.bytes)}
            {page && <> · 第 {page} 页</>}
          </>
        }
        actions={
          state.status === 'ready' && (
            <Button variant="outline" nativeButton={false} render={<a href={state.url} download={file.file_name} />}>
              下载
            </Button>
          )
        }
      />
      {state.status === 'loading' ? (
        <ReadLoading label="正在读取原文…" />
      ) : state.status === 'error' ? (
        <Callout tone="danger" title="原文不能显示">
          {state.message}
        </Callout>
      ) : showable ? (
        <iframe
          title={file.file_name}
          src={file.media_type === 'application/pdf' && page ? `${state.url}#page=${page}` : state.url}
          className="border-line bg-surface h-svh w-full rounded-md border"
        />
      ) : (
        <Callout tone="info" title="浏览器不能直接显示这种文件">
          这是官方提供的原格式文件（{file.media_type.includes('word') ? 'Word' : file.media_type}），请下载后用对应软件打开。
        </Callout>
      )}
    </div>
  )
}
