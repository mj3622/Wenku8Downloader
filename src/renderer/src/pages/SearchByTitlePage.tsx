import { useNavigate } from 'react-router-dom'
import { useSearchStore } from '../stores/searchStore'
import SearchResultList from '../components/SearchResultList'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

export default function SearchByTitlePage() {
  const { results, loading, error, search, clear } = useSearchStore()
  const navigate = useNavigate()

  const handleSelect = (id: string) => {
    navigate(`/search/id?id=${id}`)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">按书名搜索</h2>
      <div className="flex items-end gap-2 mb-6">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-1">请输入轻小说文库的作品名称</label>
          <input
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                       focus:outline-none focus:border-blue-500 transition-colors"
            placeholder="例如：败犬女主"
            onKeyDown={(e) => {
              if (e.key === 'Enter') search('title', (e.target as HTMLInputElement).value)
            }}
          />
        </div>
        <button
          disabled={loading}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                     rounded text-sm font-medium transition-colors"
          onClick={() => {
            const input = document.querySelector<HTMLInputElement>('input[placeholder*="作品名称"]')
            if (input?.value.trim()) search('title', input.value.trim())
          }}
        >
          {loading ? '查询中...' : '查询'}
        </button>
      </div>
      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={clear} />}
      {!loading && !error && results.length === 0 && (
        <p className="text-sm text-gray-500">输入书名开始搜索</p>
      )}
      <SearchResultList results={results} onSelect={handleSelect} />
    </div>
  )
}
