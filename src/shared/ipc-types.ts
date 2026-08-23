export const DOWNLOAD_FOLDERS = ['pics', 'novels'] as const

export type DownloadFolder = typeof DOWNLOAD_FOLDERS[number]

export const OPEN_FOLDER_TARGETS = ['root', ...DOWNLOAD_FOLDERS] as const

export type OpenFolderTarget = typeof OPEN_FOLDER_TARGETS[number]
