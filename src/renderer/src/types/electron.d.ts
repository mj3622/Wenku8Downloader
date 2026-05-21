export interface ElectronAPI {
  platform: NodeJS.Platform
  getConfig: () => Promise<Record<string, unknown>>
  setConfig: (section: string, key: string, value: string) => Promise<{ status: string }>
  autoGetCookie: () => Promise<{ status: string; message: string }>
  searchAuthor: (query: string) => Promise<{ results: SearchResult[] }>
  searchTitle: (query: string) => Promise<{ results: SearchResult[] }>
  getBook: (bookId: string) => Promise<BookInfo>
  getBookImages: (bookId: string) => Promise<{ images: Record<string, string> }>
  downloadEpub: (bookId: string, volumeName?: string) => Promise<{ status: string; message: string }>
  downloadImages: (bookId: string, volumeName?: string) => Promise<{ status: string; message: string }>
}

interface SearchResult {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  tags?: string
  desc?: string
}

interface BookInfo {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
