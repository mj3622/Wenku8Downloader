import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'

type DownloadTab = 'full' | 'divided' | 'pictures'

export default function BookDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { book, loading, error, fetchBook, clear } = useBookStore()
  const { downloadEpub, downloadImages } = useDownloadStore()
  const [dlTab, setDlTab] = useState<DownloadTab>('full')
  const [dlStatus, setDlStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [dlMessage, setDlMessage] = useState('')

  useEffect(() => {
    if (id) fetchBook(id)
    return () => clear()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async (type: DownloadTab, volume?: string) => {
    if (!book) return
    setDlStatus('loading')
    setDlMessage('')
    try {
      if (type === 'pictures') {
        await downloadImages(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'], volume)
      } else {
        await downloadEpub(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'], volume)
      }
      setDlStatus('success')
      setDlMessage('下载任务已添加，可在下载历史页面查看进度')
    } catch (e) {
      setDlStatus('error')
      setDlMessage(String(e))
    }
  }

  const tabs: { key: DownloadTab; label: string }[] = [
    { key: 'full', label: '整本下载' },
    { key: 'divided', label: '分卷下载' },
    { key: 'pictures', label: '插图下载' },
  ]

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
          {/* 信息区 — 方案 C */}
          <div className="flex gap-5 mb-6 items-start">
            {book.basic_info['cover'] && (
              <img
                src={book.basic_info['cover']}
                alt={book.basic_info['标题']}
                className="w-[120px] h-[170px] object-cover rounded-[14px] flex-shrink-0 bg-apple-bg shadow-sm"
              />
            )}
            <div className="flex-1 min-w-0 pt-1">
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

          {/* 统计条 */}
          <div className="flex gap-6 px-4 py-3 bg-apple-card rounded-xl border border-apple-border-subtle mb-4 text-[12px]">
            {book.basic_info['最新章节'] && (
              <div><span className="text-apple-tertiary">最新</span> <span className="text-apple-heading">{book.basic_info['最新章节']}</span></div>
            )}
            {book.basic_info['更新时间'] && (
              <div><span className="text-apple-tertiary">更新</span> <span className="text-apple-heading">{book.basic_info['更新时间']}</span></div>
            )}
            {book.basic_info['全文长度'] && (
              <div><span className="text-apple-tertiary">字数</span> <span className="text-apple-heading">{book.basic_info['全文长度']}</span></div>
            )}
          </div>

          {/* 简介 */}
          {book.basic_info['简介'] && (
            <div className="p-4 rounded-xl border border-apple-border-subtle bg-apple-card mb-6">
              <h4 className="text-[12px] font-semibold text-apple-secondary mb-2">简介</h4>
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
                    disabled={dlStatus === 'loading'}
                    className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                               rounded-[24px] text-[13px] font-medium text-white transition-opacity"
                    onClick={() => handleDownload('full')}
                  >
                    {dlStatus === 'loading' ? '添加中...' : '下载整本 EPUB'}
                  </button>
                </div>
              )}

              {dlTab === 'divided' && (
                <VolumeDownload
                  volumes={book.volumes}
                  loading={dlStatus === 'loading'}
                  onDownload={(v) => handleDownload('divided', v)}
                />
              )}

              {dlTab === 'pictures' && (
                <VolumeDownload
                  volumes={book.volumes}
                  loading={dlStatus === 'loading'}
                  onDownload={(v) => handleDownload('pictures', v)}
                />
              )}

              {dlStatus === 'success' && dlMessage && (
                <StatusAlert type="success" message={dlMessage} onDismiss={() => setDlStatus('idle')} />
              )}
              {dlStatus === 'error' && dlMessage && (
                <StatusAlert type="error" message={dlMessage} onDismiss={() => setDlStatus('idle')} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function VolumeDownload({
  volumes, loading, onDownload,
}: {
  volumes: Record<string, unknown>
  loading: boolean
  onDownload: (volume: string) => void
}) {
  const [selected, setSelected] = useState('')

  return (
    <div className="flex items-end gap-4 justify-center">
      <div>
        <label className="block text-sm text-apple-secondary mb-1">选择卷</label>
        <select
          className="px-3 py-2 bg-apple-bg border border-apple-border-input rounded-xl text-sm text-apple-heading min-w-[200px]
                     focus:outline-none focus:border-apple-accent/30"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">-- 请选择 --</option>
          {Object.keys(volumes).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <button
        disabled={loading || !selected}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={() => selected && onDownload(selected)}
      >
        {loading ? '添加中...' : '下载'}
      </button>
    </div>
  )
}
