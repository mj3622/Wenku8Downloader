export type CookieProgress = {
  step: string
  message: string
}

export type DownloadProgress = {
  taskId: string
  current: number
  total: number
  phase: string
}

export const api = {
  // 配置
  getConfig: () => window.electronAPI.getConfig(),

  setConfig: (section: string, key: string, value: string) =>
    window.electronAPI.setConfig(section, key, value),

  // Cookie
  autoGetCookie: () => window.electronAPI.autoGetCookie(),
  getCookieProgress: (callback: (data: CookieProgress) => void) => {
    window.electronAPI.onCookieProgress(callback)
  },

  // 搜索
  searchAuthor: (q: string) => window.electronAPI.searchAuthor(q),
  searchTitle: (q: string) => window.electronAPI.searchTitle(q),

  // 书籍
  getBook: (id: string) => window.electronAPI.getBook(id),
  getBookImages: (id: string) => window.electronAPI.getBookImages(id),

  // 下载
  downloadEpub: (bookId: string, volumeName?: string, taskId?: string) =>
    window.electronAPI.downloadEpub(bookId, volumeName, taskId),
  downloadImages: (bookId: string, volumeName?: string, taskId?: string) =>
    window.electronAPI.downloadImages(bookId, volumeName, taskId),
  getDownloadProgress: (callback: (data: DownloadProgress) => void) => {
    window.electronAPI.onDownloadProgress(callback)
  },

  // 文件
  openFolder: (subdir: string) => window.electronAPI.openFolder(subdir),
  selectFolder: () => window.electronAPI.selectFolder(),
}

export type SearchResult = {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  updateTime?: string
  tags?: string
  desc?: string
}

export type BookInfo = {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}

export default api
