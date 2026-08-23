export const DOWNLOAD_FOLDERS = ['pics', 'novels'] as const

export type DownloadFolder = typeof DOWNLOAD_FOLDERS[number]
