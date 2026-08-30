import type { ConfigApi } from '../../../shared/config-types'
import type { BookInfo } from '../../../shared/book-types'
import type {
  CookieProgress,
  AppApi,
  BookLoadOptions,
  BookshelfApi,
  CacheApi,
  CatalogApi,
  DiscoveryApi,
  DownloadApi,
  LogStats,
  OpenFolderTarget,
  RendererErrorReport,
  SearchApi,
  VolumeCoverSnapshot,
} from '../../../shared/ipc-types'

export interface ElectronAPI extends ConfigApi, DownloadApi, CacheApi, CatalogApi, DiscoveryApi, SearchApi, BookshelfApi, AppApi {
  platform: NodeJS.Platform
  autoGetCookie: (operationId: string) => Promise<{ status: string; message: string }>
  getBook: (bookId: string, options?: BookLoadOptions) => Promise<BookInfo>
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

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
