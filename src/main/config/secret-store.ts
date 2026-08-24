import { existsSync, readFileSync, rmSync } from 'fs'
import { atomicWriteFile, backupInvalidFile } from './atomic-file'
import type { SecretCodec } from './secret-codec'
import {
  COOKIE_NAMES,
  emptyCookieSnapshot,
  type CookieSnapshot,
  type Credentials,
} from './secret-types'

export interface SecretPayloadV1 {
  login: Credentials
  cookies: CookieSnapshot
}

interface SecretEnvelopeV1 {
  version: 1
  cipher: 'electron-safe-storage'
  data: string
}

export type SecretLoadResult =
  | { state: 'ok'; value: SecretPayloadV1 }
  | { state: 'missing'; value: SecretPayloadV1 }
  | { state: 'recovery-required'; value: SecretPayloadV1; message: string }
  | { state: 'encryption-unavailable'; value: SecretPayloadV1; message: string }
  | { state: 'read-only-newer-version'; value: SecretPayloadV1; message: string }

export function emptySecretPayload(): SecretPayloadV1 {
  return {
    login: { username: '', password: '' },
    cookies: emptyCookieSnapshot(),
  }
}

function cloneSecretPayload(value: SecretPayloadV1): SecretPayloadV1 {
  return {
    login: { ...value.login },
    cookies: { ...value.cookies },
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('敏感配置格式无效')
  }
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error('敏感配置格式无效')
  return value
}

function parseSecretPayload(value: unknown): SecretPayloadV1 {
  const root = requireRecord(value)
  const login = requireRecord(root.login)
  const cookies = requireRecord(root.cookies)
  const cookieSnapshot = emptyCookieSnapshot()
  for (const name of COOKIE_NAMES) {
    cookieSnapshot[name] = requireString(cookies, name)
  }
  return {
    login: {
      username: requireString(login, 'username'),
      password: requireString(login, 'password'),
    },
    cookies: cookieSnapshot,
  }
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('敏感配置密文格式无效')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new Error('敏感配置密文格式无效')
  }
  return decoded
}

export class SecretStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  isEncryptionAvailable(): boolean {
    return this.codec.isAvailable()
  }

  load(): SecretLoadResult {
    const fallback = emptySecretPayload()
    if (!existsSync(this.path)) {
      if (!this.codec.isAvailable()) {
        return {
          state: 'encryption-unavailable',
          value: fallback,
          message: '系统安全存储不可用，无法保存登录信息',
        }
      }
      return { state: 'missing', value: fallback }
    }
    if (!this.codec.isAvailable()) {
      return {
        state: 'encryption-unavailable',
        value: fallback,
        message: '系统安全存储不可用，无法读取登录信息',
      }
    }

    try {
      const parsed = requireRecord(JSON.parse(readFileSync(this.path, 'utf-8')))
      const version = parsed.version
      if (typeof version === 'number' && version > 1) {
        return {
          state: 'read-only-newer-version',
          value: fallback,
          message: '敏感配置由更新版本创建，当前版本不会覆盖该文件',
        }
      }
      if (
        version !== 1
        || parsed.cipher !== 'electron-safe-storage'
        || typeof parsed.data !== 'string'
      ) {
        throw new Error('敏感配置封装格式无效')
      }

      const encrypted = decodeBase64(parsed.data)
      const value = parseSecretPayload(JSON.parse(this.codec.decrypt(encrypted)))
      return { state: 'ok', value }
    } catch {
      return {
        state: 'recovery-required',
        value: fallback,
        message: '敏感配置无法读取，原文件已保留',
      }
    }
  }

  save(next: SecretPayloadV1): SecretPayloadV1 {
    if (!this.codec.isAvailable()) {
      throw new Error('系统安全存储不可用，无法保存登录信息')
    }

    const value = parseSecretPayload(next)
    const plainText = JSON.stringify(value)
    const encrypted = this.codec.encrypt(plainText)
    const verified = parseSecretPayload(JSON.parse(this.codec.decrypt(encrypted)))
    if (JSON.stringify(verified) !== JSON.stringify(value)) {
      throw new Error('敏感配置加密验证失败')
    }

    const envelope: SecretEnvelopeV1 = {
      version: 1,
      cipher: 'electron-safe-storage',
      data: encrypted.toString('base64'),
    }
    const previous = existsSync(this.path) ? readFileSync(this.path) : null
    atomicWriteFile(this.path, `${JSON.stringify(envelope, null, 2)}\n`)

    const loaded = this.load()
    if (loaded.state === 'ok' && JSON.stringify(loaded.value) === JSON.stringify(value)) {
      return cloneSecretPayload(loaded.value)
    }

    try {
      if (previous) atomicWriteFile(this.path, previous)
      else rmSync(this.path, { force: true })
    } catch (rollbackError) {
      throw new AggregateError(
        [new Error('敏感配置写入验证失败'), rollbackError],
        '敏感配置写入失败且无法回滚',
      )
    }
    throw new Error('敏感配置写入验证失败')
  }

  backupCorrupt(): string | null {
    return backupInvalidFile(this.path)
  }
}
