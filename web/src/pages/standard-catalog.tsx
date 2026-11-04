// 标准目录与原文（docs/标准资料库-目录与原文实施计划.md 第 6 节）：一行一项标准（标准号 + 年份）。
// 目录来自原件层（官网“卫生健康委员会”分类快照 + Drive 归档），只读；状态只记官方来源核实到的，
// 没有官方状态的一律“待核实”，不当作现行。已有结构化成果按标准号 + 年份、原文摘要在读取时挂上。
// 没有标准号的官方资料是“参考资料”（迁移 0026，docs/标准资料库-uniData接入计划.md U5）：
// 同一页用“标准 | 参考资料”切换，另有身份，不冒充标准、不进标准计数。
import { Book02Icon, Calendar03Icon, File02Icon, Layers01Icon } from '@hugeicons/core-free-icons'
import { useDeferredValue, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ReferenceMaterialRow, StandardEditionDetail, StandardEditionRow, StandardFileOut } from '@/api/generated/model'
import {
  useGetReferenceMaterial,
  useGetStandardEdition,
  useSearchReferenceMaterials,
  useSearchStandardEditions,
} from '@/api/generated/standards/standards'
import { ApiError } from '@/api/fetcher'
import { Callout } from '@/components/kit/callout'
import { DbCell, DbEmpty, DbFooter, DbRow, DbTable, DbToolbar, FilterPill, SearchBox } from '@/components/kit/database'
import { DetailFallback } from '@/components/kit/missing'
import { MoreActions } from '@/components/kit/more-actions'
import { PropertyList } from '@/components/kit/property-list'
import { isDenial, ReadError, ReadLoading, readStatus, StaleNotice, Unknown } from '@/components/kit/read-state'
import { InlineAction, InlineLink, Section } from '@/components/kit/section'
import { Segmented } from '@/components/kit/segmented'
import { Tag, type Tone } from '@/components/kit/tag'
import { PageHeader, usePageFrame } from '@/components/layout'
import { useCrumb } from '@/components/shell/crumbs'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { stamp } from '@/lib/format'
import { isString, useListReturn, useReturnState } from '@/lib/scroll-memory'
import { fileViewerPath, referenceFileViewerPath, useStandardFileUrl } from '@/lib/standard-file'
import { scrollBehavior } from '@/lib/utils'
import { Counts, EntryBrowser, revisionLabel, RevisionTag, standardLabel } from '@/pages/standards'

type EditionStatus = StandardEditionRow['status']

const STATUS: Record<EditionStatus, { label: string; tone: Tone }> = {
  current: { label: '现行', tone: 'green' },
  upcoming: { label: '即将实施', tone: 'blue' },
  abolished: { label: '废止', tone: 'red' },
  unverified: { label: '待核实', tone: 'gray' },
}

// 资料类别（导航用）与强制 / 推荐性质是两回事：类别按系列定，性质按当前登记的系列写，不推断现时适用效力
type SeriesCategory = 'national' | 'industry'
const CATEGORY_LABEL: Record<SeriesCategory, string> = { national: '国家标准', industry: '行业标准' }
const SERIES: Record<string, { category: SeriesCategory; binding: string }> = {
  GB: { category: 'national', binding: '强制性' },
  'GB/T': { category: 'national', binding: '推荐性' },
  WS: { category: 'industry', binding: '强制性' },
  'WS/T': { category: 'industry', binding: '推荐性' },
}
/** 资料类别：未知系列原样显示，不归到某一类 */
export function seriesCategory(series: string) {
  const s = SERIES[series]
  return s ? CATEGORY_LABEL[s.category] : series
}
export function seriesBinding(series: string) {
  return SERIES[series]?.binding ?? null
}

const ROLE_LABEL: Record<StandardFileOut['role'], string> = {
  TEXT: '正文',
  BOUND: '合订',
  ORIGINAL_FORMAT: '官方原格式',
  ERRATA: '修改单',
  PAGE_IMAGE: '原页图',
}

const CATEGORY: Record<ReferenceMaterialRow['category'], { label: string; tone: Tone }> = {
  STAT_FORM: { label: '统计报表', tone: 'purple' },
  OFFICIAL_REFERENCE: { label: '官方参考资料', tone: 'teal' },
  PAYER_UPDATE: { label: '医保更新', tone: 'orange' },
}

export function editionPath(id: number) {
  return `/standards/library/editions/${id}`
}

export function referencePath(id: number) {
  return `/standards/library/references/${id}`
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

/** 可查内容：原文与已接入的结构化条目；都没有时写“仅目录信息” */
function Available({ e }: { e: StandardEditionRow }) {
  const files = [
    e.text_files > 0 && `原文 ${e.text_files} 份`,
    e.page_images > 0 && `页图 ${e.page_images} 张`,
    e.other_files > 0 && `其他 ${e.other_files} 份`,
  ].filter(Boolean)
  const structured = Object.keys(e.counts).length > 0
  if (!files.length && !structured) return <span className="text-fg-muted">仅目录信息</span>
  return (
    <span className="grid gap-0.5">
      {files.length > 0 && <span>{files.join(' · ')}</span>}
      {structured && (
        <span className="text-fg-muted text-caption">
          <Counts counts={e.counts} />
        </span>
      )}
    </span>
  )
}

/** 列表第一列：类别 + 性质（或参考资料的细类） */
function CategoryCell({ label, sub }: { label: string; sub?: string | null }) {
  return (
    <DbCell className="whitespace-nowrap">
      <div className="text-fg-secondary">{label}</div>
      {sub && <div className="text-fg-muted text-caption">{sub}</div>}
    </DbCell>
  )
}

// ---------------------------------------------------------------- 标准目录

const PAGE = 50
type Paging = { scope: string; offset: number }
const isPaging = (v: unknown): v is Paging =>
  !!v && typeof v === 'object' && isString((v as Paging).scope) && Number.isInteger((v as Paging).offset) && (v as Paging).offset >= 0

const STATUS_OPTIONS = (Object.keys(STATUS) as EditionStatus[]).map((k) => ({ value: k, label: STATUS[k].label }))
// 类别筛选：先国家 / 行业，再细到强制 / 推荐（即旧的系列筛选，网址 series= 照常可用）
const CATEGORY_FILTER = (Object.keys(CATEGORY_LABEL) as SeriesCategory[]).flatMap((c) => [
  { value: c, label: CATEGORY_LABEL[c] },
  ...Object.entries(SERIES)
    .filter(([, v]) => v.category === c)
    .map(([k, v]) => ({ value: k, label: `${CATEGORY_LABEL[c]} · ${v.binding}（${k}）` })),
])
const isCategory = (v: string): v is SeriesCategory => v in CATEGORY_LABEL
const YES_NO = [
  { value: '1', label: '有' },
  { value: '0', label: '没有' },
]

type Kind = 'standard' | 'reference'

export function StandardCatalogPage() {
  usePageFrame('work')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const kind: Kind = params.get('kind') === 'reference' ? 'reference' : 'standard'
  // 换类型时清掉另一类的筛选：两类的筛选条件不通用
  const setKind = (v: Kind) => setParams(v === 'reference' ? { kind: 'reference' } : {}, { replace: true })
  return (
    <>
      <PageHeader
        title="标准资料"
        description="卫生健康信息相关标准的目录与原文：名称、官方状态与日期、本地原文，以及已整理的数据元与值域；另收没有标准号的官方参考资料。只读参考：不表示医院已采用，也不判断院内数据是否合规。"
        actions={<MoreActions items={[{ label: '查看结构化处理修订', onClick: () => navigate('/standards/library/revisions') }]} />}
      />
      <div className="mb-3">
        <Segmented
          label="资料类型"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'standard', label: '标准' },
            { value: 'reference', label: '参考资料' },
          ]}
        />
      </div>
      {kind === 'standard' ? <EditionList /> : <ReferenceList />}
    </>
  )
}

function EditionList() {
  const [params, setParams] = useSearchParams()
  const series = params.get('series') ?? ''
  const categoryParam = params.get('category') ?? ''
  const category = isCategory(categoryParam) ? categoryParam : ''
  const status = (params.get('status') ?? '') as EditionStatus | ''
  const text = params.get('text') ?? ''
  const structured = params.get('structured') ?? ''
  const [query, setQuery] = useReturnState('q', '', isString)
  const q = useDeferredValue(query.trim())
  const scope = `editions|${category}|${series}|${status}|${text}|${structured}|${q}`
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
  const setCategory = (v: string) => {
    const next = new URLSearchParams(params)
    next.delete('category')
    next.delete('series')
    if (isCategory(v)) next.set('category', v)
    else if (v) next.set('series', v)
    setParams(next, { replace: true })
  }
  const list = useSearchStandardEditions({
    ...(q && { q }),
    ...(category && { category }),
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
  const filtered = !!(q || category || series || status || text || structured)
  return (
    <>
      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称或标准号，如“数据元目录”“363.3”" />}>
        <FilterPill label="类别" icon={Book02Icon} value={series || category} onChange={setCategory} options={CATEGORY_FILTER} />
        <FilterPill label="标准状态" value={status} onChange={(v) => set('status', v)} options={STATUS_OPTIONS} />
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
          hint={filtered ? undefined : '标准目录由资料维护人登记后在这里显示。'}
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <DbTable
            columns={[
              { label: '类别' },
              { label: '名称与标准号', icon: Book02Icon, className: 'min-w-64' },
              { label: '标准状态' },
              { label: '实施日期', icon: Calendar03Icon },
              { label: '可查内容', icon: Layers01Icon },
            ]}
          >
            {rows.map((e) => (
              <DbRow key={e.id} returnId={e.id}>
                <CategoryCell label={seriesCategory(e.series)} sub={seriesBinding(e.series)} />
                <DbCell>
                  <Link className="text-fg-strong font-medium hover:underline" to={editionPath(e.id)}>
                    {e.title}
                  </Link>
                  <div className="text-fg-muted text-caption">{standardLabel(e.standard_no, e.standard_year)}</div>
                </DbCell>
                <DbCell>
                  <EditionStatusView e={e} />
                </DbCell>
                <DbCell className="text-fg-secondary tabular-nums whitespace-nowrap">{e.effective_on ?? <span className="text-fg-muted">未登记</span>}</DbCell>
                <DbCell className="text-fg-secondary whitespace-nowrap">
                  <Available e={e} />
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
        <span>一项标准 = 标准号 + 年份；标准状态只记官方目录核实到的，其余为“待核实”，不当作现行</span>
      </DbFooter>
    </>
  )
}

// ---------------------------------------------------------------- 参考资料

const CATEGORY_OPTIONS = (Object.keys(CATEGORY) as ReferenceMaterialRow['category'][]).map((k) => ({
  value: k,
  label: CATEGORY[k].label,
}))

function ReferenceList() {
  const [params, setParams] = useSearchParams()
  const category = (params.get('category') ?? '') as ReferenceMaterialRow['category'] | ''
  const [query, setQuery] = useReturnState('refQ', '', isString)
  const q = useDeferredValue(query.trim())
  const scope = `references|${category}|${q}`
  const [paging, setPaging] = useReturnState('refPaging', { scope, offset: 0 }, isPaging)
  if (paging.scope !== scope) setPaging({ scope, offset: 0 })
  const offset = paging.scope === scope ? paging.offset : 0
  const goto = (next: number) => {
    setPaging({ scope, offset: next })
    document.querySelector('main')?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }
  const setCategory = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('category', v)
    else next.delete('category')
    setParams(next, { replace: true })
  }
  const list = useSearchReferenceMaterials({ ...(q && { q }), ...(category && { category }), offset, limit: PAGE })
  const read = readStatus(list)
  const page = read === 'ready' ? list.data : undefined
  const rows = page?.items ?? []
  const total = page?.total ?? 0
  const back = useListReturn({ scope, ready: read === 'ready', local: { refQ: query, refPaging: paging } })
  return (
    <>
      <DbToolbar right={<SearchBox value={query} onChange={setQuery} placeholder="名称或备注，如“报送卡”“医保”" />}>
        <FilterPill label="细类" icon={Book02Icon} value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
      </DbToolbar>
      <StaleNotice what="参考资料" query={list} />
      {read === 'loading' ? (
        <ReadLoading label="正在读取参考资料…" />
      ) : read === 'error' ? (
        <ReadError what="参考资料" query={list} />
      ) : rows.length === 0 ? (
        <DbEmpty
          title={q || category ? '没有符合条件的参考资料' : '还没有登记参考资料'}
          hint={q || category ? undefined : '参考资料由资料维护人随标准目录登记后在这里显示。'}
        />
      ) : (
        <div onClickCapture={back.onClickCapture}>
          <DbTable
            columns={[
              { label: '类别' },
              { label: '名称', icon: File02Icon, className: 'min-w-64' },
              { label: '年份', icon: Calendar03Icon },
              { label: '可查内容', icon: Layers01Icon },
            ]}
          >
            {rows.map((m) => (
              <DbRow key={m.id} returnId={m.id}>
                <CategoryCell label="参考资料" sub={CATEGORY[m.category].label} />
                <DbCell>
                  <Link className="text-fg-strong font-medium hover:underline" to={referencePath(m.id)}>
                    {m.title}
                  </Link>
                  {m.note && <div className="text-fg-muted text-caption">{m.note}</div>}
                </DbCell>
                <DbCell className="text-fg-secondary tabular-nums whitespace-nowrap">{m.year ?? <span className="text-fg-muted">未登记</span>}</DbCell>
                <DbCell className="text-fg-secondary whitespace-nowrap">
                  {m.file_count > 0 ? `原文 ${m.file_count} 份` : <span className="text-fg-muted">暂未收录原文</span>}
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
                第 <span className="text-fg-secondary tabular-nums">{offset + 1}–{offset + rows.length}</span> 份，共{' '}
                <span className="text-fg-secondary tabular-nums">{total}</span> 份参考资料
              </>
            ) : (
              <>共 0 份参考资料</>
            )
          ) : (
            <Unknown reason="参考资料尚未读取成功" />
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
        <span>没有标准号的官方资料：不编造标准号，没有官方状态，不计入标准</span>
      </DbFooter>
    </>
  )
}

export function ReferenceMaterialDetailPage() {
  usePageFrame('document')
  const id = Number(useParams().id)
  const query = useGetReferenceMaterial(id, { query: { enabled: Number.isInteger(id) } })
  const { data } = query
  useCrumb(data && !isDenial(query.error) ? data.title : null)
  if (!data || isDenial(query.error))
    return (
      <DetailFallback
        what="参考资料"
        back={{ to: '/standards/library?kind=reference', label: '返回参考资料' }}
        query={query}
        invalid={!Number.isInteger(id)}
      />
    )
  const c = CATEGORY[data.category]
  return (
    <>
      <PageHeader
        title={data.title}
        meta={
          <>
            {c.label}
            {data.year && <> · {data.year}</>} · 参考资料
          </>
        }
        actions={
          data.files.length === 1 && (
            <Button variant="outline" nativeButton={false} render={<Link to={referenceFileViewerPath(data.id, data.files[0].id)} />}>
              阅读原文
            </Button>
          )
        }
      />
      <StaleNotice what="这份参考资料" query={query} />
      <div className="grid gap-6">
        <Section title="资料信息">
          <PropertyList
            items={[
              { label: '类别', value: <Tag tone={c.tone}>{c.label}</Tag> },
              { label: '年份', icon: Calendar03Icon, value: data.year },
              { label: '备注', value: data.note },
              { label: '登记时间', value: stamp(data.registered_at) },
            ]}
          />
          <p className="text-fg-muted text-caption">
            没有标准号的官方资料，另立身份：不编造标准号，没有官方状态，也不计入标准目录。名称、年份取自归档文件名。
          </p>
        </Section>
        <Section title={`原文（${data.files.length}）`}>
          <FileTable files={data.files} open={(f) => referenceFileViewerPath(data.id, f.id)} />
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 标准详情
// 概览只回答：是什么、标准状态、能看什么、有没有影响理解的差异。来源对照、更正、登记历史与处理修订
// 都在“整理记录”（一直可达，不以有无结构化成果为前提）；证据一条不少，只是不铺在概览里。

type TabKey = 'overview' | 'files' | 'content' | 'records'

/** 取得渠道的展示名：官网是权威入口，其余（Drive、uniData 等）统称本院归档资料；原来源名在整理记录里照录 */
const OFFICIAL_CLAIM = '官网目录快照'
const OFFICIAL_FILE = '官网下载'
export function fileChannel(source: string) {
  return source === OFFICIAL_FILE ? '官网下载' : '本院归档资料'
}
function claimChannel(source: string) {
  return source === OFFICIAL_CLAIM ? '官方目录' : '本院归档资料'
}

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
  const keys: TabKey[] = ['overview', 'files', ...(structured ? (['content'] as TabKey[]) : []), 'records']
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
  const binding = seriesBinding(data.series)
  return (
    <>
      <PageHeader
        title={data.title}
        meta={
          <>
            {standardLabel(data.standard_no, data.standard_year)} · {seriesCategory(data.series)}
            {binding && <> · {binding}</>} · {STATUS[data.status].label}
          </>
        }
        actions={<ReadOriginal data={data} onMany={() => setTab('files')} />}
      />
      <StaleNotice what="这项标准" query={query} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList variant="line" className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="files">原文与附件（{data.files.length}）</TabsTrigger>
          {structured && <TabsTrigger value="content">结构化内容</TabsTrigger>}
          <TabsTrigger value="records">整理记录</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4 grid gap-6">
        {tab === 'overview' && <Overview data={data} show={setTab} />}
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
        {tab === 'records' && <CurationRecords data={data} />}
      </div>
    </>
  )
}

/** 正文类文件：同版有多份时不替人选一份，转到“原文与附件”并列查看 */
function texts(data: StandardEditionDetail) {
  return data.files.filter((f) => f.role === 'TEXT' || f.role === 'BOUND' || f.role === 'ORIGINAL_FORMAT')
}

function ReadOriginal({ data, onMany, inline }: { data: StandardEditionDetail; onMany: () => void; inline?: boolean }) {
  const t = texts(data)
  if (t.length === 1)
    return inline ? (
      <InlineLink to={fileViewerPath(data.id, t[0].id)}>阅读原文</InlineLink>
    ) : (
      <Button variant="outline" nativeButton={false} render={<Link to={fileViewerPath(data.id, t[0].id)} />}>
        阅读原文
      </Button>
    )
  if (t.length > 1)
    return inline ? (
      <InlineAction onClick={onMany}>查看 {t.length} 份原文</InlineAction>
    ) : (
      <Button variant="outline" onClick={onMany}>
        查看原文（{t.length} 份）
      </Button>
    )
  return null
}

const CORR_FIELD: Record<string, string> = {
  title: '名称',
  issued_on: '发布日期',
  effective_on: '实施日期',
  abolished_on: '废止日期',
  difference: '差异类别',
  file_identity: '文件内标识',
  note: '备注',
}

// 只为比较去掉排版差异（全角 / 半角冒号与空白）；显示仍是来源原样
const norm = (v: string) => v.replace(/[:：\s]/g, '')
const differs = (value?: string | null, current?: string | null) => !!value && norm(value) !== norm(current ?? '')

/** 生效中的人工更正（未被撤销的 CORRECT 行） */
function activeCorrections(data: StandardEditionDetail) {
  return (data.corrections ?? []).filter((k) => k.action === 'CORRECT' && !k.withdrawn_by)
}

/**
 * 概览里要提醒的差异：已登记的目录—文件差异，以及官方目录记载与当前目录不同的名称 / 实施日期。
 * 归档资料的写法不同（多是按文件名记的标题）只计数，不当作告警；完整对照在整理记录。
 */
function notices(data: StandardEditionDetail) {
  const c = data.current
  const out: string[] = []
  if (c.difference) out.push(`目录与文件不一致：${c.difference}${c.file_identity ? `（文件内写作 ${c.file_identity}）` : ''}。`)
  else if (c.file_identity) out.push(`文件内标识写作 ${c.file_identity}，与目录写法不同。`)
  if (c.difference && c.note) out.push(...c.note.split('；').map((x) => `${x}。`))
  // 当前值由人工更正得来时说明来由，不只说“不同”
  const corrected = new Map(activeCorrections(data).map((k) => [k.field, k.correction_key]))
  const say = (what: string, written: string, field: string, current?: string | null) => {
    const key = corrected.get(field)
    return key
      ? `官方目录记载的${what}为 ${written}；当前目录按人工更正 ${key} 写作 ${current ?? '（清空）'}。`
      : `官方目录记载的${what}为“${written}”，与当前目录不同。`
  }
  for (const cl of (data.claims ?? []).filter((x) => x.source === OFFICIAL_CLAIM)) {
    if (differs(cl.title, c.title)) out.push(say('名称', cl.title!, 'title', c.title))
    if (differs(cl.effective, c.effective_on)) out.push(say('实施日期', cl.effective!, 'effective_on', c.effective_on))
  }
  return [...new Set(out)]
}

function Overview({ data, show }: { data: StandardEditionDetail; show: (tab: TabKey) => void }) {
  const c = data.current
  const warn = notices(data)
  const binding = seriesBinding(data.series)
  return (
    <>
      <Section title="基本信息">
        <PropertyList
          items={[
            { label: '类别', value: seriesCategory(data.series) },
            { label: '标准号', icon: Book02Icon, value: standardLabel(data.standard_no, data.standard_year) },
            { label: '性质', value: binding && `${binding}标准（按当前登记的标准号）` },
            { label: '标准状态', value: <EditionStatusView e={data} /> },
            { label: '发布日期', icon: Calendar03Icon, value: c.issued_on },
            { label: '实施日期', icon: Calendar03Icon, value: c.effective_on },
            (c.abolished_on || data.status === 'abolished') && {
              label: '废止日期',
              icon: Calendar03Icon,
              value: c.abolished_on ?? <span className="text-fg-muted">官方目录未给出</span>,
            },
            c.online_url && {
              label: '在线阅读',
              value: (
                <a className="text-fg-secondary break-all hover:underline" href={c.online_url} target="_blank" rel="noreferrer">
                  官网在线阅读
                </a>
              ),
            },
          ].filter((x) => !!x)}
        />
      </Section>
      {warn.length > 0 && (
        <Callout tone="warning" title="需要注意">
          <ul className="grid gap-1">
            {warn.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="mt-1">
            <InlineAction onClick={() => show('records')}>查看差异与依据</InlineAction>
          </p>
        </Callout>
      )}
      <CollectionSummary data={data} show={show} />
    </>
  )
}

/** 收录与整理：这项标准怎样进入本库、现在能看什么；只写有记录支持的事实 */
function CollectionSummary({ data, show }: { data: StandardEditionDetail; show: (tab: TabKey) => void }) {
  const c = data.current
  const claims = data.claims ?? []
  const official = claims.some((x) => x.source === OFFICIAL_CLAIM)
  const archive = claims.filter((x) => x.source !== OFFICIAL_CLAIM)
  const archiveDiffs = archive.filter((x) => differs(x.title, c.title) || differs(x.effective, c.effective_on) || x.linked_by === 'file').length
  const corrections = activeCorrections(data)
  const channels = [...new Set(data.files.map((f) => fileChannel(f.source)))]
  const structured = Object.keys(data.counts).length > 0
  return (
    <Section title="收录与整理">
      <PropertyList
        items={[
          {
            label: '整理方式',
            value: (
              <span className="grid gap-0.5">
                <span>自动化整理</span>
                <span className="text-fg-muted text-caption">由程序从{official ? '官方目录与' : ''}本院归档资料收录、比对目录信息，结果只读</span>
              </span>
            ),
          },
          {
            label: '官方目录',
            value: official ? '已列入本库取得的官方目录' : <span className="text-fg-muted">本库未登记这项标准的官方目录记录</span>,
          },
          {
            label: '状态依据',
            value:
              data.status === 'unverified' ? (
                <span className="grid gap-0.5">
                  <span>尚未登记能核实这项标准状态的权威依据</span>
                  <span className="text-fg-muted text-caption">状态与日期待核实；不能因为没有废止日期就当作现行。</span>
                </span>
              ) : (
                <span className="grid gap-0.5">
                  {c.basis_note && <span>{c.basis_note}</span>}
                  {c.basis_url && (
                    <a className="text-fg-secondary break-all hover:underline" href={c.basis_url} target="_blank" rel="noreferrer">
                      官方详情页
                    </a>
                  )}
                  {!c.basis_note && !c.basis_url && <span className="text-fg-muted">核实依据未登记</span>}
                </span>
              ),
          },
          {
            label: '原文',
            icon: File02Icon,
            value:
              data.files.length === 0 ? (
                <span className="text-fg-muted">本库暂未收录原文</span>
              ) : (
                <span className="grid gap-0.5">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {texts(data).length > 0 ? `原文 ${texts(data).length} 份` : `附件 ${data.files.length} 份`}
                    <span className="text-fg-muted">（{channels.join('、')}）</span>
                    <ReadOriginal data={data} onMany={() => show('files')} inline />
                  </span>
                  <span className="text-fg-muted text-caption">入库时已按文件摘要核对，与登记的文件一致；这不说明内容已逐字复核</span>
                </span>
              ),
          },
          {
            label: '结构化内容',
            icon: Layers01Icon,
            value: structured ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Counts counts={data.counts} />
                <InlineAction onClick={() => show('content')}>查看</InlineAction>
              </span>
            ) : (
              <span className="text-fg-muted">本库暂未展示这项标准的结构化内容</span>
            ),
          },
          corrections.length > 0 && {
            label: '人工更正',
            value: (
              <span className="grid gap-0.5">
                <span>
                  {corrections.map((k) => `${CORR_FIELD[k.field ?? ''] ?? k.field}（${k.correction_key}，${k.confirmed_by} 确认）`).join('、')}
                </span>
                <span className="text-fg-muted text-caption">只更正所列字段，不表示整份标准已人工审核</span>
              </span>
            ),
          },
          !c.difference &&
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
      <p className="text-fg-muted text-caption">
        {archiveDiffs > 0 && `本院归档资料里有 ${archiveDiffs} 条记录的写法与当前目录不同；`}
        取得渠道、各来源原样写法与登记历史见
        <InlineAction onClick={() => show('records')}>整理记录</InlineAction>。只读参考，不表示医院已采用。
      </p>
    </Section>
  )
}

// ---------------------------------------------------------------- 整理记录（来源对照、人工更正、处理修订、登记历史）

function CurationRecords({ data }: { data: StandardEditionDetail }) {
  const c = data.current
  return (
    <>
      <Section title="目录维护信息">
        <PropertyList
          items={[
            { label: '官网写法', value: c.catalog_code },
            { label: '官网分类', value: c.catalog_category },
            { label: '核实日期', icon: Calendar03Icon, value: c.verified_on },
            {
              label: '核实依据',
              value:
                c.basis_url || c.basis_note ? (
                  <span className="grid gap-0.5">
                    {c.basis_note && <span>{c.basis_note}</span>}
                    {c.basis_url && (
                      <a className="text-fg-secondary break-all hover:underline" href={c.basis_url} target="_blank" rel="noreferrer">
                        {c.basis_url}
                      </a>
                    )}
                  </span>
                ) : null,
            },
            c.difference && { label: '差异类别', value: <Tag tone="yellow">{c.difference}</Tag> },
            c.file_identity && { label: '文件内标识', value: c.file_identity },
            c.note && { label: '整理说明', value: c.note },
          ].filter((x) => !!x)}
        />
        <p className="text-fg-muted text-caption">官方目录条目是入口，文件封面是证据；两边写法都保留，不按封面改写目录。</p>
      </Section>
      <ClaimsSection data={data} />
      {(data.corrections ?? []).length > 0 && <CorrectionsSection data={data} />}
      {data.revisions.length > 0 && (
        <Section title={`结构化处理修订（${data.revisions.length}）`}>
          <Records data={data} />
          <p className="text-fg-muted text-caption">读取器版本是本库的处理修订，不是标准版本；标准原文年份不变。</p>
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

/** 与当前目录值不同的格子标黄；来源没写（空）不算不同 */
function Diff({ value, current }: { value?: string | null; current?: string | null }) {
  if (!value) return <span className="text-fg-muted">—</span>
  return differs(value, current) ? (
    <span className="bg-tag-yellow-bg text-tag-yellow-text rounded-sm px-1" title={`当前目录：${current ?? '未登记'}`}>
      {value}
    </span>
  ) : (
    <>{value}</>
  )
}

function ClaimsSection({ data }: { data: StandardEditionDetail }) {
  const c = data.current
  const claims = data.claims ?? []
  return (
    <Section title={`各来源写法（${claims.length}）`}>
      {claims.length === 0 ? (
        <p className="text-fg-muted text-xs">没有登记来源记录。</p>
      ) : (
        <DbTable
          columns={[
            { label: '来源', className: 'min-w-40' },
            { label: '标准号写法' },
            { label: '名称', className: 'min-w-48' },
            { label: '来源记载的状态', className: 'min-w-32' },
            { label: '实施日期', icon: Calendar03Icon },
            { label: '原文' },
          ]}
        >
          {claims.map((cl) => (
            <DbRow key={cl.id}>
              <DbCell>
                <div className="text-fg-strong">{claimChannel(cl.source)}</div>
                <div className="text-fg-muted text-caption break-all">
                  {cl.source}
                  {cl.recorded_at ? ` · ${cl.recorded_at.slice(0, 10)}` : ''}
                </div>
                <details className="text-caption">
                  <summary className="text-fg-muted hover:text-fg cursor-pointer">来源与原记录</summary>
                  <dl className="text-fg-secondary mt-1 grid max-w-md grid-cols-[auto_1fr] gap-x-2 break-all">
                    <dt className="text-fg-muted">来源文件</dt>
                    <dd>
                      {cl.source_file || '—'} · <span className="font-mono">{cl.source_sha256.slice(0, 12)}…</span>
                    </dd>
                    <dt className="text-fg-muted">记录位置</dt>
                    <dd className="font-mono">{cl.record_key}</dd>
                    <dt className="text-fg-muted">发布日期</dt>
                    <dd className="tabular-nums">{cl.issued || '—'}</dd>
                    <dt className="text-fg-muted">废止日期</dt>
                    <dd className="tabular-nums">{cl.abolished || '—'}</dd>
                    <dt className="text-fg-muted">地址</dt>
                    <dd>{cl.url || '来源未写'}</dd>
                    {cl.file_sha256 && (
                      <>
                        <dt className="text-fg-muted">文件摘要</dt>
                        <dd className="font-mono">{cl.file_sha256}</dd>
                      </>
                    )}
                  </dl>
                  <pre className="bg-surface-subtle text-fg-secondary mt-1 max-w-md overflow-x-auto rounded-md p-2 whitespace-pre-wrap">
                    {JSON.stringify(cl.raw, null, 2)}
                  </pre>
                </details>
              </DbCell>
              <DbCell className="whitespace-nowrap">
                <div className="text-fg-secondary">{cl.code_as_written || '—'}</div>
                {cl.linked_by === 'file' && <Tag tone="yellow">按文件关联</Tag>}
              </DbCell>
              <DbCell className="text-fg">
                <Diff value={cl.title} current={c.title} />
              </DbCell>
              <DbCell className="text-fg-secondary">{cl.status || <span className="text-fg-muted">—</span>}</DbCell>
              <DbCell className="text-fg tabular-nums whitespace-nowrap">
                <Diff value={cl.effective} current={c.effective_on} />
              </DbCell>
              <DbCell className="whitespace-nowrap">
                {cl.file_id ? (
                  <InlineLink to={fileViewerPath(data.id, cl.file_id)}>打开原文</InlineLink>
                ) : cl.file_sha256 ? (
                  <span className="text-fg-muted">本条下没有这份文件</span>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </DbCell>
            </DbRow>
          ))}
        </DbTable>
      )}
      <p className="text-fg-muted text-caption">
        每行是一条来源记录的原样写法，只说明该来源当时这样记载，不改当前目录；冲突全部保留，同一文件出现在多个归档里不算多份独立证据。名称、实施日期与当前目录（名称“{c.title}”，实施日期{' '}
        {c.effective_on ?? '未登记'}）不同时标黄。“按文件关联”表示这条记录写的标准号与本条不同，只因指向的文件在本条下而列出。
      </p>
    </Section>
  )
}

function CorrectionsSection({ data }: { data: StandardEditionDetail }) {
  return (
    <Section title={`人工更正（${(data.corrections ?? []).length}）`}>
      <ul className="grid gap-3">
        {(data.corrections ?? []).map((k) => (
          <li key={k.correction_key} className="grid gap-0.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-fg-strong font-mono">{k.correction_key}</span>
              {k.action === 'CORRECT' ? (
                <>
                  <span className="text-fg-strong">
                    {CORR_FIELD[k.field ?? ''] ?? k.field} → {k.clears ? '（清空）' : k.new_value}
                  </span>
                  {k.withdrawn_by ? <Tag tone="gray">已由 {k.withdrawn_by} 撤销</Tag> : <Tag tone="green">生效</Tag>}
                </>
              ) : (
                <span className="text-fg-strong">撤销 {k.withdraws_key}</span>
              )}
            </div>
            {k.note && <div className="text-fg-secondary">{k.note}</div>}
            <div className="text-fg-muted text-caption">
              确认：{k.confirmed_by} · {k.confirmed_on}
              {k.basis_url && (
                <>
                  {' · '}
                  <a className="hover:text-fg underline" href={k.basis_url} target="_blank" rel="noreferrer">
                    依据
                  </a>
                </>
              )}
              {k.basis_pages && <> · {k.basis_pages}</>}
              {k.basis_sha256 && <> · 依据文件 {k.basis_sha256.slice(0, 12)}…</>}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-fg-muted text-caption">
        人工更正只改目录描述，记在仓库的更正表里，逐行写明依据与确认人；撤销另起一行，旧的照样可查。只更正所列字段，不表示整份标准已人工审核，也不表示医院已采用。
      </p>
    </Section>
  )
}

function Files({ data }: { data: StandardEditionDetail }) {
  if (data.files.length === 0)
    return (
      <Callout tone="info" title="本库暂未收录原文">
        这项标准目前只有目录信息。
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
      <FileTable files={data.files} open={(f) => fileViewerPath(data.id, f.id)} />
      <p className="text-fg-muted text-caption">
        {pages.length > 0 && '原页图一张是一页，不是完整原文；'}
        同版有多份不同字节的正文时并列保留，不指定首选。取得渠道不等于身份已核对，下载成功也不等于现行。
      </p>
    </>
  )
}

/** 文件按角色给可读标题（同角色多份时编号）；真实文件名、摘要、来源、身份核对与整理备注在“文件信息”里 */
function FileTable({ files, open }: { files: StandardFileOut[]; open: (f: StandardFileOut) => string }) {
  const seen: Record<string, number> = {}
  const many = (role: string) => files.filter((f) => f.role === role).length > 1
  return (
    <DbTable
      columns={[
        { label: '文件', icon: File02Icon, className: 'min-w-64' },
        { label: '取得方式' },
        { label: '大小' },
        { label: '' },
      ]}
    >
      {files.map((f) => {
        seen[f.role] = (seen[f.role] ?? 0) + 1
        return (
          <DbRow key={f.id}>
            <DbCell>
              <span className="text-fg-strong">
                {ROLE_LABEL[f.role]}
                {many(f.role) && ` ${seen[f.role]}`}
              </span>
              <details className="text-caption">
                <summary className="text-fg-muted hover:text-fg cursor-pointer">文件信息</summary>
                <dl className="text-fg-secondary mt-1 grid max-w-lg grid-cols-[auto_1fr] gap-x-2 break-all">
                  <dt className="text-fg-muted">文件名</dt>
                  <dd>{f.file_name}</dd>
                  <dt className="text-fg-muted">摘要</dt>
                  <dd className="font-mono">{f.sha256}</dd>
                  <dt className="text-fg-muted">来源</dt>
                  <dd>{f.source}</dd>
                  <dt className="text-fg-muted">身份核对</dt>
                  <dd>{f.identity_check}</dd>
                  <dt className="text-fg-muted">登记时间</dt>
                  <dd className="tabular-nums">{stamp(f.registered_at)}</dd>
                  {f.note && (
                    <>
                      <dt className="text-fg-muted">整理备注</dt>
                      <dd>{f.note}</dd>
                    </>
                  )}
                </dl>
              </details>
            </DbCell>
            <DbCell className="text-fg-secondary whitespace-nowrap">{fileChannel(f.source)}</DbCell>
            <DbCell className="text-fg-secondary tabular-nums whitespace-nowrap">{formatBytes(f.bytes)}</DbCell>
            <DbCell className="whitespace-nowrap">
              <InlineLink to={open(f)}>{f.page_image ? '查看' : '阅读'}</InlineLink>
            </DbCell>
          </DbRow>
        )
      })}
    </DbTable>
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
  return (
    <FileViewer
      owner={
        <Link className="hover:underline" to={editionPath(data.id)}>
          {data.title}（{standardLabel(data.standard_no, data.standard_year)}）
        </Link>
      }
      file={file}
      page={page}
    />
  )
}

/** 参考资料的原文页：与标准原文页同一显示，所属对象换成参考资料 */
export function ReferenceFileViewerPage() {
  usePageFrame('canvas')
  const params = useParams()
  const refId = Number(params.id)
  const fileId = Number(params.fileId)
  const valid = Number.isInteger(refId) && Number.isInteger(fileId)
  const query = useGetReferenceMaterial(refId, { query: { enabled: valid } })
  const { data } = query
  const file = data?.files.find((f) => f.id === fileId)
  useCrumb(data && file && !isDenial(query.error) ? `${data.title} 原文` : null)
  if (!data || isDenial(query.error) || !file)
    return (
      <DetailFallback
        what="原文文件"
        back={{ to: data ? referencePath(data.id) : '/standards/library?kind=reference', label: data ? '返回参考资料' : '返回参考资料列表' }}
        query={data && !file ? { isError: true, error: new ApiError(404, null, '找不到这个原文文件'), refetch: query.refetch } : query}
        invalid={!valid}
      />
    )
  return (
    <FileViewer
      owner={
        <Link className="hover:underline" to={referencePath(data.id)}>
          {data.title}（{CATEGORY[data.category].label}）
        </Link>
      }
      file={file}
      page={null}
    />
  )
}

function FileViewer({ owner, file, page }: { owner: ReactNode; file: StandardFileOut; page: number | null }) {
  const state = useStandardFileUrl(file.id)
  const showable = file.media_type === 'application/pdf' || file.media_type.startsWith('image/')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={file.file_name}
        meta={
          <>
            {owner} · {ROLE_LABEL[file.role]} · {fileChannel(file.source)} · {formatBytes(file.bytes)}
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
