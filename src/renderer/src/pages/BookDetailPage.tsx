import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  IconArrowLeft,
  IconDownload,
  IconExternalLink,
  IconRefresh,
} from '@tabler/icons-react'
import { useBookStore } from '../stores/bookStore'
import { useDownloadStore } from '../stores/downloadStore'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'
import BookCover from '../components/BookCover'
import { toast } from '../stores/toastStore'
import { api } from '../api/client'
import { getUserFeedback } from '../utils/userFeedback'

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
  const warnedEmptyBooks = useRef(new Set<string>())

  useEffect(() => {
    fetchBook(id ?? '')
    return () => clear()
  }, [clear, fetchBook, id])

  useEffect(() => {
    if (!book || Object.keys(book.volumes).length > 0) return
    if (warnedEmptyBooks.current.has(book.book_id)) return
    warnedEmptyBooks.current.add(book.book_id)
    toast.warning({
      title: '暂无可下载分卷',
      message: '该作品暂未提供可下载的分卷，你可以重新加载或返回检索。',
      action: { label: '返回检索', href: '#/search' },
    })
  }, [book])

  const handleDownload = (type: DownloadTab) => {
    if (!book) {
      toast.warning({
        title: '作品信息尚未准备好',
        message: '请等待作品信息加载完成后再下载。',
      })
      return
    }
    if (type === 'pictures') {
      downloadImages(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'])
    } else {
      downloadEpub(book.book_id, book.basic_info['标题'] ?? '', book.basic_info['cover'])
    }
    navigate('/download')
  }

  const handleMultiDownload = (type: DownloadTab, volumes: string[]) => {
    if (!book) {
      toast.warning({
        title: '作品信息尚未准备好',
        message: '请等待作品信息加载完成后再下载。',
      })
      return
    }
    if (volumes.length === 0) {
      toast.warning({ title: '尚未选择分卷', message: '请至少选择一个要下载的分卷。' })
      return
    }
    volumes.forEach((volumeName) => {
      const cover = book.basic_info['cover']
      if (type === 'pictures') {
        downloadImages(book.book_id, book.basic_info['标题'] ?? '', cover, volumeName)
      } else {
        downloadEpub(book.book_id, book.basic_info['标题'] ?? '', cover, volumeName)
      }
    })
    navigate('/download')
  }

  const handleOpenSource = async (): Promise<void> => {
    if (!book) return
    const sourceUrl = `https://www.wenku8.net/book/${encodeURIComponent(book.book_id)}.htm`
    try {
      await api.openExternal(sourceUrl)
    } catch (error) {
      toast.error(getUserFeedback(error, 'open-external'))
    }
  }

  return (
    <div className="max-w-4xl pb-8">
      <button
        onClick={() => navigate(-1)}
        className="motion-pressable mb-4 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[13px] text-apple-accent hover:bg-apple-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
      >
        <IconArrowLeft aria-hidden="true" size={16} stroke={1.8} />
        返回
      </button>

      {loading && <LoadingSpinner text="正在查询中..." />}
      {error && (
        <div className="mb-4">
          <StatusAlert type="error" message={error} announce={false} />
          <div className="flex gap-2">
            {/^\d{1,12}$/.test(id ?? '') && (
              <button
                type="button"
                className="motion-pressable inline-flex items-center gap-1.5 rounded-lg bg-apple-accent px-4 py-2 text-xs font-medium text-white"
                onClick={() => fetchBook(id ?? '', { revalidate: true })}
              >
                <IconRefresh aria-hidden="true" size={14} stroke={1.8} />
                重新加载
              </button>
            )}
            <button
              type="button"
              className="motion-pressable rounded-lg border border-apple-border-input px-4 py-2 text-xs font-medium text-apple-heading"
              onClick={() => navigate('/search')}
            >
              返回检索
            </button>
          </div>
        </div>
      )}

      {book && (
        <>
          {/* 信息区 */}
          <div className="flex items-start gap-6 mb-6">
            <BookCover
              src={book.basic_info['cover']}
              title={book.basic_info['标题'] ?? '作品'}
              className="w-[130px] h-[184px] rounded-[14px] shadow-md"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-bold text-apple-heading mb-1 tracking-tight">
                {book.basic_info['标题']}
              </h1>
              <p className="text-[12px] text-apple-secondary">
                {book.basic_info['作者']}
                {book.basic_info['出版社'] && ` · ${book.basic_info['出版社']}`}
                {book.basic_info['连载状态'] && ` · ${book.basic_info['连载状态']}`}
              </p>
              <a
                href={`https://www.wenku8.net/book/${encodeURIComponent(book.book_id)}.htm`}
                onClick={(event) => {
                  event.preventDefault()
                  void handleOpenSource()
                }}
                className="motion-pressable mt-4 inline-flex items-center gap-1.5 rounded-lg border border-apple-border-input bg-apple-card px-3 py-2 text-[13px] font-medium text-apple-accent hover:bg-apple-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
              >
                <IconExternalLink aria-hidden="true" size={16} stroke={1.8} />
                在原网站查看
              </a>
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
          <div className="overflow-hidden rounded-xl border border-apple-border-subtle bg-apple-card shadow-card">
            <div role="group" aria-label="下载方式" className="flex border-b border-apple-border-subtle">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={dlTab === t.key}
                  onClick={() => setDlTab(t.key)}
                  className={`flex-1 border-b-2 py-2.5 text-center text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25 ${
                    dlTab === t.key
                      ? 'border-apple-accent font-medium text-apple-accent'
                      : 'border-transparent text-apple-secondary hover:text-apple-heading'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {dlTab === 'full' && Object.keys(book.volumes).length > 0 && (
                <div className="text-center">
                  <p className="text-[13px] text-apple-secondary mb-4">合并全部卷为一个 EPUB 文件，包含封面与目录</p>
                  <button
                    className="motion-pressable inline-flex items-center gap-1.5 rounded-[24px] bg-apple-accent px-6 py-2.5 text-[13px]
                               font-medium text-white hover:opacity-90 disabled:opacity-40"
                    onClick={() => handleDownload('full')}
                  >
                    <IconDownload aria-hidden="true" size={16} stroke={1.8} />
                    下载整本 EPUB
                  </button>
                </div>
              )}

              {Object.keys(book.volumes).length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                  <p>该作品暂未提供可下载的分卷，请稍后再试。</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      type="button"
                      className="motion-pressable inline-flex items-center gap-1.5 rounded-lg bg-apple-accent px-4 py-2 text-xs font-medium text-white"
                      onClick={() => void fetchBook(id ?? '', { revalidate: true })}
                    >
                      <IconRefresh aria-hidden="true" size={14} stroke={1.8} />
                      重新加载
                    </button>
                    <button
                      type="button"
                      className="motion-pressable rounded-lg border border-amber-300 px-4 py-2 text-xs font-medium text-amber-800"
                      onClick={() => navigate('/search')}
                    >
                      返回检索
                    </button>
                  </div>
                </div>
              )}

              {dlTab === 'divided' && Object.keys(book.volumes).length > 0 && (
                <MultiVolumeSelector
                  volumes={book.volumes}
                  onDownload={(vols) => handleMultiDownload('divided', vols)}
                />
              )}

              {dlTab === 'pictures' && Object.keys(book.volumes).length > 0 && (
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

function MultiVolumeSelector({ volumes, onDownload }: {
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

  const allSelected = volumeKeys.length > 0 && selected.size === volumeKeys.length
  const count = selected.size

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-apple-heading">选择卷</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-apple-secondary">已选 {count}/{volumeKeys.length}</span>
          <button
            type="button"
            onClick={allSelected ? deselectAll : selectAll}
            className="motion-pressable rounded-[14px] border border-apple-border-input px-3 py-1
                       text-[11px] text-apple-accent hover:bg-apple-accent/5"
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
              className="h-4 w-4 accent-apple-accent"
            />
            <span className="text-[13px] text-apple-heading">{v}</span>
          </label>
        ))}
      </div>

      <div className="text-center">
        <button
          type="button"
          disabled={count === 0}
          className="motion-pressable inline-flex items-center gap-1.5 rounded-[24px] bg-apple-accent px-6 py-2.5 text-[13px]
                     font-medium text-white hover:opacity-90 disabled:opacity-40"
          onClick={() => {
            if (count > 0) onDownload([...selected])
          }}
        >
          <IconDownload aria-hidden="true" size={16} stroke={1.8} />
          {count === 0 ? '请选择要下载的卷' : `下载选中的 ${count} 卷`}
        </button>
      </div>
    </div>
  )
}
