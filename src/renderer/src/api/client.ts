import type {
  DownloadConfig,
  LogConfig,
  UpdateCredentialsInput,
} from '../../../shared/config-types'
import type {
  CookieProgress,
  BookLoadOptions,
  BookshelfPage,
  CacheClearResult,
  CatalogPage,
  CatalogQuery,
  DiscoveryHome,
  DownloadHistoryScope,
  DownloadStateEvent,
  EnqueueDownloadInput,
  LogStats,
  OpenFolderTarget,
  RankingPage,
  RankingType,
  VolumeCoverSnapshot,
} from '../../../shared/ipc-types'
export type { BookInfo } from '../../../shared/book-types'
export type { SearchResult } from '../../../shared/ipc-types'
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

  // 找书
  getCatalog: (query: CatalogQuery, refresh = false): Promise<CatalogPage> => (
    invoke('catalog', () => window.electronAPI.getCatalog(query, refresh))
  ),

  // 发现
  getDiscoveryHome: (refresh = false): Promise<DiscoveryHome> => (
    invoke('discovery', () => window.electronAPI.getDiscoveryHome(refresh))
  ),
  getRanking: (type: RankingType, page: number, refresh = false): Promise<RankingPage> => (
    invoke('discovery', () => window.electronAPI.getRanking(type, page, refresh))
  ),

  // 书籍
  getBook: (id: string, options?: BookLoadOptions) => (
    invoke('book', () => window.electronAPI.getBook(id, options))
  ),
  getBookImages: (id: string) => invoke('book', () => window.electronAPI.getBookImages(id)),
  getVolumeCovers: (id: string, volumes: string[]): Promise<VolumeCoverSnapshot> =>
    invoke('book', () => window.electronAPI.getVolumeCovers(id, volumes)),

  // 书架
  getBookshelf: (refresh = false): Promise<BookshelfPage> => (
    invoke('bookshelf', () => window.electronAPI.getBookshelf(refresh))
  ),

  // 下载
  getDownloadSnapshot: () =>
    invoke('download', () => window.electronAPI.getDownloadSnapshot()),
  enqueueDownload: (input: EnqueueDownloadInput) =>
    invoke('download', () => window.electronAPI.enqueueDownload(input)),
  enqueueDownloadBatch: (inputs: EnqueueDownloadInput[]) =>
    invoke('download', () => window.electronAPI.enqueueDownloadBatch(inputs)),
  cancelDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.cancelDownload(taskId)),
  cancelDownloadBatch: (batchId: string) =>
    invoke('download', () => window.electronAPI.cancelDownloadBatch(batchId)),
  retryDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.retryDownload(taskId)),
  retryDownloadBatch: (batchId: string) =>
    invoke('download', () => window.electronAPI.retryDownloadBatch(batchId)),
  removeDownload: (taskId: string) =>
    invoke('download', () => window.electronAPI.removeDownload(taskId)),
  clearDownloadHistory: (scope: DownloadHistoryScope) =>
    invoke('download', () => window.electronAPI.clearDownloadHistory(scope)),
  importLegacyDownloadHistory: (tasks: unknown[]) =>
    invoke('download', () => window.electronAPI.importLegacyDownloadHistory(tasks)),
  openDownloadArtifact: (taskId: string, artifactId: string) =>
    invoke('download-artifact', () => window.electronAPI.openDownloadArtifact(taskId, artifactId)),
  revealDownloadArtifact: (taskId: string, artifactId: string) =>
    invoke('download-artifact', () => window.electronAPI.revealDownloadArtifact(taskId, artifactId)),
  onDownloadStateChanged: (callback: (event: DownloadStateEvent) => void) =>
    window.electronAPI.onDownloadStateChanged(callback),

  // 缓存
  clearCache: (): Promise<CacheClearResult> =>
    invoke('cache-clear', () => window.electronAPI.clearCache()),

  // 文件
  openFolder: (target: OpenFolderTarget) =>
    invoke('open-folder', () => window.electronAPI.openFolder(target)),
  openLogFolder: () =>
    invoke('open-log-folder', () => window.electronAPI.openLogFolder()),
  getLogStats: (): Promise<LogStats> =>
    invoke('log-stats', () => window.electronAPI.getLogStats()),
  selectFolder: () =>
    invoke('select-folder', () => window.electronAPI.selectFolder()),
  openExternal: (url: string) =>
    invoke('open-external', () => window.electronAPI.openExternal(url)),
}

export default api
