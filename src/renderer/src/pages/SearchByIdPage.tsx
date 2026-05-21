import { useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useBookStore } from '../stores/bookStore'
import BookQueryInput from '../components/BookQueryInput'
import BookInfoCard from '../components/BookInfoCard'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

export default function SearchByIdPage() {
  const { book, loading, error, fetchBook, clear } = useBookStore()
  const [searchParams, setSearchParams] = useSearchParams()

  // 支持从其他页面通过 URL 参数跳转
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      fetchBook(id)
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">编号检索</h2>
      <BookQueryInput
        label="请输入轻小说文库的作品编号或链接"
        help="例如：3057 或 https://www.wenku8.net/book/3057.htm"
        onQuery={fetchBook}
        loading={loading}
      />
      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={clear} />}
      {book && (
        <div className="space-y-4">
          <BookInfoCard
            book={book}
            actions={
              <div className="flex gap-3">
                <Link
                  to={`/download/full?id=${book.book_id}`}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  整本下载
                </Link>
                <Link
                  to={`/download/divided?id=${book.book_id}`}
                  className="px-3 py-1.5 text-xs bg-blue-600/50 hover:bg-blue-600 rounded transition-colors"
                >
                  分卷下载
                </Link>
                <Link
                  to={`/download/pictures?id=${book.book_id}`}
                  className="px-3 py-1.5 text-xs bg-blue-600/50 hover:bg-blue-600 rounded transition-colors"
                >
                  图片下载
                </Link>
              </div>
            }
          />
          {book.basic_info['简介'] && (
            <div className="p-4 rounded-lg border border-gray-800">
              <h4 className="text-sm font-semibold mb-2 text-gray-400">简介</h4>
              {book.basic_info['简介'].split('\n').map((line, i) => (
                <p key={i} className="text-sm text-gray-300 leading-relaxed">{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
