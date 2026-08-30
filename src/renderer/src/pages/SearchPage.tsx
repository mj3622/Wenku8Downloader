import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { IconBookOff, IconSearch } from '@tabler/icons-react'
import { useSearchStore } from '../stores/searchStore'
import BookQueryInput from '../components/BookQueryInput'
import SearchResultList from '../components/SearchResultList'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'
import { toast } from '../stores/toastStore'

type Tab = 'id' | 'author' | 'title'

const tabs: { key: Tab; label: string }[] = [
  { key: 'title', label: '书名检索' },
  { key: 'author', label: '作者检索' },
  { key: 'id', label: '编号检索' },
]

export default function SearchPage() {
  const {
    results,
    loading: searchLoading,
    error: searchError,
    hasSearched,
    lastType,
    lastQuery,
    retryAt,
    cached,
    search,
    clear: clearSearch,
  } = useSearchStore()
  const [tab, setTab] = useState<Tab>(lastType ?? 'title')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const routeTab = searchParams.get('tab')
    if (routeTab) {
      if (tabs.some((item) => item.key === routeTab)) {
        setTab(routeTab as Tab)
      } else {
        setTab('title')
        toast.warning({
          title: '检索方式无效',
          message: '已为你切换到书名检索，请重新选择。',
        })
        setSearchParams({}, { replace: true })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id: string) => {
    navigate(`/book/${id}`)
  }

  const handleSearch = (type: 'author' | 'title', value: string) => {
    search(type, value.trim())
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-apple-heading mb-2">检索</h1>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
      <div role="group" aria-label="检索方式" className="mb-6 flex gap-1 border-b border-apple-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => {
              if (tab !== t.key) clearSearch()
              setTab(t.key)
              setSearchParams(t.key === 'title' ? {} : { tab: t.key }, { replace: true })
            }}
            className={`border-b-2 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25 ${
              tab === t.key
                ? 'border-apple-accent font-medium text-apple-accent'
                : 'border-transparent text-apple-secondary hover:text-apple-heading'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'id' && (
        <IdTab onQuery={(id) => navigate(`/book/${id}`)} />
      )}

      {tab === 'author' && (
        <SearchTab
          key="author"
          type="author"
          placeholder="例如：三上库太"
          results={results}
          loading={searchLoading}
          error={searchError}
          hasSearched={hasSearched}
          lastQuery={lastQuery}
          retryAt={retryAt}
          cached={cached}
          onSearch={(v) => handleSearch('author', v)}
          onSelect={handleSelect}
          onClear={clearSearch}
        />
      )}

      {tab === 'title' && (
        <SearchTab
          key="title"
          type="title"
          placeholder="例如：败犬"
          results={results}
          loading={searchLoading}
          error={searchError}
          hasSearched={hasSearched}
          lastQuery={lastQuery}
          retryAt={retryAt}
          cached={cached}
          onSearch={(v) => handleSearch('title', v)}
          onSelect={handleSelect}
          onClear={clearSearch}
        />
      )}
    </div>
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
          <label htmlFor={inputId} className="block text-sm text-apple-secondary mb-1">{label}</label>
          <input
            id={inputId}
            ref={inputRef}
            className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                       focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
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
          className="motion-pressable inline-flex items-center gap-1.5 rounded-[24px] bg-apple-accent px-6 py-2.5 text-[13px]
                     font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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

      {error && (
        <StatusAlert type="error" message={error} onDismiss={onClear} announce={false} />
      )}

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
          {lastQuery && (
            <p className="mb-3 text-xs text-apple-tertiary">
              “{lastQuery}”的搜索结果
            </p>
          )}
          <SearchResultList results={results} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}
