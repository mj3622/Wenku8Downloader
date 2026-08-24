export const DOWNLOAD_FOLDERS = ['pics', 'novels'] as const

export type DownloadFolder = typeof DOWNLOAD_FOLDERS[number]

export const OPEN_FOLDER_TARGETS = ['root', ...DOWNLOAD_FOLDERS] as const

export type OpenFolderTarget = typeof OPEN_FOLDER_TARGETS[number]

export interface DownloadResult {
  status: 'ok'
  message: string
  warnings?: string[]
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
