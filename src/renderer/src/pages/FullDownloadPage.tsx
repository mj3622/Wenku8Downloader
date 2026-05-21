import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'

export default function FullDownloadPage() {
  const { book, fetchBook } = useBookStore()
  const { downloading, error, success, downloadEpub } = useDownloadStore()

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">整本下载</h2>
      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
          placeholder="请输入作品编号，例如：3057"
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
      {book && (
        <div className="p-4 rounded-lg border border-gray-800 mb-4">
          <h3 className="font-semibold">{book.basic_info['标题']}</h3>
          <button
            disabled={downloading}
            className="mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            onClick={() => downloadEpub(book.book_id)}
          >
            {downloading ? '下载中...' : '下载 EPUB'}
          </button>
        </div>
      )}
      {error && <p className="text-red-400">{error}</p>}
      {success && <p className="text-green-400">{success}</p>}
    </div>
  )
}
