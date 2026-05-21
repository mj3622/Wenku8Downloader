import { useState } from 'react'
import { useDownloadStore, type DownloadTask } from '../stores/downloadStore'

export default function DownloadHistoryPage() {
  const { tasks, removeTask, clearCompleted, clearHistory, retryTask } = useDownloadStore()

  const downloading = tasks.filter((t) => t.status === 'downloading')
  const failed = tasks.filter((t) => t.status === 'failed')
  const completed = tasks.filter((t) => t.status === 'completed')

  if (tasks.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-apple-heading mb-4">下载历史</h2>
        <div className="text-center py-16">
          <p className="text-apple-tertiary text-[14px]">暂无下载记录</p>
          <p className="text-apple-tertiary text-[12px] mt-1">前往检索页面搜索书籍并下载</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-apple-heading mb-4">下载历史</h2>

      {/* 进行中 */}
      {downloading.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[11px] font-semibold text-apple-secondary mb-2">
            进行中 · {downloading.length} 项
          </h3>
          {downloading.map((task) => (
            <div
              key={task.id}
              className="bg-apple-card rounded-xl border border-apple-accent/20 p-4 mb-2"
            >
              <div className="flex items-center gap-3">
                {task.cover && (
                  <img src={task.cover} alt="" className="w-10 h-14 object-cover rounded-md flex-shrink-0 bg-apple-bg" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-apple-heading">{task.title}</div>
                  <div className="text-[12px] text-apple-secondary">
                    {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
                    {task.volume && ` · ${task.volume}`}
                  </div>
                  <div className="mt-2 h-1.5 bg-apple-bg rounded-full overflow-hidden">
                    <div className="h-full bg-apple-accent rounded-full animate-pulse" style={{ width: '100%' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 失败 */}
      {failed.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[11px] font-semibold text-red-500 mb-2">
            失败 · {failed.length} 项
          </h3>
          {failed.map((task) => (
            <FailedTaskItem key={task.id} task={task} onRetry={retryTask} onRemove={removeTask} />
          ))}
        </section>
      )}

      {/* 已完成 */}
      {completed.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[11px] font-semibold text-green-500 mb-2">
            已完成 · {completed.length} 项
          </h3>
          <div className="bg-apple-card rounded-xl border border-apple-border-subtle divide-y divide-apple-border-subtle">
            {completed.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                {task.cover && (
                  <img src={task.cover} alt="" className="w-9 h-12 object-cover rounded-md flex-shrink-0 bg-apple-bg" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-apple-heading">{task.title}</div>
                  <div className="text-[11px] text-apple-secondary">
                    {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
                    {task.volume && ` · ${task.volume}`}
                    {' · '}
                    {formatTime(task.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => removeTask(task.id)}
                  className="text-apple-tertiary hover:text-red-400 transition-colors text-[16px] leading-none px-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 清空操作 */}
      {(completed.length > 0 || failed.length > 0) && (
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

function FailedTaskItem({
  task, onRetry, onRemove,
}: {
  task: DownloadTask
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-apple-card rounded-xl border border-red-200 mb-2 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
        {task.cover && (
          <img src={task.cover} alt="" className="w-10 h-14 object-cover rounded-md flex-shrink-0 bg-apple-bg" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-apple-heading">{task.title}</div>
          <div className="text-[12px] text-red-400">
            {task.type === 'images' ? '插图下载' : 'EPUB 下载'}
            {task.volume && ` · ${task.volume}`}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-apple-tertiary mt-0.5 hover:text-apple-secondary transition-colors"
          >
            {expanded ? '收起详情' : '查看错误详情'}
          </button>
        </div>
        <button
          onClick={() => onRetry(task.id)}
          className="px-4 py-1.5 text-[11px] font-medium bg-apple-accent-light text-apple-accent
                     rounded-[14px] hover:bg-apple-accent/15 transition-colors"
        >
          重试
        </button>
        <button
          onClick={() => onRemove(task.id)}
          className="text-apple-tertiary hover:text-red-400 transition-colors text-[16px] leading-none px-1"
        >
          ×
        </button>
      </div>
      {expanded && task.error && (
        <div className="px-4 pb-4">
          <pre className="text-[11px] text-apple-secondary bg-apple-bg rounded-lg p-3 font-mono leading-relaxed whitespace-pre-wrap break-all">
            {task.error}
          </pre>
        </div>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
