import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConfigApi,
  DownloadConfig,
  UpdateCredentialsInput,
} from '../shared/config-types'
import type { DownloadFolder } from '../shared/ipc-types'

const configApi: ConfigApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateDownloadConfig: (input: DownloadConfig) =>
    ipcRenderer.invoke('config:update-download', input),
  updateCredentials: (input: UpdateCredentialsInput) =>
    ipcRenderer.invoke('config:update-credentials', input),
  resetCorruptConfig: () => ipcRenderer.invoke('config:reset-corrupt'),
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  ...configApi,
  autoGetCookie: () => ipcRenderer.invoke('cookie:auto'),
  searchAuthor: (query: string) => ipcRenderer.invoke('search:author', { query }),
  searchTitle: (query: string) => ipcRenderer.invoke('search:title', { query }),
  getBook: (bookId: string) => ipcRenderer.invoke('book:get', { bookId }),
  getBookImages: (bookId: string) => ipcRenderer.invoke('book:images', { bookId }),
  downloadEpub: (bookId: string, volumeName?: string, taskId?: string) =>
    ipcRenderer.invoke('download:epub', { bookId, volumeName, taskId }),
  downloadImages: (bookId: string, volumeName?: string, taskId?: string) =>
    ipcRenderer.invoke('download:images', { bookId, volumeName, taskId }),
  onCookieProgress: (callback: (data: { step: string; message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { step: string; message: string }) => callback(data)
    ipcRenderer.on('cookie:progress', listener)
    return () => ipcRenderer.removeListener('cookie:progress', listener)
  },
  onDownloadProgress: (callback: (data: { taskId: string; current: number; total: number; phase: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { taskId: string; current: number; total: number; phase: string }) => callback(data)
    ipcRenderer.on('download:progress', listener)
    return () => ipcRenderer.removeListener('download:progress', listener)
  },
  openFolder: (subdir: DownloadFolder) => ipcRenderer.invoke('shell:openFolder', subdir),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
})
