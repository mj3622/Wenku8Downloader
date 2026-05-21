import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'
import BookQueryInput from '../components/BookQueryInput'
import BookInfoCard from '../components/BookInfoCard'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

export default function DividedDownloadPage() {
  const { book, loading, error, fetchBook, clear: clearBook } = useBookStore()
  const { downloading, error: dlError, success, downloadEpub, clear: clearDl } = useDownloadStore()
  const [selectedVolume, setSelectedVolume] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      fetchBook(id)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedVolume('')
  }, [book])

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">分卷下载</h2>
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
          <div className="flex items-end gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">选择要下载的卷</label>
              <select
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm min-w-[200px]
                           focus:outline-none focus:border-blue-500"
                value={selectedVolume}
                onChange={(e) => setSelectedVolume(e.target.value)}
              >
                <option value="">-- 请选择 --</option>
                {Object.keys(book.volumes).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <button
              disabled={downloading || !selectedVolume}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50
                         rounded text-sm font-medium transition-colors"
              onClick={() => downloadEpub(book.book_id, selectedVolume)}
            >
              {downloading ? '下载中...' : '下载'}
            </button>
          </div>
          {dlError && <StatusAlert type="error" message={dlError} onDismiss={clearDl} />}
          {success && <StatusAlert type="success" message={success} onDismiss={clearDl} />}
        </div>
      )}
    </div>
  )
}
