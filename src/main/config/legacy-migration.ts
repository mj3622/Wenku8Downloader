import { existsSync, readFileSync, rmSync } from 'fs'
import { parse } from 'smol-toml'
import type { SettingsLoadResult } from './settings-store'
import type { SecretLoadResult, SecretPayloadV1 } from './secret-store'
import { COOKIE_NAMES, emptyCookieSnapshot } from './secret-types'
import { parseSettingsDocument } from './config-schema'

export interface LegacySettingsStorePort {
  load(): SettingsLoadResult
  save(
    next: ReturnType<typeof parseSettingsDocument>['value'],
    preservedDownload?: Readonly<Record<string, unknown>>,
  ): ReturnType<typeof parseSettingsDocument>['value']
}

export interface LegacySecretStorePort {
  load(): SecretLoadResult
  save(next: SecretPayloadV1): SecretPayloadV1
  isEncryptionAvailable(): boolean
}

export type LegacyRecoveryReason =
  | 'new-store-invalid'
  | 'legacy-invalid'
  | 'write-failed'

export type LegacyMigrationResult =
  | { state: 'not-needed' }
  | { state: 'migrated' }
  | { state: 'cleanup-required'; message: string }
  | {
      state: 'recovery-required'
      reason: LegacyRecoveryReason
      message: string
    }
  | { state: 'encryption-unavailable'; message: string }
  | { state: 'read-only-newer-version'; message: string }

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('旧配置格式无效')
  }
  return value as Record<string, unknown>
}

function stringValue(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

function parseLegacySecrets(root: Record<string, unknown>): SecretPayloadV1 {
  const login = root.login === undefined ? {} : requireRecord(root.login)
  const cookies = root.cookie === undefined ? {} : requireRecord(root.cookie)
  const cookieSnapshot = emptyCookieSnapshot()
  for (const name of COOKIE_NAMES) {
    cookieSnapshot[name] = stringValue(cookies, name)
  }
  return {
    login: {
      username: stringValue(login, 'username'),
      password: stringValue(login, 'password'),
    },
    cookies: cookieSnapshot,
  }
}

export function migrateLegacyConfig(input: {
  legacyPath: string
  settingsStore: LegacySettingsStorePort
  secretStore: LegacySecretStorePort
}): LegacyMigrationResult {
  if (!existsSync(input.legacyPath)) return { state: 'not-needed' }

  const settingsBefore = input.settingsStore.load()
  const secretsBefore = input.secretStore.load()
  if (
    settingsBefore.state === 'read-only-newer-version'
    || secretsBefore.state === 'read-only-newer-version'
  ) {
    return {
      state: 'read-only-newer-version',
      message: '检测到由更新版本创建的配置，旧明文配置已保留',
    }
  }
  if (
    settingsBefore.state === 'recovery-required'
    || secretsBefore.state === 'recovery-required'
  ) {
    return {
      state: 'recovery-required',
      reason: 'new-store-invalid',
      message: '新配置文件无法读取，旧明文配置已保留',
    }
  }
  if (settingsBefore.state === 'ok' && secretsBefore.state === 'ok') {
    try {
      rmSync(input.legacyPath)
      return { state: 'migrated' }
    } catch {
      return {
        state: 'cleanup-required',
        message: '新配置已验证，但旧明文配置尚未清理，可重试清理',
      }
    }
  }

  let legacySettings: ReturnType<typeof parseSettingsDocument>['value']
  let legacyDownload: Record<string, unknown>
  let legacySecrets: SecretPayloadV1
  try {
    const legacyRoot = requireRecord(parse(readFileSync(input.legacyPath, 'utf-8')))
    legacyDownload = legacyRoot.download === undefined
      ? {}
      : requireRecord(legacyRoot.download)
    legacySettings = parseSettingsDocument({ download: legacyDownload }).value
    legacySecrets = parseLegacySecrets(legacyRoot)
  } catch {
    return {
      state: 'recovery-required',
      reason: 'legacy-invalid',
      message: '旧配置格式无效，原文件已保留',
    }
  }

  try {
    if (settingsBefore.state === 'missing') {
      input.settingsStore.save(legacySettings, legacyDownload)
    }
    if (!input.secretStore.isEncryptionAvailable()) {
      return {
        state: 'encryption-unavailable',
        message: '系统安全存储不可用，旧明文凭证未迁移',
      }
    }
    if (secretsBefore.state !== 'ok') {
      input.secretStore.save(legacySecrets)
    }

    const settingsAfter = input.settingsStore.load()
    const secretsAfter = input.secretStore.load()
    if (settingsAfter.state !== 'ok' || secretsAfter.state !== 'ok') {
      throw new Error('迁移后的配置验证失败')
    }
  } catch {
    return {
      state: 'recovery-required',
      reason: 'write-failed',
      message: '旧配置迁移失败，原文件已保留',
    }
  }

  try {
    rmSync(input.legacyPath)
    return { state: 'migrated' }
  } catch {
    return {
      state: 'cleanup-required',
      message: '新配置已验证，但旧明文配置尚未清理，可重试清理',
    }
  }
}
