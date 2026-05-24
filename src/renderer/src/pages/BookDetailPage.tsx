import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

type DownloadTab = 'full' | 'divided' | 'pictures'

const tabs: { key: DownloadTab; label: string }[] = [
  { key: 'full', label: '整本下载' },
  { key: 'divided', label: '分卷下载' },
  { key: 'pictures', label: '插图下载' },
]

export default function BookDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { book, loading, error, fetchBook, clear } = useBookStore()
  const { downloadEpub, downloadImages } = useDownloadStore()
  const [dlTab, setDlTab] = useState<DownloadTab>('full')

  useEffect(() => {
    if (id) fetchBook(id)
    return () => clear()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = (type: DownloadTab) => {
    if (!book) return
    if (type === 'pictures') {
      downloadImages(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'])
    } else {
      downloadEpub(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'])
    }
    navigate('/download')
  }

  const handleMultiDownload = (type: DownloadTab, volumes: string[]) => {
    if (!book) return
    volumes.forEach(v =>
      type === 'pictures'
        ? downloadImages(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'], v)
        : downloadEpub(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'], v)
    )
    navigate('/download')
  }

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="text-[13px] text-apple-accent hover:opacity-70 transition-opacity mb-4"
      >
        ← 返回
      </button>

      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && <StatusAlert type="error" message={error} onDismiss={clear} />}

      {book && (
        <>
          {/* 信息区 */}
          <div className="flex items-start gap-6 mb-6">
            {book.basic_info['cover'] && (
              <img
                src={book.basic_info['cover']}
                alt={book.basic_info['标题']}
                className="w-[130px] h-[184px] object-cover rounded-[14px] bg-apple-bg shadow-md flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold text-apple-heading mb-1 tracking-tight">
                {book.basic_info['标题']}
              </h2>
              <p className="text-[12px] text-apple-secondary">
                {book.basic_info['作者']}
                {book.basic_info['出版社'] && ` · ${book.basic_info['出版社']}`}
                {book.basic_info['连载状态'] && ` · ${book.basic_info['连载状态']}`}
              </p>
            </div>
          </div>

          {/* 统计区 */}
          <div className="p-4 rounded-xl border border-apple-border-subtle bg-apple-card mb-6">
            <div className="grid grid-cols-3 gap-4">
              {book.basic_info['最新章节'] && (
                <div>
                  <h4 className="text-[12px] font-semibold text-apple-heading mb-1">最新</h4>
                  <p className="text-[13px] text-apple-body truncate">{book.basic_info['最新章节']}</p>
                </div>
              )}
              {book.basic_info['更新时间'] && (
                <div>
                  <h4 className="text-[12px] font-semibold text-apple-heading mb-1">更新</h4>
                  <p className="text-[13px] text-apple-body">{book.basic_info['更新时间']}</p>
                </div>
              )}
              {book.basic_info['全文长度'] && (
                <div>
                  <h4 className="text-[12px] font-semibold text-apple-heading mb-1">字数</h4>
                  <p className="text-[13px] text-apple-body">{book.basic_info['全文长度']}</p>
                </div>
              )}
            </div>
          </div>

          {/* 简介 */}
          {book.basic_info['简介'] && (
            <div className="p-4 rounded-xl border border-apple-border-subtle bg-apple-card mb-6">
              <h4 className="text-[12px] font-semibold text-apple-heading mb-2">简介</h4>
              {book.basic_info['简介'].split('\n').map((line, i) => (
                <p key={i} className="text-[13px] text-apple-body leading-relaxed">{line}</p>
              ))}
            </div>
          )}

          {/* 下载区 — 方案 B Tab 切换 */}
          <div className="bg-apple-card rounded-2xl border border-apple-border-subtle shadow-card overflow-hidden">
            <div className="flex border-b border-apple-border-subtle">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDlTab(t.key)}
                  className={`flex-1 text-center py-2.5 text-[13px] transition-colors ${
                    dlTab === t.key
                      ? 'border-b-2 border-apple-accent text-apple-accent font-medium'
                      : 'text-apple-secondary hover:text-apple-heading'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {dlTab === 'full' && (
                <div className="text-center">
                  <p className="text-[13px] text-apple-secondary mb-4">合并全部卷为一个 EPUB 文件，包含封面与目录</p>
                  <button
                    className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                               rounded-[24px] text-[13px] font-medium text-white transition-opacity"
                    onClick={() => handleDownload('full')}
                  >
                    下载整本 EPUB
                  </button>
                </div>
              )}

              {dlTab === 'divided' && (
                <MultiVolumeSelector
                  volumes={book.volumes}
                  onDownload={(vols) => handleMultiDownload('divided', vols)}
                />
              )}

              {dlTab === 'pictures' && (
                <MultiVolumeSelector
                  volumes={book.volumes}
                  onDownload={(vols) => handleMultiDownload('pictures', vols)}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MultiVolumeSelector({
  volumes, onDownload,
}: {
  volumes: Record<string, unknown>
  onDownload: (volumes: string[]) => void
}) {
  const volumeKeys = Object.keys(volumes)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (v: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(volumeKeys))
  const deselectAll = () => setSelected(new Set())

  const allSelected = selected.size === volumeKeys.length
  const count = selected.size

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-apple-heading">选择卷</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-apple-secondary">已选 {count}/{volumeKeys.length}</span>
          <button
            onClick={allSelected ? deselectAll : selectAll}
            className="px-3 py-1 text-[11px] border border-apple-border-input rounded-[14px] text-apple-accent
                       hover:bg-apple-accent/5 transition-colors"
          >
            {allSelected ? '取消' : '全选'}
          </button>
        </div>
      </div>

      <div className="border border-apple-border-subtle rounded-xl overflow-hidden max-h-[280px] overflow-y-auto mb-4">
        {volumeKeys.map((v) => (
          <label
            key={v}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors
                       border-b border-apple-border-subtle last:border-b-0 hover:bg-apple-bg
                       ${selected.has(v) ? 'bg-blue-50' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(v)}
              onChange={() => toggle(v)}
              className="w-4 h-4 accent-[#0071e3]"
            />
            <span className="text-[13px] text-apple-heading">{v}</span>
          </label>
        ))}
      </div>

      <div className="text-center">
        <button
          disabled={count === 0}
          className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                     rounded-[24px] text-[13px] font-medium text-white transition-opacity"
          onClick={() => count > 0 && onDownload([...selected])}
        >
          {count === 0 ? '请选择要下载的卷' : `下载选中的 ${count} 卷`}
        </button>
      </div>
    </div>
  )
}
