import { rmSync } from 'fs'
import type {
  ConfigHealth,
  DownloadConfig,
  PublicConfigSnapshot,
  UpdateCredentialsInput,
} from '../../shared/config-types'
import {
  migrateLegacyConfig,
  type LegacyMigrationResult,
  type LegacySecretStorePort,
  type LegacySettingsStorePort,
} from './legacy-migration'
import {
  emptySecretPayload,
  type SecretLoadResult,
  type SecretPayloadV1,
} from './secret-store'
import {
  COOKIE_NAMES,
  type CookieSnapshot,
  type Credentials,
} from './secret-types'
import type { SettingsLoadResult } from './settings-store'
import { backupInvalidFile } from './atomic-file'

export interface SettingsStorePort extends LegacySettingsStorePort {
  initializeDefaults(): DownloadConfig
  backupCorrupt(): string | null
}

export interface SecretStorePort extends LegacySecretStorePort {
  backupCorrupt(): string | null
}

function cloneDownload(value: DownloadConfig): DownloadConfig {
  return { ...value }
}

function cloneSecrets(value: SecretPayloadV1): SecretPayloadV1 {
  return {
    login: { ...value.login },
    cookies: { ...value.cookies },
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

export function validateCredentialsInput(value: unknown): UpdateCredentialsInput {
  const record = requireRecord(value, '账号设置格式无效')
  const allowed = new Set(['username', 'password'])
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key))
  if (unknownKey) throw new Error(`未知账号设置: ${unknownKey}`)
  if (typeof record.username !== 'string' || record.username.length > 256) {
    throw new Error('用户名格式无效')
  }
  if (
    record.password !== undefined
    && (typeof record.password !== 'string' || record.password.length > 4096)
  ) {
    throw new Error('密码格式无效')
  }
  return record.password === undefined
    ? { username: record.username }
    : { username: record.username, password: record.password as string }
}

function validateCookies(value: unknown): CookieSnapshot {
  const record = requireRecord(value, 'Cookie 设置格式无效')
  const unknownKey = Object.keys(record).find(
    (key) => !COOKIE_NAMES.includes(key as typeof COOKIE_NAMES[number]),
  )
  if (unknownKey) throw new Error(`未知 Cookie: ${unknownKey}`)
  const result = {} as CookieSnapshot
  for (const key of COOKIE_NAMES) {
    if (typeof record[key] !== 'string' || (record[key] as string).length > 16_384) {
      throw new Error('Cookie 设置格式无效')
    }
    result[key] = record[key] as string
  }
  return result
}

function healthFrom(
  settings: SettingsLoadResult,
  secrets: SecretLoadResult,
  migration: LegacyMigrationResult,
): ConfigHealth {
  if (
    settings.state === 'read-only-newer-version'
    || secrets.state === 'read-only-newer-version'
    || migration.state === 'read-only-newer-version'
  ) {
    return {
      state: 'read-only-newer-version',
      message: '配置由更新版本创建，当前版本以只读方式运行',
    }
  }
  if (
    settings.state === 'recovery-required'
    || secrets.state === 'recovery-required'
    || migration.state === 'recovery-required'
    || migration.state === 'cleanup-required'
  ) {
    return {
      state: 'recovery-required',
      message: migration.state === 'cleanup-required'
        ? migration.message
        : '配置文件无法完整读取，原文件已保留，可重置后继续',
    }
  }
  if (
    secrets.state === 'encryption-unavailable'
    || migration.state === 'encryption-unavailable'
  ) {
    return {
      state: 'encryption-unavailable',
      message: '系统安全存储不可用，账号和 Cookie 无法持久化',
    }
  }
  return { state: 'ok' }
}

export class ConfigService {
  private credentialRevision = 0

  private constructor(
    private readonly settingsStore: SettingsStorePort,
    private readonly secretStore: SecretStorePort,
    private readonly legacyPath: string,
    private download: DownloadConfig,
    private secrets: SecretPayloadV1,
    private settingsLoad: SettingsLoadResult,
    private secretLoad: SecretLoadResult,
    private migration: LegacyMigrationResult,
  ) {}

  private publishLoadedState(
    settingsLoad: SettingsLoadResult,
    secretLoad: SecretLoadResult,
    migration: LegacyMigrationResult,
  ): void {
    const previousCredentials = this.secrets.login
    this.download = cloneDownload(settingsLoad.value)
    this.secrets = cloneSecrets(secretLoad.value)
    this.settingsLoad = settingsLoad
    this.secretLoad = secretLoad
    this.migration = migration
    if (
      secretLoad.state === 'ok'
      && (
        previousCredentials.username !== this.secrets.login.username
        || previousCredentials.password !== this.secrets.login.password
      )
    ) {
      this.credentialRevision++
    }
  }

  static load(input: {
    settingsStore: SettingsStorePort
    secretStore: SecretStorePort
    legacyPath: string
  }): ConfigService {
    const migration = migrateLegacyConfig(input)
    let settingsLoad = input.settingsStore.load()
    let secretLoad = input.secretStore.load()

    const mayInitialize = migration.state !== 'recovery-required'
      && migration.state !== 'read-only-newer-version'
    if (settingsLoad.state === 'missing' && mayInitialize) {
      try {
        const value = input.settingsStore.initializeDefaults()
        settingsLoad = { state: 'ok', value }
      } catch {
        settingsLoad = {
          state: 'recovery-required',
          value: settingsLoad.value,
          message: '默认设置无法写入',
        }
      }
    }
    if (
      secretLoad.state === 'missing'
      && mayInitialize
      && input.secretStore.isEncryptionAvailable()
    ) {
      try {
        const value = input.secretStore.save(emptySecretPayload())
        secretLoad = { state: 'ok', value }
      } catch {
        secretLoad = {
          state: 'recovery-required',
          value: secretLoad.value,
          message: '默认敏感配置无法写入',
        }
      }
    }

    return new ConfigService(
      input.settingsStore,
      input.secretStore,
      input.legacyPath,
      cloneDownload(settingsLoad.value),
      cloneSecrets(secretLoad.value),
      settingsLoad,
      secretLoad,
      migration,
    )
  }

  getPublicSnapshot(): PublicConfigSnapshot {
    return {
      download: cloneDownload(this.download),
      account: {
        username: this.secrets.login.username,
        hasPassword: this.secrets.login.password.length > 0,
        hasCookies: Object.values(this.secrets.cookies).some(Boolean),
      },
      health: healthFrom(this.settingsLoad, this.secretLoad, this.migration),
    }
  }

  getDownloadSnapshot(): Readonly<DownloadConfig> {
    return cloneDownload(this.download)
  }

  getCredentials(): Readonly<Credentials> {
    return { ...this.secrets.login }
  }

  getCredentialRevision(): number {
    return this.credentialRevision
  }

  getCookies(): Readonly<CookieSnapshot> {
    return { ...this.secrets.cookies }
  }

  updateDownload(input: DownloadConfig): PublicConfigSnapshot {
    if (
      this.settingsLoad.state === 'recovery-required'
      || this.settingsLoad.state === 'read-only-newer-version'
    ) {
      throw new Error('下载设置当前不可修改，请先恢复配置')
    }
    let saved: DownloadConfig
    try {
      saved = this.settingsStore.save(input)
    } catch (error) {
      throw new Error('下载设置保存失败', { cause: error })
    }
    this.download = cloneDownload(saved)
    this.settingsLoad = { state: 'ok', value: cloneDownload(saved) }
    return this.getPublicSnapshot()
  }

  updateCredentials(value: UpdateCredentialsInput): PublicConfigSnapshot {
    if (
      this.secretLoad.state !== 'ok'
      || !this.secretStore.isEncryptionAvailable()
    ) {
      throw new Error('账号和 Cookie 当前不可修改，请先恢复安全存储')
    }
    if (value.username !== this.secrets.login.username && value.password === undefined) {
      throw new Error('用户名变更时必须提供密码')
    }

    const password = value.password ?? this.secrets.login.password
    const credentialsChanged = value.username !== this.secrets.login.username
      || password !== this.secrets.login.password
    const clearRequested = value.username === '' && value.password === ''
    const next: SecretPayloadV1 = clearRequested
      ? emptySecretPayload()
      : {
          login: { username: value.username, password },
          cookies: credentialsChanged
            ? emptySecretPayload().cookies
            : { ...this.secrets.cookies },
        }
    let saved: SecretPayloadV1
    try {
      saved = this.secretStore.save(next)
    } catch (error) {
      throw new Error('账号设置保存失败', { cause: error })
    }
    this.secrets = cloneSecrets(saved)
    this.secretLoad = { state: 'ok', value: cloneSecrets(saved) }
    if (credentialsChanged) this.credentialRevision++
    return this.getPublicSnapshot()
  }

  replaceCookies(input: CookieSnapshot): void {
    if (
      this.secretLoad.state !== 'ok'
      || !this.secretStore.isEncryptionAvailable()
    ) {
      throw new Error('Cookie 当前不可保存，请先恢复安全存储')
    }
    const next: SecretPayloadV1 = {
      login: { ...this.secrets.login },
      cookies: validateCookies(input),
    }
    let saved: SecretPayloadV1
    try {
      saved = this.secretStore.save(next)
    } catch (error) {
      throw new Error('Cookie 保存失败', { cause: error })
    }
    this.secrets = cloneSecrets(saved)
    this.secretLoad = { state: 'ok', value: cloneSecrets(saved) }
  }

  resetCorruptConfig(): PublicConfigSnapshot {
    if (this.getPublicSnapshot().health.state !== 'recovery-required') {
      throw new Error('当前配置不需要重置')
    }
    let resetSettings = this.settingsLoad.state === 'missing'
      || this.settingsLoad.state === 'recovery-required'
    let resetSecrets = this.secretLoad.state === 'missing'
      || this.secretLoad.state === 'recovery-required'
    if (resetSecrets && !this.secretStore.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法重置敏感配置')
    }

    let download = cloneDownload(this.download)
    let secrets = cloneSecrets(this.secrets)
    try {
      if (
        this.migration.state === 'recovery-required'
        && this.migration.reason !== 'legacy-invalid'
      ) {
        if (this.settingsLoad.state === 'recovery-required') {
          this.settingsStore.backupCorrupt()
        }
        if (this.secretLoad.state === 'recovery-required') {
          this.secretStore.backupCorrupt()
        }

        const retried = migrateLegacyConfig({
          settingsStore: this.settingsStore,
          secretStore: this.secretStore,
          legacyPath: this.legacyPath,
        })
        const settingsAfter = this.settingsStore.load()
        const secretsAfter = this.secretStore.load()
        this.publishLoadedState(settingsAfter, secretsAfter, retried)

        if (retried.state === 'recovery-required') {
          if (retried.reason !== 'legacy-invalid') {
            throw new Error('旧配置迁移仍未完成，原文件已保留')
          }
          resetSettings = settingsAfter.state === 'missing'
            || settingsAfter.state === 'recovery-required'
          resetSecrets = secretsAfter.state === 'missing'
            || secretsAfter.state === 'recovery-required'
        } else {
          return this.getPublicSnapshot()
        }
      }

      if (this.settingsLoad.state === 'recovery-required') {
        this.settingsStore.backupCorrupt()
      }
      if (this.secretLoad.state === 'recovery-required') {
        this.secretStore.backupCorrupt()
      }
      if (this.migration.state === 'recovery-required') {
        backupInvalidFile(this.legacyPath)
      }
      if (this.migration.state === 'cleanup-required') {
        rmSync(this.legacyPath, { force: true })
      }
      if (resetSettings) download = this.settingsStore.initializeDefaults()
      if (resetSecrets) secrets = this.secretStore.save(emptySecretPayload())
    } catch (error) {
      throw new Error('配置重置失败，恢复备份已保留', { cause: error })
    }

    const nextSettingsLoad: SettingsLoadResult = resetSettings
      ? { state: 'ok', value: cloneDownload(download) }
      : this.settingsLoad
    const nextSecretLoad: SecretLoadResult = resetSecrets
      ? { state: 'ok', value: cloneSecrets(secrets) }
      : this.secretLoad
    this.publishLoadedState(nextSettingsLoad, nextSecretLoad, { state: 'not-needed' })
    return this.getPublicSnapshot()
  }
}
