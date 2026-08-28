import type { ConfigApi } from '../../../shared/config-types'
import type {
  CookieProgress,
  DownloadApi,
  LogStats,
  OpenFolderTarget,
  RendererErrorReport,
  VolumeCoverSnapshot,
} from '../../../shared/ipc-types'

export interface ElectronAPI extends ConfigApi, DownloadApi {
  platform: NodeJS.Platform
  autoGetCookie: (operationId: string) => Promise<{ status: string; message: string }>
  searchAuthor: (query: string) => Promise<{ results: SearchResult[] }>
  searchTitle: (query: string) => Promise<{ results: SearchResult[] }>
  getBook: (bookId: string) => Promise<BookInfo>
  getBookImages: (bookId: string) => Promise<{ images: Record<string, string> }>
  getVolumeCovers: (bookId: string, volumes: string[]) => Promise<VolumeCoverSnapshot>
  onCookieProgress: (callback: (data: CookieProgress) => void) => () => void
  openFolder: (target: OpenFolderTarget) => Promise<void>
  openLogFolder: () => Promise<void>
  getLogStats: () => Promise<LogStats>
  reportRendererError: (report: RendererErrorReport) => void
  selectFolder: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
}

interface SearchResult {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  updateTime?: string
  wordCount?: string
  isAnimated?: boolean
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
