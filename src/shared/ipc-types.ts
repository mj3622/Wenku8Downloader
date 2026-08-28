export const DOWNLOAD_FOLDERS = ['pics', 'novels'] as const

export type DownloadFolder = typeof DOWNLOAD_FOLDERS[number]

export const OPEN_FOLDER_TARGETS = ['root', ...DOWNLOAD_FOLDERS] as const

export type OpenFolderTarget = typeof OPEN_FOLDER_TARGETS[number]

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
