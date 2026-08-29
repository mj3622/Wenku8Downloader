import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConfigApi,
  DownloadConfig,
  LogConfig,
  UpdateCredentialsInput,
} from '../shared/config-types'
import type {
  CookieProgress,
  BookLoadOptions,
  CacheApi,
  DownloadApi,
  DownloadHistoryScope,
  DownloadStateEvent,
  EnqueueDownloadInput,
  LogStats,
  OpenFolderTarget,
  RendererErrorReport,
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
  cancelDownload: (taskId: string) =>
    ipcRenderer.invoke('download:cancel', { taskId }),
  retryDownload: (taskId: string) =>
    ipcRenderer.invoke('download:retry', { taskId }),
  removeDownload: (taskId: string) =>
    ipcRenderer.invoke('download:remove', { taskId }),
  clearDownloadHistory: (scope: DownloadHistoryScope) =>
    ipcRenderer.invoke('download:clear-history', { scope }),
  importLegacyDownloadHistory: (tasks: unknown[]) =>
    ipcRenderer.invoke('download:import-legacy-history', { tasks }),
  onDownloadStateChanged: (callback: (event: DownloadStateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DownloadStateEvent) => callback(event)
    ipcRenderer.on('download:state-changed', listener)
    return () => ipcRenderer.removeListener('download:state-changed', listener)
  },
}

const cacheApi: CacheApi = {
  clearCache: () => ipcRenderer.invoke('cache:clear'),
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  ...configApi,
  ...downloadApi,
  ...cacheApi,
  autoGetCookie: (operationId: string) => ipcRenderer.invoke('cookie:auto', { operationId }),
  searchAuthor: (query: string) => ipcRenderer.invoke('search:author', { query }),
  searchTitle: (query: string) => ipcRenderer.invoke('search:title', { query }),
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
