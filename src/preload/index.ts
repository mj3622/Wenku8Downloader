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
  downloadEpub: (bookId: string, volumeName?: string) =>
    ipcRenderer.invoke('download:epub', { bookId, volumeName }),
  downloadImages: (bookId: string, volumeName?: string) =>
    ipcRenderer.invoke('download:images', { bookId, volumeName }),
})
