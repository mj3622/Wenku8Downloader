import type { ConfigApi } from '../../../shared/config-types'
import type { DownloadFolder } from '../../../shared/ipc-types'

export interface ElectronAPI extends ConfigApi {
  platform: NodeJS.Platform
  autoGetCookie: () => Promise<{ status: string; message: string }>
  searchAuthor: (query: string) => Promise<{ results: SearchResult[] }>
  searchTitle: (query: string) => Promise<{ results: SearchResult[] }>
  getBook: (bookId: string) => Promise<BookInfo>
  getBookImages: (bookId: string) => Promise<{ images: Record<string, string> }>
  downloadEpub: (bookId: string, volumeName?: string, taskId?: string) => Promise<{ status: string; message: string }>
  downloadImages: (bookId: string, volumeName?: string, taskId?: string) => Promise<{ status: string; message: string }>
  onCookieProgress: (callback: (data: { step: string; message: string }) => void) => () => void
  onDownloadProgress: (callback: (data: { taskId: string; current: number; total: number; phase: string }) => void) => () => void
  openFolder: (subdir: DownloadFolder) => Promise<void>
  selectFolder: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
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
