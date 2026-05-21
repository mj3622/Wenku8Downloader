import { useBookStore } from '../stores/bookStore'

export default function SearchByIdPage() {
  const { book, loading, error, fetchBook } = useBookStore()

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">编号检索</h2>
      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
          placeholder="请输入作品编号或链接，例如：3057"
          onKeyDown={(e) => {
            if (e.key === 'Enter') fetchBook(e.currentTarget.value)
          }}
        />
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
          onClick={() => {
            const input = document.querySelector('input') as HTMLInputElement
            if (input?.value) fetchBook(input.value)
          }}
        >
          查询
        </button>
      </div>
      {loading && <p className="text-gray-400">查询中...</p>}
      {error && <p className="text-red-400">{error}</p>}
      {book && (
        <div className="p-4 rounded-lg border border-gray-800">
          <h3 className="text-lg font-semibold">{book.basic_info['标题']}</h3>
          <div className="text-sm text-gray-400 mt-2 space-y-1">
            {Object.entries(book.basic_info).map(([k, v]) =>
              k !== '标题' && k !== 'cover' ? (
                <p key={k}><span className="text-gray-500">{k}：</span>{v}</p>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  )
}
