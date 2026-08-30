import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  IconBookOff,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import {
  CATALOG_ANIMATIONS,
  CATALOG_INITIALS,
  CATALOG_PUBLISHER_OPTIONS,
  CATALOG_SORTS,
  CATALOG_STATUSES,
  CATALOG_TAGS,
  type CatalogInitial,
  type CatalogQuery,
  type CatalogTag,
} from '../../../shared/ipc-types'
import BookQueryInput from '../components/BookQueryInput'
import CatalogFilters from '../components/CatalogFilters'
import LoadingSpinner from '../components/LoadingSpinner'
import Pagination from '../components/Pagination'
import SearchResultList from '../components/SearchResultList'
import StatusAlert from '../components/StatusAlert'
import {
  DEFAULT_CATALOG_QUERY,
  useCatalogStore,
} from '../stores/catalogStore'
import { useSearchStore } from '../stores/searchStore'
import { toast } from '../stores/toastStore'

type Tab = 'browse' | 'title' | 'author' | 'id'

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'browse', label: '浏览' },
  { key: 'title', label: '书名' },
  { key: 'author', label: '作者' },
  { key: 'id', label: '编号' },
]

const PUBLISHERS = new Set<string>(CATALOG_PUBLISHER_OPTIONS.map(option => option.value))
const ROUTE_KEYS = new Set([
  'tab', 'publisher', 'initial', 'tag', 'status', 'animation', 'sort', 'page',
])

function catalogQueryKey(query: CatalogQuery): string {
  return JSON.stringify([
    query.publisher ?? '',
    query.initial ?? '',
    query.tag ?? '',
    query.status,
    query.animation,
    query.sort,
    query.page,
  ])
}

function buildSearchParams(tab: Tab, query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (tab !== 'browse') params.set('tab', tab)
  if (query.publisher) params.set('publisher', query.publisher)
  if (query.initial) params.set('initial', query.initial)
  if (query.tag) params.set('tag', query.tag)
  if (query.status !== 'all') params.set('status', query.status)
  if (query.animation !== 'all') params.set('animation', query.animation)
  if (query.sort !== 'lastupdate') params.set('sort', query.sort)
  if (query.page !== 1) params.set('page', String(query.page))
  return params
}

function parseRoute(params: URLSearchParams): {
  tab: Tab
  query: CatalogQuery
  invalid: boolean
} {
  let invalid = Array.from(params.keys()).some(key => !ROUTE_KEYS.has(key))
  const rawTab = params.get('tab') ?? 'browse'
  const tab = tabs.some(item => item.key === rawTab) ? rawTab as Tab : 'browse'
  if (tab !== rawTab) invalid = true

  const query: CatalogQuery = { ...DEFAULT_CATALOG_QUERY }
  const publisher = params.get('publisher')
  if (publisher !== null) {
    if (PUBLISHERS.has(publisher)) query.publisher = publisher as CatalogQuery['publisher']
    else invalid = true
  }
  const initial = params.get('initial')
  if (initial !== null) {
    if (CATALOG_INITIALS.includes(initial as CatalogInitial)) {
      query.initial = initial as CatalogInitial
    } else invalid = true
  }
  const tag = params.get('tag')
  if (tag !== null) {
    if (CATALOG_TAGS.includes(tag as CatalogTag)) query.tag = tag as CatalogTag
    else invalid = true
  }
  const status = params.get('status')
  if (status !== null) {
    if (CATALOG_STATUSES.includes(status as CatalogQuery['status'])) {
      query.status = status as CatalogQuery['status']
    } else invalid = true
  }
  const animation = params.get('animation')
  if (animation !== null) {
    if (CATALOG_ANIMATIONS.includes(animation as CatalogQuery['animation'])) {
      query.animation = animation as CatalogQuery['animation']
    } else invalid = true
  }
  const sort = params.get('sort')
  if (sort !== null) {
    if (CATALOG_SORTS.includes(sort as CatalogQuery['sort'])) {
      query.sort = sort as CatalogQuery['sort']
    } else invalid = true
  }
  const page = params.get('page')
  if (page !== null) {
    const parsed = Number(page)
    if (/^\d+$/.test(page) && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 500) {
      query.page = parsed
    } else invalid = true
  }

  if (query.tag && (query.publisher || query.initial)) {
    delete query.publisher
    delete query.initial
    invalid = true
  }
  if ((query.publisher || query.initial) && query.sort === 'allvisit') {
    query.sort = 'lastupdate'
    invalid = true
  }
  return { tab, query, invalid }
}

function searchHref(query: CatalogQuery): string {
  const params = buildSearchParams('browse', query).toString()
  return params ? `/search?${params}` : '/search'
}

export default function SearchPage() {
  const searchState = useSearchStore()
  const catalogState = useCatalogStore()
  const [tab, setTab] = useState<Tab>('browse')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const route = useMemo(() => parseRoute(new URLSearchParams(paramsKey)), [paramsKey])
  const warnedRoutes = useRef(new Set<string>())

  useEffect(() => {
    setTab(route.tab)
    if (route.invalid && !warnedRoutes.current.has(paramsKey)) {
      warnedRoutes.current.add(paramsKey)
      toast.warning({
        title: '找书条件已调整',
        message: '无效或冲突的条件已恢复为可用设置',
      })
      setSearchParams(buildSearchParams(route.tab, route.query), { replace: true })
    }
    const current = useCatalogStore.getState()
    if (route.tab !== 'browse') {
      if (catalogQueryKey(current.query) !== catalogQueryKey(route.query)) {
        current.setQuery(route.query)
      }
      return
    }

    const hasCurrentResult = current.hasLoaded
      && catalogQueryKey(current.query) === catalogQueryKey(route.query)
    if (!hasCurrentResult) void current.load(route.query)
  }, [paramsKey, route, setSearchParams])

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab)
    setSearchParams(buildSearchParams(nextTab, catalogState.query))
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectTab(tabs[nextIndex].key)
    document.getElementById(`find-book-tab-${tabs[nextIndex].key}`)?.focus()
  }

  const changeCatalogFilters = (
    filters: Partial<Omit<CatalogQuery, 'page'>>,
  ) => {
    catalogState.setFilters(filters)
    const next = useCatalogStore.getState().query
    setSearchParams(buildSearchParams('browse', next))
  }

  const resetCatalog = () => {
    catalogState.clear()
    const params = buildSearchParams('browse', DEFAULT_CATALOG_QUERY)
    if (params.toString() === paramsKey) void useCatalogStore.getState().load(DEFAULT_CATALOG_QUERY)
    else setSearchParams(params)
  }

  const handleSelect = (id: string) => navigate(`/book/${id}`)
  const activeSearch = searchState.lastType

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold text-apple-heading">找书</h1>
      <div className="mb-4 h-1 w-11 rounded-full bg-apple-accent" />
      <div
        role="tablist"
        aria-label="找书方式"
        className="mb-6 flex gap-1 border-b border-apple-border-subtle"
      >
        {tabs.map((item, index) => (
          <button
            key={item.key}
            id={`find-book-tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            aria-controls={`find-book-panel-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => selectTab(item.key)}
            onKeyDown={event => handleTabKeyDown(event, index)}
            className={`border-b-2 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25 ${
              tab === item.key
                ? 'border-apple-accent font-medium text-apple-accent'
                : 'border-transparent text-apple-secondary hover:text-apple-heading'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="find-book-panel-browse"
        role="tabpanel"
        aria-labelledby="find-book-tab-browse"
        hidden={tab !== 'browse'}
      >
        <CatalogFilters
          query={catalogState.query}
          loading={catalogState.loading}
          onChange={changeCatalogFilters}
          onReset={resetCatalog}
          onRefresh={() => void catalogState.load(catalogState.query, true)}
        />
        <CatalogResults
          state={catalogState}
          onSelect={handleSelect}
          onRetry={() => void catalogState.load(catalogState.query, true)}
        />
      </div>

      <div
        id="find-book-panel-title"
        role="tabpanel"
        aria-labelledby="find-book-tab-title"
        hidden={tab !== 'title'}
      >
        <SearchTab
          type="title"
          placeholder="例如：败犬"
          results={activeSearch === 'title' ? searchState.results : []}
          loading={activeSearch === 'title' && searchState.loading}
          error={activeSearch === 'title' ? searchState.error : null}
          hasSearched={activeSearch === 'title' && searchState.hasSearched}
          lastQuery={activeSearch === 'title' ? searchState.lastQuery : null}
          retryAt={activeSearch === 'title' ? searchState.retryAt : null}
          cached={activeSearch === 'title' && searchState.cached}
          onSearch={value => searchState.search('title', value.trim())}
          onSelect={handleSelect}
          onClear={searchState.clear}
        />
      </div>

      <div
        id="find-book-panel-author"
        role="tabpanel"
        aria-labelledby="find-book-tab-author"
        hidden={tab !== 'author'}
      >
        <SearchTab
          type="author"
          placeholder="例如：三上库太"
          results={activeSearch === 'author' ? searchState.results : []}
          loading={activeSearch === 'author' && searchState.loading}
          error={activeSearch === 'author' ? searchState.error : null}
          hasSearched={activeSearch === 'author' && searchState.hasSearched}
          lastQuery={activeSearch === 'author' ? searchState.lastQuery : null}
          retryAt={activeSearch === 'author' ? searchState.retryAt : null}
          cached={activeSearch === 'author' && searchState.cached}
          onSearch={value => searchState.search('author', value.trim())}
          onSelect={handleSelect}
          onClear={searchState.clear}
        />
      </div>

      <div
        id="find-book-panel-id"
        role="tabpanel"
        aria-labelledby="find-book-tab-id"
        hidden={tab !== 'id'}
      >
        <IdTab onQuery={id => navigate(`/book/${id}`)} />
      </div>
    </div>
  )
}

function CatalogResults({
  state,
  onSelect,
  onRetry,
}: {
  state: ReturnType<typeof useCatalogStore.getState>
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  const headingRef = useRef<HTMLDivElement>(null)
  const previousPage = useRef<number | null>(null)

  useEffect(() => {
    if (!state.result) return
    if (previousPage.current !== null && previousPage.current !== state.result.page) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      headingRef.current?.scrollIntoView?.({
        block: 'start',
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    }
    previousPage.current = state.result.page
  }, [state.result])

  if (state.loading && !state.result) return <LoadingSpinner text="正在读取轻小说列表..." />

  return (
    <section aria-label="找书结果">
      <div ref={headingRef} className="scroll-mt-6" />
      {state.result?.stale && (
        <StatusAlert type="warning" message="网络更新失败，当前显示最近缓存的找书结果" />
      )}
      {state.loading && state.result && (
        <p role="status" className="mb-3 inline-flex items-center gap-2 text-xs text-apple-secondary">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-apple-border-input border-t-apple-accent" />
          正在刷新结果
        </p>
      )}
      {state.error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] text-red-700">{state.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="motion-pressable inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            <IconRefresh aria-hidden="true" size={15} stroke={1.8} />
            重新加载
          </button>
        </div>
      )}

      {state.result && state.result.books.length > 0 && (
        <>
          <p className="mb-3 text-xs text-apple-tertiary">
            第 {state.result.page} 页 · 本页 {state.result.books.length} 本
          </p>
          <SearchResultList results={state.result.books} onSelect={onSelect} />
        </>
      )}

      {state.result && state.result.books.length === 0 && !state.loading && (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            <IconBookOff aria-hidden="true" size={22} stroke={1.7} />
          </div>
          <p className="mb-1 text-sm font-medium text-apple-secondary">当前页没有符合条件的作品</p>
          <p className="max-w-md text-xs leading-relaxed text-apple-tertiary">
            可以放宽筛选条件，或继续查看其他结果页
          </p>
        </div>
      )}

      {state.result && (
        <Pagination
          page={state.result.page}
          totalPages={state.result.totalPages}
          ariaLabel="找书分页"
          pageHref={page => searchHref({ ...state.query, page })}
        />
      )}
    </section>
  )
}

function IdTab({ onQuery }: { onQuery: (id: string) => void }) {
  return (
    <div>
      <BookQueryInput
        label="请输入轻小说文库的作品编号或链接"
        help="例如：3057 或 https://www.wenku8.net/book/3057.htm"
        onQuery={onQuery}
      />
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
          <IconSearch aria-hidden="true" size={22} stroke={1.7} />
        </div>
        <p className="mb-1 text-sm font-medium text-apple-secondary">输入作品编号开始检索</p>
        <p className="text-xs text-apple-tertiary">例如：3057 或 Wenku8 作品链接</p>
      </div>
    </div>
  )
}

function SearchTab({
  type, placeholder, results, loading, error, hasSearched, lastQuery, retryAt, cached,
  onSearch, onSelect, onClear,
}: {
  type: 'author' | 'title'
  placeholder: string
  results: ReturnType<typeof useSearchStore.getState>['results']
  loading: boolean
  error: string | null
  hasSearched: boolean
  lastQuery: string | null
  retryAt: number | null
  cached: boolean
  onSearch: (value: string) => void
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const label = type === 'author' ? '请输入轻小说文库的作者' : '请输入轻小说文库的作品名称'
  const emptyText = type === 'author' ? '输入作者名开始搜索' : '输入书名开始搜索'
  const exampleText = type === 'author' ? '例如：三上库太' : '例如：败犬'
  const [value, setValue] = useState(lastQuery ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = `search-${type}`
  const errorId = `${inputId}-error`
  const [now, setNow] = useState(() => Date.now())
  const cooldownSeconds = retryAt === null
    ? 0
    : Math.max(0, Math.ceil((retryAt - now) / 1_000))
  const coolingDown = cooldownSeconds > 0

  useEffect(() => {
    if (retryAt === null || retryAt <= Date.now()) return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= retryAt) window.clearInterval(timer)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  const submit = () => {
    if (loading || coolingDown) return
    const normalized = value.trim()
    if (!normalized) {
      setFieldError(type === 'author' ? '请输入作者名' : '请输入作品名称')
      inputRef.current?.focus()
      return
    }
    if (normalized.length > 100) {
      setFieldError('搜索内容不能超过 100 个字')
      inputRef.current?.focus()
      return
    }
    setFieldError(null)
    onSearch(normalized)
  }

  return (
    <div>
      <form
        className="mb-6 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex-1">
          <label htmlFor={inputId} className="mb-1 block text-sm text-apple-secondary">{label}</label>
          <input
            id={inputId}
            ref={inputRef}
            className="w-full rounded-xl border border-apple-border-input bg-apple-card px-3 py-2 text-sm text-apple-heading transition-colors focus:border-apple-accent/30 focus:outline-none focus:ring-2 focus:ring-apple-accent/10"
            placeholder={placeholder}
            value={value}
            maxLength={101}
            disabled={loading}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
          {fieldError && (
            <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || coolingDown}
          className="motion-pressable inline-flex items-center gap-1.5 rounded-[24px] bg-apple-accent px-6 py-2.5 text-[13px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconSearch aria-hidden="true" size={16} stroke={1.8} />
          {loading ? '查询中...' : coolingDown ? `${cooldownSeconds} 秒后重试` : '查询'}
        </button>
      </form>

      {coolingDown && (
        <p role="status" className="-mt-3 mb-5 text-xs text-amber-700">
          原站限制了搜索频率，请稍后重试
          {cached && results.length > 0 ? '，以下显示上次缓存结果' : ''}
        </p>
      )}

      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={onClear} announce={false} />}

      {!loading && !error && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            {hasSearched ? (
              <IconBookOff aria-hidden="true" size={22} stroke={1.7} />
            ) : (
              <IconSearch aria-hidden="true" size={22} stroke={1.7} />
            )}
          </div>
          <p className="mb-1 text-sm font-medium text-apple-secondary">
            {hasSearched && lastQuery ? `没有找到与“${lastQuery}”相关的作品` : emptyText}
          </p>
          {!hasSearched && <p className="text-xs text-apple-tertiary">{exampleText}</p>}
        </div>
      )}

      {results.length > 0 && (
        <div>
          {lastQuery && <p className="mb-3 text-xs text-apple-tertiary">“{lastQuery}”的搜索结果</p>}
          <SearchResultList results={results} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}
