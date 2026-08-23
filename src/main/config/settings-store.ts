import {
  existsSync,
  readFileSync,
  rmSync,
} from 'fs'
import { parse, stringify } from 'smol-toml'
import { atomicWriteFile, backupInvalidFile } from './atomic-file'
import {
  DEFAULT_SETTINGS_CONFIG,
  parseSettingsDocument,
  toSettingsDocument,
  validateDownloadConfig,
  validateLogConfig,
  type SettingsConfig,
  type SettingsDocument,
} from './config-schema'

export type SettingsLoadResult =
  | { state: 'ok'; value: SettingsConfig; migrated?: boolean }
  | { state: 'missing'; value: SettingsConfig }
  | {
      state: 'recovery-required'
      value: SettingsConfig
      message: string
      error?: unknown
    }
  | { state: 'read-only-newer-version'; value: SettingsConfig; message: string }

function cloneSettings(value: SettingsConfig): SettingsConfig {
  return {
    download: { ...value.download },
    logging: { ...value.logging },
  }
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
      return { state: 'missing', value: cloneSettings(DEFAULT_SETTINGS_CONFIG) }
    }

    try {
      const result = parseSettingsDocument(parse(readFileSync(this.path, 'utf-8')))
      this.rawDocument = structuredClone(result.raw)
      if (result.state === 'read-only-newer-version') {
        this.readOnly = true
        return {
          state: 'read-only-newer-version',
          value: cloneSettings(result.value),
          message: '设置文件由更新版本创建，当前版本不会覆盖该文件',
        }
      }

      this.readOnly = false
      if (result.state === 'migrated') {
        return { state: 'ok', value: this.save(result.value), migrated: true }
      }
      return { state: 'ok', value: cloneSettings(result.value) }
    } catch (error) {
      return {
        state: 'recovery-required',
        value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
        message: '下载设置无法读取，原文件已保留',
        error,
      }
    }
  }

  initializeDefaults(): SettingsConfig {
    this.rawDocument = {}
    this.readOnly = false
    return this.save(DEFAULT_SETTINGS_CONFIG)
  }

  save(
    next: SettingsConfig,
    preservedDownload?: Readonly<Record<string, unknown>>,
  ): SettingsConfig {
    if (this.readOnly) {
      throw new Error('设置文件由更新版本创建，当前版本不能修改')
    }

    const value: SettingsConfig = {
      download: validateDownloadConfig(next.download),
      logging: validateLogConfig(next.logging),
    }
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
      return cloneSettings(verified.value)
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
