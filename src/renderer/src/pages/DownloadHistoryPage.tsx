import { useEffect } from 'react'
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

function DownloadHistoryHeader() {
  return (
    <>
      <h2 className="text-2xl font-bold text-apple-heading mb-2">下载历史</h2>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
    </>
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

  if (loading === true || initialized === false) {
    return (
      <div>
        <DownloadHistoryHeader />
        <div className="text-center py-16" role="status">
          <p className="text-apple-secondary text-[14px]">正在同步下载记录…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <DownloadHistoryHeader />
        <div className="text-center py-16" role="alert">
          <p className="text-red-400 text-[14px]">{error}</p>
        </div>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div>
        <DownloadHistoryHeader />
        <div className="text-center py-16">
          <p className="text-apple-tertiary text-[14px]">暂无下载记录</p>
          <p className="text-apple-tertiary text-[12px] mt-1">前往检索页面搜索书籍并下载</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <DownloadHistoryHeader />

      {/* 进行中 */}
      {activeTasks.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-apple-accent inline-block" />
            <span className="text-apple-accent">进行中</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {activeTasks.length} 项
            </span>
          </h3>
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
                  <div className="text-[14px] font-semibold text-apple-heading">
                    {formatBookTitle(task.title, titleFormat)}
                  </div>
                  <div className="text-[12px] text-apple-secondary">
                    {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
                    {task.volume && ` · ${task.volume}`}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-apple-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-apple-accent rounded-full ${task.status === 'downloading' ? 'animate-pulse' : ''}`}
                        style={{ width: `${task.progress}%` }}
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
                  className="px-4 py-1.5 text-[11px] font-medium text-apple-secondary bg-apple-bg
                             rounded-[14px] flex-shrink-0 transition-colors hover:text-apple-heading
                             disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-apple-secondary"
                >
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
          <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span className="text-amber-600">需要处理</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {retryable.length} 项
            </span>
          </h3>
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
          <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-green-500">已完成</span>
            <span className="text-apple-secondary text-[12px] font-normal">
              · {completed.length} 项
            </span>
          </h3>
          <div className="bg-apple-card rounded-xl border border-apple-border-subtle divide-y divide-apple-border-subtle">
            {completed.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                {task.cover && (
                  <BookCover
                    src={task.cover}
                    title={formatBookTitle(task.title, titleFormat)}
                    className="w-9 h-12 rounded-md"
                    decorative
                    showFailureText={false}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-apple-heading">
                    {formatBookTitle(task.title, titleFormat)}
                  </div>
                  <div className="text-[11px] text-apple-secondary">
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
                  className="text-apple-tertiary hover:text-apple-accent transition-colors px-1"
                  title="打开所在文件夹"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => removeTask(task.id)}
                  aria-label={`删除 ${formatBookTitle(task.title, titleFormat)} 的下载记录`}
                  className="text-apple-tertiary hover:text-red-400 transition-colors text-[16px] leading-none px-1"
                  title="删除记录"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 清空操作 */}
      {(completed.length > 0 || retryable.length > 0) && (
        <div className="flex gap-3 mt-6">
          {completed.length > 0 && (
            <button
              onClick={clearCompleted}
              className="px-4 py-2 text-[12px] text-apple-secondary hover:text-apple-heading
                         bg-apple-card border border-apple-border-subtle rounded-xl transition-colors"
            >
              清空已完成
            </button>
          )}
          <button
            onClick={clearHistory}
            className="px-4 py-2 text-[12px] text-red-400 hover:text-red-500
                       bg-apple-card border border-apple-border-subtle rounded-xl transition-colors"
          >
            清空全部历史
          </button>
        </div>
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
          <div className="text-[12px] text-red-400">
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
          className="px-4 py-1.5 text-[11px] font-medium bg-apple-accent-light text-apple-accent
                     rounded-[14px] hover:bg-apple-accent/15 transition-colors"
        >
          重试
        </button>
        <button
          onClick={() => onRemove(task.id)}
          aria-label={`删除 ${displayTitle} 的下载记录`}
          className="text-apple-tertiary hover:text-red-400 transition-colors text-[16px] leading-none px-1"
        >
          ×
        </button>
      </div>
    </div>
  )
}
