import { useEffect, useState, type ReactNode } from 'react'
import {
  IconDownload,
  IconFolderOpen,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import type { TitleFormat } from '../../../shared/config-types'
import {
  ACTIVE_DOWNLOAD_STATUSES,
  RETRYABLE_DOWNLOAD_STATUSES,
  type DownloadFolder,
  type DownloadTask,
} from '../../../shared/ipc-types'
import { formatBookTitle } from '../../../shared/title-format'
import { useDownloadStore } from '../stores/downloadStore'
import { useConfigStore } from '../stores/configStore'
import { formatTimeAgo } from '../utils/format'
import { api } from '../api/client'
import { toast } from '../stores/toastStore'
import { getUserFeedback } from '../utils/userFeedback'
import BookCover from '../components/BookCover'
import LoadingSpinner from '../components/LoadingSpinner'

const COMPLETED_PAGE_SIZE = 100
const CLEAR_COMPLETED_CONFIRMATION = '确定要清空全部已完成的下载记录吗？此操作无法撤销'
const CLEAR_HISTORY_CONFIRMATION = '确定要清空全部已结束的下载记录吗？此操作无法撤销'

function DownloadHistoryHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="mb-2 text-2xl font-bold text-apple-heading">下载历史</h1>
        <div className="h-1 w-11 rounded-full bg-apple-accent" />
      </div>
      {actions}
    </header>
  )
}

export default function DownloadHistoryPage() {
  const {
    tasks,
    initialized,
    loading,
    error,
    removeTask,
    clearCompleted,
    clearHistory,
    retryTask,
    cancelTask,
  } = useDownloadStore()
  const {
    snapshot: configSnapshot,
    loadState: configLoadState,
    fetchConfig,
  } = useConfigStore()
  const [visibleCompletedCount, setVisibleCompletedCount] = useState(COMPLETED_PAGE_SIZE)
  const [clearingScope, setClearingScope] = useState<'completed' | 'terminal' | null>(null)

  useEffect(() => {
    if (configSnapshot || configLoadState !== 'idle') return
    void fetchConfig()
  }, [configLoadState, configSnapshot, fetchConfig])

  const titleFormat = configSnapshot?.download.fullTitle ?? 'FULL'

  const handleOpenFolder = async (subdir: DownloadFolder) => {
    try {
      await api.openFolder(subdir)
    } catch (error) {
      toast.error(getUserFeedback(error, 'open-folder'))
    }
  }

  const activeTasks = tasks.filter((task) => ACTIVE_DOWNLOAD_STATUSES.includes(task.status))
  const retryable = tasks.filter((task) => RETRYABLE_DOWNLOAD_STATUSES.includes(task.status))
  const completed = tasks.filter((t) => t.status === 'completed')
  const visibleCompleted = completed.slice(0, visibleCompletedCount)

  const handleClearCompleted = async () => {
    if (clearingScope || !window.confirm(CLEAR_COMPLETED_CONFIRMATION)) return
    setClearingScope('completed')
    try {
      await clearCompleted()
      setVisibleCompletedCount(COMPLETED_PAGE_SIZE)
    } finally {
      setClearingScope(null)
    }
  }

  const handleClearHistory = async () => {
    if (clearingScope || !window.confirm(CLEAR_HISTORY_CONFIRMATION)) return
    setClearingScope('terminal')
    try {
      await clearHistory()
      setVisibleCompletedCount(COMPLETED_PAGE_SIZE)
    } finally {
      setClearingScope(null)
    }
  }

  if (loading === true || initialized === false) {
    return (
      <div>
        <DownloadHistoryHeader />
        <LoadingSpinner text="正在同步下载记录…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <DownloadHistoryHeader />
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center" role="alert">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div>
        <DownloadHistoryHeader />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            <IconDownload aria-hidden="true" size={22} stroke={1.7} />
          </div>
          <h2 className="text-sm font-semibold text-apple-heading">暂无下载记录</h2>
          <p className="mt-1 text-sm text-apple-secondary">找到作品后，可选择整本、分卷或插图下载</p>
          <a
            href="#/search"
            className="motion-pressable mt-4 rounded-lg bg-apple-accent-light px-4 py-2 text-sm font-medium text-apple-accent hover:bg-apple-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
          >
            前往找书
          </a>
        </div>
      </div>
    )
  }

  return (
    <div>
      <DownloadHistoryHeader actions={(
        <div className="flex flex-wrap justify-end gap-2">
          {completed.length > 0 && (
            <button
              onClick={handleClearCompleted}
              disabled={clearingScope !== null}
              className="motion-pressable inline-flex items-center gap-1.5 rounded-lg border border-apple-border-subtle bg-apple-card
                         px-4 py-2 text-xs text-apple-secondary hover:text-apple-heading disabled:cursor-not-allowed disabled:opacity-60"
            >
              <IconTrash aria-hidden="true" size={14} stroke={1.8} />
              {clearingScope === 'completed' ? '正在清空…' : '清空已完成'}
            </button>
          )}
          {(completed.length > 0 || retryable.length > 0) && (
            <button
              onClick={handleClearHistory}
              disabled={clearingScope !== null}
              className="motion-pressable inline-flex items-center gap-1.5 rounded-lg border border-apple-border-subtle bg-apple-card
                         px-4 py-2 text-xs text-red-600 hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <IconTrash aria-hidden="true" size={14} stroke={1.8} />
              {clearingScope === 'terminal' ? '正在清空…' : '清空全部历史'}
            </button>
          )}
        </div>
      )} />

      {/* 进行中 */}
      {activeTasks.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-apple-accent inline-block" />
            <span className="text-apple-accent">进行中</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {activeTasks.length} 项
            </span>
          </h2>
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className="bg-apple-card rounded-xl border border-apple-accent/20 p-4 mb-2"
            >
              <div className="flex items-center gap-3">
                {task.cover && (
                  <BookCover
                    src={task.cover}
                    title={formatBookTitle(task.title, titleFormat)}
                    className="w-10 h-14 rounded-md"
                    decorative
                    showFailureText={false}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[14px] font-semibold text-apple-heading" title={formatBookTitle(task.title, titleFormat)}>
                    {formatBookTitle(task.title, titleFormat)}
                  </div>
                  <div className="text-[12px] text-apple-secondary">
                    {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
                    {task.volume && ` · ${task.volume}`}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-apple-bg rounded-full overflow-hidden">
                      <div
                        className="download-progress h-full origin-left rounded-full bg-apple-accent"
                        style={{ transform: `scaleX(${task.progress / 100})` }}
                      />
                    </div>
                    <span className="text-[11px] text-apple-secondary font-medium tabular-nums">
                      {task.progress}%
                    </span>
                  </div>
                  {task.phase && (
                    <div className="text-[11px] text-apple-secondary mt-1">
                      {task.phase}
                    </div>
                  )}
                </div>
                <button
                  disabled={task.status === 'cancelling'}
                  onClick={() => cancelTask(task.id)}
                  aria-label={task.status === 'cancelling'
                    ? undefined
                    : `取消 ${formatBookTitle(task.title, titleFormat)} 下载`}
                  className="motion-pressable flex-shrink-0 rounded-[14px] bg-apple-bg px-4 py-1.5
                             inline-flex items-center gap-1 text-xs font-medium text-apple-secondary hover:text-apple-heading
                             disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-apple-secondary"
                >
                  {task.status !== 'cancelling' && <IconX aria-hidden="true" size={13} stroke={1.8} />}
                  {task.status === 'cancelling' ? '正在取消…' : '取消'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 可重试 */}
      {retryable.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span className="text-amber-600">需要处理</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {retryable.length} 项
            </span>
          </h2>
          {retryable.map((task) => (
            <RetryableTaskItem
              key={task.id}
              task={task}
              titleFormat={titleFormat}
              onRetry={retryTask}
              onRemove={removeTask}
            />
          ))}
        </section>
      )}

      {/* 已完成 */}
      {completed.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-green-600">已完成</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {completed.length} 项
            </span>
          </h2>
          <div className="bg-apple-card rounded-xl border border-apple-border-subtle divide-y divide-apple-border-subtle">
            {visibleCompleted.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                {task.cover && (
                  <BookCover
                    src={task.cover}
                    title={formatBookTitle(task.title, titleFormat)}
                    className="w-9 h-12 rounded-md"
                    decorative
                    showFailureText={false}
                    loading="lazy"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[13px] font-medium text-apple-heading" title={formatBookTitle(task.title, titleFormat)}>
                    {formatBookTitle(task.title, titleFormat)}
                  </div>
                  <div className="text-xs text-apple-secondary">
                    {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
                    {task.volume && ` · ${task.volume}`}
                    {' · '}
                    {formatTimeAgo(task.createdAt)}
                  </div>
                  {task.warning && (
                    <p className="mt-1 text-[11px] leading-4 text-amber-600">
                      {getUserFeedback(task.warning, 'download-warning').message}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void handleOpenFolder(task.type === 'images' ? 'pics' : 'novels')}
                  aria-label={`打开 ${formatBookTitle(task.title, titleFormat)} 所在文件夹`}
                  className="motion-pressable flex h-8 w-8 items-center justify-center rounded-lg text-apple-tertiary hover:bg-apple-accent-light hover:text-apple-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
                  title="打开所在文件夹"
                >
                  <IconFolderOpen aria-hidden="true" size={17} stroke={1.8} />
                </button>
                <button
                  onClick={() => removeTask(task.id)}
                  aria-label={`删除 ${formatBookTitle(task.title, titleFormat)} 的下载记录`}
                  className="motion-pressable flex h-8 w-8 items-center justify-center rounded-lg text-apple-tertiary hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                  title="删除记录"
                >
                  <IconTrash aria-hidden="true" size={16} stroke={1.8} />
                </button>
              </div>
            ))}
          </div>
          {visibleCompleted.length < completed.length && (
            <div className="mt-3 flex items-center justify-center gap-3">
              <span className="text-xs text-apple-tertiary">
                已显示 {visibleCompleted.length}/{completed.length} 项
              </span>
              <button
                type="button"
                className="motion-pressable rounded-lg border border-apple-border-subtle bg-apple-card px-4 py-2 text-xs font-medium text-apple-accent hover:bg-apple-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
                onClick={() => setVisibleCompletedCount((count) => count + COMPLETED_PAGE_SIZE)}
              >
                加载更多
              </button>
            </div>
          )}
        </section>
      )}

    </div>
  )
}

function RetryableTaskItem({
  task, titleFormat, onRetry, onRemove,
}: {
  task: DownloadTask
  titleFormat: TitleFormat
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  const displayTitle = formatBookTitle(task.title, titleFormat)
  const statusLabel = task.status === 'failed'
    ? '下载失败'
    : task.status === 'cancelled'
      ? '已取消'
      : '已中断'
  const errorMessage = task.status === 'failed'
    ? getUserFeedback(task.error, 'download').message
    : task.status === 'cancelled'
      ? '任务已取消，可以重新加入下载队列。'
      : '应用退出前任务未完成，可以重新加入下载队列。'

  return (
    <div className="bg-apple-card rounded-xl border border-red-200 mb-2 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
        {task.cover && (
          <BookCover
            src={task.cover}
            title={displayTitle}
            className="w-10 h-14 rounded-md"
            decorative
            showFailureText={false}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-apple-heading">{displayTitle}</div>
          <div className="text-xs text-red-600">
            {statusLabel} · {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
            {task.volume && ` · ${task.volume}`}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-apple-secondary">
            {errorMessage}
          </p>
          {task.warning && (
            <p className="mt-1 text-[11px] leading-4 text-amber-600">
              {getUserFeedback(task.warning, 'download-warning').message}
            </p>
          )}
        </div>
        <button
          onClick={() => { onRetry(task.id) }}
          className="motion-pressable inline-flex items-center gap-1 rounded-[14px] bg-apple-accent-light px-4 py-1.5
                     text-xs font-medium text-apple-accent hover:bg-apple-accent/15"
        >
          <IconRefresh aria-hidden="true" size={13} stroke={1.8} />
          重试
        </button>
        <button
          onClick={() => onRemove(task.id)}
          aria-label={`删除 ${displayTitle} 的下载记录`}
          className="motion-pressable flex h-8 w-8 items-center justify-center rounded-lg text-apple-tertiary hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          title="删除记录"
        >
          <IconTrash aria-hidden="true" size={16} stroke={1.8} />
        </button>
      </div>
    </div>
  )
}
