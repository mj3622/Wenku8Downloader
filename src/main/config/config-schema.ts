import { isAbsolute } from 'path'
import type { DownloadConfig, TitleFormat } from '../../shared/config-types'

export const CURRENT_CONFIG_VERSION = 1 as const

export const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = Object.freeze({
  fullTitle: 'FULL',
  defaultCoverIndex: 0,
  downloadPath: '',
})

export type SettingsDocument = Record<string, unknown> & {
  config_version: number
  download: Record<string, unknown>
}

export type SettingsParseResult =
  | {
      state: 'ok' | 'migrated'
      value: DownloadConfig
      raw: SettingsDocument
    }
  | {
      state: 'read-only-newer-version'
      value: DownloadConfig
      raw: Record<string, unknown>
    }

function requireRecord(value: unknown, message = '配置格式无效'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function cloneDownload(value: DownloadConfig): DownloadConfig {
  return { ...value }
}

function parseTitleFormat(value: unknown): TitleFormat {
  if (value !== 'FULL' && value !== 'IN' && value !== 'OUT') {
    throw new Error('书名格式必须为 FULL、IN 或 OUT')
  }
  return value
}

function parseCoverIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('封面图片索引必须为非负整数')
  }
  return value as number
}

function parseLegacyCoverIndex(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  }
  return DEFAULT_DOWNLOAD_CONFIG.defaultCoverIndex
}

function parseDownloadPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.includes('\0')
    || (value !== '' && !isAbsolute(value))
  ) {
    throw new Error('下载路径格式无效')
  }
  return value
}

export function validateDownloadConfig(value: unknown): DownloadConfig {
  const record = requireRecord(value, '下载设置格式无效')
  const allowedKeys = new Set(['fullTitle', 'defaultCoverIndex', 'downloadPath'])
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new Error(`未知下载设置: ${unknownKey}`)

  return {
    fullTitle: parseTitleFormat(record.fullTitle),
    defaultCoverIndex: parseCoverIndex(record.defaultCoverIndex),
    downloadPath: parseDownloadPath(record.downloadPath),
  }
}

function normalizeLegacyDownload(record: Record<string, unknown>): DownloadConfig {
  const fullTitle: TitleFormat = record.full_title === 'IN' || record.full_title === 'OUT'
    ? record.full_title
    : 'FULL'

  const defaultCoverIndex = parseLegacyCoverIndex(record.default_cover_index)

  const downloadPath = typeof record.download_path === 'string'
    && !record.download_path.includes('\0')
    && (
      record.download_path === ''
      || isAbsolute(record.download_path)
    )
    ? record.download_path
    : DEFAULT_DOWNLOAD_CONFIG.downloadPath

  return { fullTitle, defaultCoverIndex, downloadPath }
}

export function toSettingsDocument(
  value: DownloadConfig,
  currentRaw: Record<string, unknown> = {},
): SettingsDocument {
  const root = structuredClone(currentRaw)
  const existingDownload = root.download && typeof root.download === 'object' && !Array.isArray(root.download)
    ? root.download as Record<string, unknown>
    : {}

  return {
    ...root,
    config_version: CURRENT_CONFIG_VERSION,
    download: {
      ...existingDownload,
      full_title: value.fullTitle,
      default_cover_index: value.defaultCoverIndex,
      download_path: value.downloadPath,
    },
  }
}

export function parseSettingsDocument(value: unknown): SettingsParseResult {
  const root = requireRecord(value)
  const version = root.config_version

  if (typeof version === 'number' && version > CURRENT_CONFIG_VERSION) {
    return {
      state: 'read-only-newer-version',
      value: cloneDownload(DEFAULT_DOWNLOAD_CONFIG),
      raw: structuredClone(root),
    }
  }

  const download = root.download === undefined
    ? {}
    : requireRecord(root.download, '下载设置格式无效')

  if (version === undefined || version === 0) {
    const normalized = normalizeLegacyDownload(download)
    return {
      state: 'migrated',
      value: normalized,
      raw: toSettingsDocument(normalized, root),
    }
  }

  if (version !== CURRENT_CONFIG_VERSION) {
    throw new Error('配置版本格式无效')
  }

  const normalized = validateDownloadConfig({
    fullTitle: download.full_title,
    defaultCoverIndex: download.default_cover_index,
    downloadPath: download.download_path,
  })
  return {
    state: 'ok',
    value: normalized,
    raw: toSettingsDocument(normalized, root),
  }
}
