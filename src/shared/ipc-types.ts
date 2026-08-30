export const DOWNLOAD_FOLDERS = ['pics', 'novels'] as const

export type DownloadFolder = typeof DOWNLOAD_FOLDERS[number]

export const OPEN_FOLDER_TARGETS = ['root', ...DOWNLOAD_FOLDERS] as const

export type OpenFolderTarget = typeof OPEN_FOLDER_TARGETS[number]

export type SearchType = 'author' | 'title'

export interface SearchResult {
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

export type SearchResponse =
  | {
      status: 'ok'
      results: SearchResult[]
      fetchedAt: number
      cached: boolean
    }
  | {
      status: 'cooldown'
      retryAt: number
      cachedResults?: SearchResult[]
    }

export interface SearchApi {
  searchAuthor(query: string): Promise<SearchResponse>
  searchTitle(query: string): Promise<SearchResponse>
}

export const DOWNLOAD_TASK_TYPES = ['epub_full', 'epub_volume', 'images'] as const

export type DownloadTaskType = typeof DOWNLOAD_TASK_TYPES[number]

export const DOWNLOAD_TASK_STATUSES = [
  'pending',
  'downloading',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const

export type DownloadTaskStatus = typeof DOWNLOAD_TASK_STATUSES[number]

export const ACTIVE_DOWNLOAD_STATUSES: readonly DownloadTaskStatus[] = [
  'pending',
  'downloading',
  'cancelling',
]

export const RETRYABLE_DOWNLOAD_STATUSES: readonly DownloadTaskStatus[] = [
  'failed',
  'cancelled',
  'interrupted',
]

export const TERMINAL_DOWNLOAD_STATUSES: readonly DownloadTaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]

export interface DownloadTask {
  id: string
  bookId: string
  title: string
  cover?: string
  type: DownloadTaskType
  volume?: string
  status: DownloadTaskStatus
  progress: number
  phase?: string
  error?: string
  warning?: string
  createdAt: number
  updatedAt: number
}

export interface DownloadSnapshot {
  revision: number
  tasks: DownloadTask[]
  storageWarning?: string
  legacyImportCompleted: boolean
}

export interface DownloadTransition {
  taskId: string
  from?: DownloadTaskStatus
  to: DownloadTaskStatus
}

export interface DownloadStateEvent {
  snapshot: DownloadSnapshot
  transition?: DownloadTransition
}

export interface EnqueueDownloadInput {
  bookId: string
  title: string
  cover?: string
  type: DownloadTaskType
  volume?: string
}

export type DownloadHistoryScope = 'completed' | 'terminal'

export interface DownloadApi {
  getDownloadSnapshot(): Promise<DownloadSnapshot>
  enqueueDownload(input: EnqueueDownloadInput): Promise<DownloadSnapshot>
  cancelDownload(taskId: string): Promise<DownloadSnapshot>
  retryDownload(taskId: string): Promise<DownloadSnapshot>
  removeDownload(taskId: string): Promise<DownloadSnapshot>
  clearDownloadHistory(scope: DownloadHistoryScope): Promise<DownloadSnapshot>
  importLegacyDownloadHistory(tasks: unknown[]): Promise<DownloadSnapshot>
  onDownloadStateChanged(callback: (event: DownloadStateEvent) => void): () => void
}

export interface CookieProgress {
  operationId: string
  step: string
  message: string
}

export interface RendererErrorReport {
  kind: 'error' | 'unhandled-rejection'
  message: string
  stack?: string
  source?: string
  line?: number
  column?: number
}

export interface LogStats {
  totalSizeBytes: number
}

export interface VolumeCoverSnapshot {
  covers: Record<string, string>
}

export interface BookLoadOptions {
  revalidate?: boolean
}

export interface CacheClearResult {
  deferred: boolean
}

export interface CacheApi {
  clearCache(): Promise<CacheClearResult>
}

export const RANKING_OPTIONS = [
  { type: 'allvisit', label: '总排行榜' },
  { type: 'weekvisit', label: '周排行榜' },
  { type: 'monthvisit', label: '月排行榜' },
  { type: 'dayvisit', label: '日排行榜' },
  { type: 'weekvote', label: '本周推荐榜' },
  { type: 'goodnum', label: '收藏榜' },
  { type: 'lastupdate', label: '最近更新' },
  { type: 'anime', label: '动画化作品' },
  { type: 'postdate', label: '最新入库' },
] as const

export type RankingType = typeof RANKING_OPTIONS[number]['type']

export const RANKING_TYPES: readonly RankingType[] = Object.freeze(
  RANKING_OPTIONS.map(({ type }) => type),
)

export const RANKING_TITLES: Readonly<Record<RankingType, string>> = Object.freeze(
  Object.fromEntries(RANKING_OPTIONS.map(({ type, label }) => [type, label])) as Record<
    RankingType,
    string
  >,
)

export const DISCOVERY_FRESH_MS = 30 * 60 * 1000

export function isDiscoveryFresh(fetchedAt: number, now = Date.now()): boolean {
  return Number.isFinite(fetchedAt)
    && Math.max(0, now - fetchedAt) <= DISCOVERY_FRESH_MS
}

export interface DiscoveryBook {
  id: string
  title: string
  cover: string
  rank?: number
}

export interface DiscoverySection {
  key: string
  title: string
  moreRanking: RankingType
  books: DiscoveryBook[]
}

export interface DiscoveryHome {
  sections: DiscoverySection[]
  fetchedAt: number
  stale: boolean
}

export interface RankingPage {
  type: RankingType
  title: string
  page: number
  totalPages: number
  books: DiscoveryBook[]
  fetchedAt: number
  stale: boolean
}

export interface DiscoveryApi {
  getDiscoveryHome(refresh?: boolean): Promise<DiscoveryHome>
  getRanking(type: RankingType, page: number, refresh?: boolean): Promise<RankingPage>
}
