import { dialog, type BrowserWindow } from 'electron'
import type { DownloadManager } from './download-manager'
import { logger } from './logging/logger'

export function registerDownloadCloseGuard(
  window: BrowserWindow,
  downloads: Pick<DownloadManager, 'hasActiveTasks' | 'shutdown'>,
): void {
  let prompting = false
  let confirmed = false

  window.on('close', (event) => {
    if (confirmed) return
    event.preventDefault()
    if (prompting) return
    prompting = true
    const hasActiveTasks = downloads.hasActiveTasks()

    void (async () => {
      try {
        if (hasActiveTasks) {
          const result = await dialog.showMessageBox(window, {
            type: 'warning',
            title: '下载任务仍在进行',
            message: '退出后，未完成的下载任务将标记为已中断。',
            detail: '已下载的缓存会保留，稍后可以在下载记录中重试。',
            buttons: ['继续下载', '退出并中断任务'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          })
          if (result.response !== 1) return
        }
        await downloads.shutdown()
        confirmed = true
        if (!window.isDestroyed()) window.destroy()
      } catch (error) {
        logger.error(
          'download.shutdown.failed',
          '关闭应用前无法安全保存下载状态',
          error,
        )
        dialog.showErrorBox(
          '无法退出',
          '下载状态未能安全保存，请检查磁盘或数据目录权限后重试。',
        )
      } finally {
        prompting = false
      }
    })()
  })
}
