import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSearchStore } from '../stores/searchStore'
import BookQueryInput from '../components/BookQueryInput'
import SearchResultList from '../components/SearchResultList'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'
import { toast } from '../stores/toastStore'

type Tab = 'id' | 'author' | 'title'

const tabs: { key: Tab; label: string }[] = [
  { key: 'id', label: '编号检索' },
  { key: 'author', label: '作者检索' },
  { key: 'title', label: '书名检索' },
]

export default function SearchPage() {
  const [tab, setTab] = useState<Tab>('id')
  const {
    results,
    loading: searchLoading,
    error: searchError,
    hasSearched,
    lastQuery,
    search,
    clear: clearSearch,
  } = useSearchStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const routeTab = searchParams.get('tab')
    if (routeTab) {
      if (tabs.some((item) => item.key === routeTab)) {
        setTab(routeTab as Tab)
      } else {
        toast.warning({
          title: '检索方式无效',
          message: '已为你切换到编号检索，请重新选择。',
        })
      }
      setSearchParams({}, { replace: true })
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
      <h2 className="text-2xl font-bold text-apple-heading mb-2">检索</h2>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
      <div className="flex gap-1 mb-6 border-b border-apple-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => {
              if (tab !== t.key) clearSearch()
              setTab(t.key)
            }}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'border-b-2 border-apple-accent text-apple-accent font-medium'
                : 'text-apple-secondary hover:text-apple-heading'
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
          onSearch={(v) => handleSearch('author', v)}
          onSelect={handleSelect}
          onClear={clearSearch}
        />
      )}

      {tab === 'title' && (
        <SearchTab
          key="title"
          type="title"
          placeholder="例如：败犬女主"
          results={results}
          loading={searchLoading}
          error={searchError}
          hasSearched={hasSearched}
          lastQuery={lastQuery}
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
    </div>
  )
}

function SearchTab({
  type, placeholder, results, loading, error, hasSearched, lastQuery, onSearch, onSelect, onClear,
}: {
  type: 'author' | 'title'
  placeholder: string
  results: ReturnType<typeof useSearchStore.getState>['results']
  loading: boolean
  error: string | null
  hasSearched: boolean
  lastQuery: string | null
  onSearch: (value: string) => void
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const label = type === 'author' ? '请输入轻小说文库的作者' : '请输入轻小说文库的作品名称'
  const emptyText = type === 'author' ? '输入作者名开始搜索' : '输入书名开始搜索'
  const exampleText = type === 'author' ? '例如：三上库太' : '例如：败犬女主太多了！'
  const [value, setValue] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = `search-${type}`
  const errorId = `${inputId}-error`

  const submit = () => {
    if (loading) return
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
      <div className="flex items-end gap-2 mb-6">
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          {fieldError && (
            <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldError}
            </p>
          )}
        </div>
        <button
          disabled={loading}
          className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                     rounded-[24px] text-[13px] font-medium text-white transition-opacity"
          onClick={submit}
        >
          {loading ? '查询中...' : '查询'}
        </button>
      </div>

      {loading && <LoadingSpinner text="正在查询中..." />}

      {error && (
        <StatusAlert type="error" message={error} onDismiss={onClear} announce={false} />
      )}

      {!loading && !error && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <svg
            className="w-12 h-12 text-apple-tertiary mb-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className="text-sm text-apple-tertiary mb-1">
            {hasSearched && lastQuery ? `没有找到与“${lastQuery}”相关的作品` : emptyText}
          </p>
          {!hasSearched && <p className="text-xs text-apple-tertiary/60">{exampleText}</p>}
        </div>
      )}

      {results.length > 0 && (
        <div className="px-2">
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
