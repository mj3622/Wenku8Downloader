import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConfigApi,
  DownloadConfig,
  LogConfig,
  UpdateCredentialsInput,
} from '../shared/config-types'
import type {
  CookieProgress,
  AppApi,
  BookLoadOptions,
  BookshelfApi,
  CacheApi,
  CatalogApi,
  CatalogQuery,
  DiscoveryApi,
  DownloadApi,
  DownloadHistoryScope,
  DownloadStateEvent,
  EnqueueDownloadInput,
  LogStats,
  OpenFolderTarget,
  RankingType,
  RendererErrorReport,
  SearchApi,
  VolumeCoverSnapshot,
} from '../shared/ipc-types'

const configApi: ConfigApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateDownloadConfig: (input: DownloadConfig) =>
    ipcRenderer.invoke('config:update-download', input),
  updateLogConfig: (input: LogConfig) =>
    ipcRenderer.invoke('config:update-logging', input),
  updateCredentials: (input: UpdateCredentialsInput) =>
    ipcRenderer.invoke('config:update-credentials', input),
  resetCorruptConfig: () => ipcRenderer.invoke('config:reset-corrupt'),
}

const downloadApi: DownloadApi = {
  getDownloadSnapshot: () => ipcRenderer.invoke('download:get-snapshot'),
  enqueueDownload: (input: EnqueueDownloadInput) =>
    ipcRenderer.invoke('download:enqueue', input),
  enqueueDownloadBatch: (inputs: EnqueueDownloadInput[]) =>
    ipcRenderer.invoke('download:enqueue-batch', { inputs }),
  cancelDownload: (taskId: string) =>
    ipcRenderer.invoke('download:cancel', { taskId }),
  cancelDownloadBatch: (batchId: string) =>
    ipcRenderer.invoke('download:cancel-batch', { batchId }),
  retryDownload: (taskId: string) =>
    ipcRenderer.invoke('download:retry', { taskId }),
  retryDownloadBatch: (batchId: string) =>
    ipcRenderer.invoke('download:retry-batch', { batchId }),
  removeDownload: (taskId: string) =>
    ipcRenderer.invoke('download:remove', { taskId }),
  clearDownloadHistory: (scope: DownloadHistoryScope) =>
    ipcRenderer.invoke('download:clear-history', { scope }),
  importLegacyDownloadHistory: (tasks: unknown[]) =>
    ipcRenderer.invoke('download:import-legacy-history', { tasks }),
  openDownloadArtifact: (taskId: string, artifactId: string) =>
    ipcRenderer.invoke('download:artifact-open', { taskId, artifactId }),
  revealDownloadArtifact: (taskId: string, artifactId: string) =>
    ipcRenderer.invoke('download:artifact-reveal', { taskId, artifactId }),
  onDownloadStateChanged: (callback: (event: DownloadStateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DownloadStateEvent) => callback(event)
    ipcRenderer.on('download:state-changed', listener)
    return () => ipcRenderer.removeListener('download:state-changed', listener)
  },
}

const cacheApi: CacheApi = {
  clearCache: () => ipcRenderer.invoke('cache:clear'),
}

const catalogApi: CatalogApi = {
  getCatalog: (query: CatalogQuery, refresh = false) => (
    ipcRenderer.invoke('catalog:get', { query, refresh })
  ),
}

const discoveryApi: DiscoveryApi = {
  getDiscoveryHome: (refresh = false) => (
    ipcRenderer.invoke('discovery:get-home', { refresh })
  ),
  getRanking: (type: RankingType, page: number, refresh = false) => (
    ipcRenderer.invoke('discovery:get-ranking', { type, page, refresh })
  ),
  getAnnualRanking: (year: number, refresh = false) => (
    ipcRenderer.invoke('discovery:get-annual-ranking', { year, refresh })
  ),
}

const appApi: AppApi = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  checkForUpdates: (refresh = false) => ipcRenderer.invoke('app:check-update', { refresh }),
}

const searchApi: SearchApi = {
  searchAuthor: (query: string) => ipcRenderer.invoke('search:author', { query }),
  searchTitle: (query: string) => ipcRenderer.invoke('search:title', { query }),
}

const bookshelfApi: BookshelfApi = {
  getBookshelf: (refresh = false) => ipcRenderer.invoke('bookshelf:get', { refresh }),
  addBookToBookshelf: (bookId: string) => ipcRenderer.invoke('bookshelf:add', { bookId }),
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  ...appApi,
  ...configApi,
  ...downloadApi,
  ...cacheApi,
  ...catalogApi,
  ...discoveryApi,
  ...searchApi,
  ...bookshelfApi,
  autoGetCookie: (operationId: string) => ipcRenderer.invoke('cookie:auto', { operationId }),
  getBook: (bookId: string, options?: BookLoadOptions) => ipcRenderer.invoke('book:get', {
    bookId,
    ...(options?.revalidate === undefined ? {} : { revalidate: options.revalidate }),
  }),
  getBookImages: (bookId: string) => ipcRenderer.invoke('book:images', { bookId }),
  getVolumeCovers: (bookId: string, volumes: string[]): Promise<VolumeCoverSnapshot> =>
    ipcRenderer.invoke('book:volume-covers', { bookId, volumes }),
  onCookieProgress: (callback: (data: CookieProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: CookieProgress) => callback(data)
    ipcRenderer.on('cookie:progress', listener)
    return () => ipcRenderer.removeListener('cookie:progress', listener)
  },
  openFolder: (target: OpenFolderTarget) => ipcRenderer.invoke('shell:openFolder', target),
  openLogFolder: () => ipcRenderer.invoke('logs:open-directory'),
  getLogStats: (): Promise<LogStats> => ipcRenderer.invoke('logs:get-stats'),
  reportRendererError: (report: RendererErrorReport) =>
    ipcRenderer.send('log:renderer-error', report),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
})
