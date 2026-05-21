import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'
import BookQueryInput from '../components/BookQueryInput'
import BookInfoCard from '../components/BookInfoCard'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

export default function FullDownloadPage() {
  const { book, loading, error, fetchBook, clear: clearBook } = useBookStore()
  const { downloading, error: dlError, success, downloadEpub, clear: clearDl } = useDownloadStore()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      fetchBook(id)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">整本下载</h2>
      <BookQueryInput
        label="请输入轻小说文库的作品编号或链接"
        help="例如：3057 或 https://www.wenku8.net/book/3057.htm"
        onQuery={fetchBook}
        loading={loading}
      />
      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={clearBook} />}
      {book && (
        <div className="space-y-4">
          <BookInfoCard book={book} />
          <button
            disabled={downloading}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50
                       rounded text-sm font-medium transition-colors"
            onClick={() => downloadEpub(book.book_id)}
          >
            {downloading ? '下载中...' : '下载整本 EPUB'}
          </button>
          {dlError && <StatusAlert type="error" message={dlError} onDismiss={clearDl} />}
          {success && <StatusAlert type="success" message={success} onDismiss={clearDl} />}
        </div>
      )}
    </div>
  )
}
