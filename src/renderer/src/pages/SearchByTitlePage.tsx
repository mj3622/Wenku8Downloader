import { useSearchStore } from '../stores/searchStore'

export default function SearchByTitlePage() {
  const { results, loading, error, search } = useSearchStore()

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">按书名搜索</h2>
      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
          placeholder="请输入作品名称，例如：败犬女主"
          onKeyDown={(e) => {
            if (e.key === 'Enter') search('title', e.currentTarget.value)
          }}
        />
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
          onClick={() => {
            const input = document.querySelector('input') as HTMLInputElement
            if (input?.value) search('title', input.value)
          }}
        >
          查询
        </button>
      </div>
      {loading && <p className="text-gray-400">查询中...</p>}
      {error && <p className="text-red-400">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((item) => (
            <div key={item.id} className="p-3 rounded-lg border border-gray-800">
              <span className="font-medium">{item.title}</span>
              <span className="text-gray-500 text-sm ml-2">#{item.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
