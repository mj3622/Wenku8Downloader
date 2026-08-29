import { isAbsolute } from 'path'
import type {
  DownloadConfig,
  LogConfig,
  TitleFormat,
} from '../../shared/config-types'

export const CURRENT_CONFIG_VERSION = 3 as const

export const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = Object.freeze({
  fullTitle: 'FULL',
  defaultCoverIndex: 0,
  downloadPath: '',
})

export const DEFAULT_LOG_CONFIG: LogConfig = Object.freeze({
  retentionDays: 30,
  maxFileSizeMb: 100,
  maxTotalSizeMb: 200,
})

export interface UiConfig {
  projectIntroSeen: boolean
}

export const DEFAULT_UI_CONFIG: UiConfig = Object.freeze({
  projectIntroSeen: false,
})

export interface SettingsConfig {
  download: DownloadConfig
  logging: LogConfig
  ui: UiConfig
}

export const DEFAULT_SETTINGS_CONFIG: Readonly<SettingsConfig> = Object.freeze({
  download: DEFAULT_DOWNLOAD_CONFIG,
  logging: DEFAULT_LOG_CONFIG,
  ui: DEFAULT_UI_CONFIG,
})

export type SettingsDocument = Record<string, unknown> & {
  config_version: number
  download: Record<string, unknown>
  logging: Record<string, unknown>
  ui: Record<string, unknown>
}

export type SettingsParseResult =
  | {
      state: 'ok' | 'migrated'
      value: SettingsConfig
      raw: SettingsDocument
    }
  | {
      state: 'read-only-newer-version'
      value: SettingsConfig
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

function cloneLogging(value: LogConfig): LogConfig {
  return { ...value }
}

function cloneSettings(value: SettingsConfig): SettingsConfig {
  return {
    download: cloneDownload(value.download),
    logging: cloneLogging(value.logging),
    ui: { ...value.ui },
  }
}

function parseTitleFormat(value: unknown): TitleFormat {
  if (value !== 'FULL' && value !== 'IN' && value !== 'OUT') {
    throw new Error('书名格式无效，请重新选择')
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
    throw new Error('下载路径无效，请重新选择文件夹')
  }
  return value
}

export function validateDownloadConfig(value: unknown): DownloadConfig {
  const record = requireRecord(value, '下载设置格式不正确，请刷新页面后重试')
  const allowedKeys = new Set(['fullTitle', 'defaultCoverIndex', 'downloadPath'])
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new Error('下载设置包含不支持的内容，请刷新页面后重试')

  return {
    fullTitle: parseTitleFormat(record.fullTitle),
    defaultCoverIndex: parseCoverIndex(record.defaultCoverIndex),
    downloadPath: parseDownloadPath(record.downloadPath),
  }
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label}必须为 ${minimum}–${maximum} 的整数`)
  }
  return value as number
}

export function validateLogConfig(value: unknown): LogConfig {
  const record = requireRecord(value, '日志设置格式不正确，请刷新页面后重试')
  const allowedKeys = new Set(['retentionDays', 'maxFileSizeMb', 'maxTotalSizeMb'])
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new Error('日志设置包含不支持的内容，请刷新页面后重试')

  const retentionDays = requireIntegerInRange(
    record.retentionDays,
    1,
    365,
    '日志保留天数',
  )
  const maxFileSizeMb = requireIntegerInRange(
    record.maxFileSizeMb,
    1,
    1024,
    '日志单文件上限',
  )
  const maxTotalSizeMb = requireIntegerInRange(
    record.maxTotalSizeMb,
    2,
    10240,
    '日志目录总上限',
  )
  if (maxTotalSizeMb < maxFileSizeMb * 2) {
    throw new Error('日志目录总上限必须至少为单文件上限的两倍')
  }
  return { retentionDays, maxFileSizeMb, maxTotalSizeMb }
}

export function validateUiConfig(value: unknown): UiConfig {
  const record = requireRecord(value, '界面设置格式无效')
  if (typeof record.projectIntroSeen !== 'boolean') {
    throw new Error('项目介绍状态格式无效')
  }
  return { projectIntroSeen: record.projectIntroSeen }
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
  value: SettingsConfig,
  currentRaw: Record<string, unknown> = {},
): SettingsDocument {
  const root = structuredClone(currentRaw)
  const existingDownload = root.download && typeof root.download === 'object' && !Array.isArray(root.download)
    ? root.download as Record<string, unknown>
    : {}
  const existingLogging = root.logging && typeof root.logging === 'object' && !Array.isArray(root.logging)
    ? root.logging as Record<string, unknown>
    : {}
  const existingUi = root.ui && typeof root.ui === 'object' && !Array.isArray(root.ui)
    ? root.ui as Record<string, unknown>
    : {}

  return {
    ...root,
    config_version: CURRENT_CONFIG_VERSION,
    download: {
      ...existingDownload,
      full_title: value.download.fullTitle,
      default_cover_index: value.download.defaultCoverIndex,
      download_path: value.download.downloadPath,
    },
    logging: {
      ...existingLogging,
      retention_days: value.logging.retentionDays,
      max_file_size_mb: value.logging.maxFileSizeMb,
      max_total_size_mb: value.logging.maxTotalSizeMb,
    },
    ui: {
      ...existingUi,
      project_intro_seen: value.ui.projectIntroSeen,
    },
  }
}

export function parseSettingsDocument(value: unknown): SettingsParseResult {
  const root = requireRecord(value)
  const version = root.config_version

  if (typeof version === 'number' && version > CURRENT_CONFIG_VERSION) {
    return {
      state: 'read-only-newer-version',
      value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
      raw: structuredClone(root),
    }
  }

  const download = root.download === undefined
    ? {}
    : requireRecord(root.download, '下载设置格式无效')

  if (version === undefined || version === 0) {
    const normalized: SettingsConfig = {
      download: normalizeLegacyDownload(download),
      logging: cloneLogging(DEFAULT_LOG_CONFIG),
      ui: { ...DEFAULT_UI_CONFIG },
    }
    return {
      state: 'migrated',
      value: normalized,
      raw: toSettingsDocument(normalized, root),
    }
  }

  if (version === 1) {
    const normalized: SettingsConfig = {
      download: validateDownloadConfig({
        fullTitle: download.full_title,
        defaultCoverIndex: download.default_cover_index,
        downloadPath: download.download_path,
      }),
      logging: cloneLogging(DEFAULT_LOG_CONFIG),
      ui: { ...DEFAULT_UI_CONFIG },
    }
    return {
      state: 'migrated',
      value: normalized,
      raw: toSettingsDocument(normalized, root),
    }
  }

  if (version === 2) {
    const logging = requireRecord(root.logging, '日志设置格式无效')
    const normalized: SettingsConfig = {
      download: validateDownloadConfig({
        fullTitle: download.full_title,
        defaultCoverIndex: download.default_cover_index,
        downloadPath: download.download_path,
      }),
      logging: validateLogConfig({
        retentionDays: logging.retention_days,
        maxFileSizeMb: logging.max_file_size_mb,
        maxTotalSizeMb: logging.max_total_size_mb,
      }),
      ui: { ...DEFAULT_UI_CONFIG },
    }
    return {
      state: 'migrated',
      value: normalized,
      raw: toSettingsDocument(normalized, root),
    }
  }

  if (version !== CURRENT_CONFIG_VERSION) {
    throw new Error('配置版本格式无效')
  }

  const logging = requireRecord(root.logging, '日志设置格式无效')
  const ui = requireRecord(root.ui, '界面设置格式无效')
  const normalized: SettingsConfig = {
    download: validateDownloadConfig({
      fullTitle: download.full_title,
      defaultCoverIndex: download.default_cover_index,
      downloadPath: download.download_path,
    }),
    logging: validateLogConfig({
      retentionDays: logging.retention_days,
      maxFileSizeMb: logging.max_file_size_mb,
      maxTotalSizeMb: logging.max_total_size_mb,
    }),
    ui: validateUiConfig({
      projectIntroSeen: ui.project_intro_seen,
    }),
  }
  return {
    state: 'ok',
    value: normalized,
    raw: toSettingsDocument(normalized, root),
  }
}
