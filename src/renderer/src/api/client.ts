export const api = {
  // 配置
  getConfig: () => window.electronAPI.getConfig(),

  setConfig: (section: string, key: string, value: string) =>
    window.electronAPI.setConfig(section, key, value),

  // Cookie
  autoGetCookie: () => window.electronAPI.autoGetCookie(),

  // 搜索
  searchAuthor: (q: string) => window.electronAPI.searchAuthor(q),
  searchTitle: (q: string) => window.electronAPI.searchTitle(q),

  // 书籍
  getBook: (id: string) => window.electronAPI.getBook(id),
  getBookImages: (id: string) => window.electronAPI.getBookImages(id),

  // 下载
  downloadEpub: (bookId: string, volumeName?: string) =>
    window.electronAPI.downloadEpub(bookId, volumeName),
  downloadImages: (bookId: string, volumeName?: string) =>
    window.electronAPI.downloadImages(bookId, volumeName),
}

export type SearchResult = {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  tags?: string
  desc?: string
}

export type BookInfo = {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}

export default api
