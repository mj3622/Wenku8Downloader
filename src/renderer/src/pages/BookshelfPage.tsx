import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconBooks,
  IconChevronRight,
  IconRefresh,
} from '@tabler/icons-react'
import type { BookshelfEntry, BookshelfLocalState } from '../../../shared/ipc-types'
import LoadingSpinner from '../components/LoadingSpinner'
import StatusAlert from '../components/StatusAlert'
import { useBookshelfStore } from '../stores/bookshelfStore'

const LOCAL_STATUS: Record<BookshelfLocalState, string> = {
  none: '未下载',
  partial: '已下载部分',
  current: '已是最新',
  update: '有更新',
  unknown: '尚未比较',
}

function localStatusClass(state: BookshelfLocalState): string {
  if (state === 'update') return 'text-amber-700'
  if (state === 'current') return 'text-emerald-700'
  return 'text-apple-secondary'
}

function BookshelfRow({ entry, onOpen }: {
  entry: BookshelfEntry
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="motion-pressable grid w-full grid-cols-[minmax(0,1fr)_minmax(150px,0.75fr)_104px] items-center gap-4 border-b border-apple-border-subtle px-4 py-3 text-left last:border-b-0 hover:bg-apple-bg focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25"
    >
      <span className="min-w-0">
        <span className="block break-words text-[13px] font-medium leading-5 text-apple-heading">
          {entry.title}
        </span>
        <span className="mt-0.5 block break-words text-[12px] leading-5 text-apple-secondary">
          {entry.author || '未标注作者'}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block break-words text-[12px] leading-5 text-apple-body">
          {entry.latestChapter || '暂无章节信息'}
        </span>
        <span className="mt-0.5 block break-words text-[11px] leading-5 text-apple-tertiary">
          {entry.bookmark ? `书签 ${entry.bookmark}` : '暂无书签'}
          {entry.updatedAt ? ` · ${entry.updatedAt}` : ''}
        </span>
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        <span className={`text-right text-[11px] font-medium ${localStatusClass(entry.localState)}`}>
          {LOCAL_STATUS[entry.localState]}
        </span>
        <IconChevronRight aria-hidden="true" className="flex-shrink-0 text-apple-tertiary" size={15} stroke={1.8} />
      </span>
    </button>
  )
}

export default function BookshelfPage() {
  const navigate = useNavigate()
  const { page, loading, error, load, clear } = useBookshelfStore()

  useEffect(() => {
    void load()
    return () => clear()
  }, [clear, load])

  const loginRequired = Boolean(error && /(?:登录|账号)/.test(error))

  return (
    <div className="mx-auto max-w-6xl pb-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-apple-heading">书架</h1>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(true)}
          className="motion-pressable inline-flex items-center gap-1.5 rounded-lg border border-apple-border-input bg-apple-card px-3 py-2 text-[12px] font-medium text-apple-accent hover:bg-apple-accent-light disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
        >
          <IconRefresh aria-hidden="true" className={loading ? 'animate-spin' : ''} size={15} stroke={1.8} />
          {loading ? '正在刷新' : '刷新书架'}
        </button>
      </div>
      <div className="mb-4 h-1 w-11 rounded-full bg-apple-accent" />

      {page?.stale && (
        <StatusAlert type="warning" message="网络更新失败，当前显示最近缓存的书架" />
      )}
      {error && (
        <div className="mb-4">
          <StatusAlert type="error" message={error} announce={false} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              className="motion-pressable inline-flex items-center gap-1.5 rounded-lg bg-apple-accent px-4 py-2 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
            >
              <IconRefresh aria-hidden="true" size={14} stroke={1.8} />
              重新加载
            </button>
            {loginRequired && (
              <button
                type="button"
                onClick={() => navigate('/config')}
                className="motion-pressable rounded-lg border border-apple-border-input bg-apple-card px-4 py-2 text-xs font-medium text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
              >
                前往配置
              </button>
            )}
          </div>
        </div>
      )}

      {loading && !page && !error && <LoadingSpinner text="正在读取原站书架..." />}

      {page && page.entries.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            <IconBooks aria-hidden="true" size={22} stroke={1.7} />
          </div>
          <p className="mb-1 text-sm font-medium text-apple-secondary">原站书架暂无收藏</p>
          <p className="text-xs text-apple-tertiary">收藏作品后可在这里查看更新</p>
        </div>
      )}

      {page && page.entries.length > 0 && (
        <section aria-label="原站书架" className="overflow-hidden rounded-xl border border-apple-border-subtle bg-apple-card">
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_minmax(150px,0.75fr)_104px] gap-4 border-b border-apple-border-subtle bg-apple-bg/70 px-4 py-2 text-[11px] font-medium text-apple-secondary">
            <span>作品与作者</span>
            <span>最新章节与书签</span>
            <span className="text-right">本地状态</span>
          </div>
          {page.entries.map(entry => (
            <BookshelfRow
              key={entry.bookId}
              entry={entry}
              onOpen={() => navigate(`/book/${entry.bookId}`)}
            />
          ))}
        </section>
      )}
    </div>
  )
}
