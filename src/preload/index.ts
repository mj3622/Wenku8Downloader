import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (section: string, key: string, value: string) =>
    ipcRenderer.invoke('config:set', { section, key, value }),
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
    ipcRenderer.on('cookie:progress', (_event, data) => callback(data))
  },
  onDownloadProgress: (callback: (data: { taskId: string; current: number; total: number; phase: string }) => void) => {
    ipcRenderer.on('download:progress', (_event, data) => callback(data))
  },
  openFolder: (subdir: string) => ipcRenderer.invoke('shell:openFolder', subdir),
})
