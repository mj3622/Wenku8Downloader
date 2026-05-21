import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSearchStore } from '../stores/searchStore'
import BookQueryInput from '../components/BookQueryInput'
import SearchResultList from '../components/SearchResultList'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

type Tab = 'id' | 'author' | 'title'

const tabs: { key: Tab; label: string }[] = [
  { key: 'id', label: '编号检索' },
  { key: 'author', label: '作者检索' },
  { key: 'title', label: '书名检索' },
]

export default function SearchPage() {
  const [tab, setTab] = useState<Tab>('id')
  const { results, loading: searchLoading, error: searchError, search, clear: clearSearch } = useSearchStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null
    if (t && tabs.some((tb) => tb.key === t)) {
      setTab(t)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id: string) => {
    navigate(`/book/${id}`)
  }

  const handleSearch = (type: 'author' | 'title', value: string) => {
    if (!value.trim()) return
    search(type, value.trim())
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-apple-heading mb-4">检索</h2>
      <div className="flex gap-1 mb-6 border-b border-apple-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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
          type="author"
          placeholder="例如：橘公司"
          results={results}
          loading={searchLoading}
          error={searchError}
          onSearch={(v) => handleSearch('author', v)}
          onSelect={handleSelect}
          onClear={clearSearch}
        />
      )}

      {tab === 'title' && (
        <SearchTab
          type="title"
          placeholder="例如：败犬女主"
          results={results}
          loading={searchLoading}
          error={searchError}
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
  type, placeholder, results, loading, error, onSearch, onSelect, onClear,
}: {
  type: 'author' | 'title'
  placeholder: string
  results: ReturnType<typeof useSearchStore.getState>['results']
  loading: boolean
  error: string | null
  onSearch: (value: string) => void
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const label = type === 'author' ? '请输入轻小说文库的作者' : '请输入轻小说文库的作品名称'

  return (
    <div>
      <div className="flex items-end gap-2 mb-6">
        <div className="flex-1">
          <label className="block text-sm text-apple-secondary mb-1">{label}</label>
          <input
            className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                       focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch((e.target as HTMLInputElement).value)
            }}
          />
        </div>
        <button
          disabled={loading}
          className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                     rounded-[24px] text-[13px] font-medium text-white transition-opacity"
          onClick={() => {
            const input = document.querySelector<HTMLInputElement>(
              `input[placeholder="${placeholder}"]`
            )
            if (input?.value.trim()) onSearch(input.value.trim())
          }}
        >
          {loading ? '查询中...' : '查询'}
        </button>
      </div>
      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={onClear} />}
      {!loading && !error && results.length === 0 && (
        <p className="text-sm text-apple-tertiary">
          {type === 'author' ? '输入作者名开始搜索' : '输入书名开始搜索'}
        </p>
      )}
      <SearchResultList results={results} onSelect={onSelect} />
    </div>
  )
}
