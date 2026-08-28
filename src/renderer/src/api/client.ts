import type {
  DownloadConfig,
  LogConfig,
  UpdateCredentialsInput,
} from '../../../shared/config-types'
import type {
  CookieProgress,
  DownloadHistoryScope,
  DownloadStateEvent,
  EnqueueDownloadInput,
  OpenFolderTarget,
} from '../../../shared/ipc-types'
import {
  toUserFacingError,
  type FeedbackContext,
} from '../utils/userFeedback'

async function invoke<T>(
  context: FeedbackContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toUserFacingError(error, context)
  }
}

export const api = {
  // 配置
  getConfig: (context: FeedbackContext = 'config-load') =>
    invoke(context, () => window.electronAPI.getConfig()),
  updateDownloadConfig: (input: DownloadConfig) =>
    invoke('config-save', () => window.electronAPI.updateDownloadConfig(input)),
  updateLogConfig: (input: LogConfig) =>
    invoke('log-save', () => window.electronAPI.updateLogConfig(input)),
  updateCredentials: (input: UpdateCredentialsInput) =>
    invoke('account-save', () => window.electronAPI.updateCredentials(input)),
  resetCorruptConfig: () =>
    invoke('config-reset', () => window.electronAPI.resetCorruptConfig()),

  // 登录状态
  autoGetCookie: (operationId: string) =>
    invoke('login', () => window.electronAPI.autoGetCookie(operationId)),
  getCookieProgress: (callback: (data: CookieProgress) => void) => {
    return window.electronAPI.onCookieProgress(callback)
  },

  // 搜索
  searchAuthor: (q: string) => invoke('search', () => window.electronAPI.searchAuthor(q)),
  searchTitle: (q: string) => invoke('search', () => window.electronAPI.searchTitle(q)),

  // 书籍
  getBook: (id: string) => invoke('book', () => window.electronAPI.getBook(id)),
  getBookImages: (id: string) => invoke('book', () => window.electronAPI.getBookImages(id)),

  // 下载
  getDownloadSnapshot: () =>
    invoke('download', () => window.electronAPI.getDownloadSnapshot()),
  enqueueDownload: (input: EnqueueDownloadInput) =>
    invoke('download', () => window.electronAPI.enqueueDownload(input)),
  cancelDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.cancelDownload(taskId)),
  retryDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.retryDownload(taskId)),
  removeDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.removeDownload(taskId)),
  clearDownloadHistory: (scope: DownloadHistoryScope) =>
    invoke('download', () => window.electronAPI.clearDownloadHistory(scope)),
  importLegacyDownloadHistory: (tasks: unknown[]) =>
    invoke('download', () => window.electronAPI.importLegacyDownloadHistory(tasks)),
  onDownloadStateChanged: (callback: (event: DownloadStateEvent) => void) =>
    window.electronAPI.onDownloadStateChanged(callback),

  // 文件
  openFolder: (target: OpenFolderTarget) =>
    invoke('open-folder', () => window.electronAPI.openFolder(target)),
  openLogFolder: () =>
    invoke('open-log-folder', () => window.electronAPI.openLogFolder()),
  selectFolder: () =>
    invoke('select-folder', () => window.electronAPI.selectFolder()),
  openExternal: (url: string) =>
    invoke('open-external', () => window.electronAPI.openExternal(url)),
}

export type SearchResult = {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  updateTime?: string
  wordCount?: string
  isAnimated?: boolean
  tags?: string
  desc?: string
}

export type BookInfo = {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}

export default api
