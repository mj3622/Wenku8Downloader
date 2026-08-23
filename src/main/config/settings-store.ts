import {
  existsSync,
  readFileSync,
  rmSync,
} from 'fs'
import { parse, stringify } from 'smol-toml'
import type { DownloadConfig } from '../../shared/config-types'
import { atomicWriteFile, backupInvalidFile } from './atomic-file'
import {
  DEFAULT_DOWNLOAD_CONFIG,
  parseSettingsDocument,
  toSettingsDocument,
  validateDownloadConfig,
  type SettingsDocument,
} from './config-schema'

export type SettingsLoadResult =
  | { state: 'ok'; value: DownloadConfig }
  | { state: 'missing'; value: DownloadConfig }
  | { state: 'recovery-required'; value: DownloadConfig; message: string }
  | { state: 'read-only-newer-version'; value: DownloadConfig; message: string }

function cloneDownload(value: DownloadConfig): DownloadConfig {
  return { ...value }
}

function serialize(document: SettingsDocument): string {
  return `${stringify(document as unknown as Record<string, unknown>)}\n`
}

export class SettingsStore {
  private rawDocument: Record<string, unknown> = {}
  private readOnly = false

  constructor(private readonly path: string) {}

  load(): SettingsLoadResult {
    if (!existsSync(this.path)) {
      this.rawDocument = {}
      this.readOnly = false
      return { state: 'missing', value: cloneDownload(DEFAULT_DOWNLOAD_CONFIG) }
    }

    try {
      const result = parseSettingsDocument(parse(readFileSync(this.path, 'utf-8')))
      this.rawDocument = structuredClone(result.raw)
      if (result.state === 'read-only-newer-version') {
        this.readOnly = true
        return {
          state: 'read-only-newer-version',
          value: cloneDownload(result.value),
          message: '设置文件由更新版本创建，当前版本不会覆盖该文件',
        }
      }

      this.readOnly = false
      if (result.state === 'migrated') {
        return { state: 'ok', value: this.save(result.value) }
      }
      return { state: 'ok', value: cloneDownload(result.value) }
    } catch {
      return {
        state: 'recovery-required',
        value: cloneDownload(DEFAULT_DOWNLOAD_CONFIG),
        message: '下载设置无法读取，原文件已保留',
      }
    }
  }

  initializeDefaults(): DownloadConfig {
    this.rawDocument = {}
    this.readOnly = false
    return this.save(DEFAULT_DOWNLOAD_CONFIG)
  }

  save(
    next: DownloadConfig,
    preservedDownload?: Readonly<Record<string, unknown>>,
  ): DownloadConfig {
    if (this.readOnly) {
      throw new Error('设置文件由更新版本创建，当前版本不能修改')
    }

    const value = validateDownloadConfig(next)
    const currentRaw = preservedDownload === undefined
      ? this.rawDocument
      : { download: structuredClone(preservedDownload) }
    const nextDocument = toSettingsDocument(value, currentRaw)
    const previous = existsSync(this.path) ? readFileSync(this.path) : null
    atomicWriteFile(this.path, serialize(nextDocument))

    try {
      const verified = parseSettingsDocument(parse(readFileSync(this.path, 'utf-8')))
      if (
        verified.state !== 'ok'
        || JSON.stringify(verified.value) !== JSON.stringify(value)
      ) {
        throw new Error('设置写入验证失败')
      }
      this.rawDocument = structuredClone(verified.raw)
      return cloneDownload(verified.value)
    } catch (error) {
      try {
        if (previous) atomicWriteFile(this.path, previous)
        else rmSync(this.path, { force: true })
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          '设置写入失败且无法回滚',
        )
      }
      throw error
    }
  }

  backupCorrupt(): string | null {
    const backupPath = backupInvalidFile(this.path)
    this.rawDocument = {}
    this.readOnly = false
    return backupPath
  }
}
