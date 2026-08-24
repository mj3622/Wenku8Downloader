import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { DownloadConfig, LogConfig } from '../../shared/config-types'
import {
  ConfigService,
  validateCredentialsInput,
  type SecretStorePort,
  type SettingsStorePort,
} from './config-service'
import type { SecretCodec } from './secret-codec'
import {
  emptySecretPayload,
  SecretStore,
  type SecretLoadResult,
  type SecretPayloadV1,
} from './secret-store'
import { SettingsStore, type SettingsLoadResult } from './settings-store'
import {
  DEFAULT_LOG_CONFIG,
  DEFAULT_SETTINGS_CONFIG,
  type SettingsConfig,
} from './config-schema'

const initialDownload: DownloadConfig = {
  fullTitle: 'FULL',
  defaultCoverIndex: 0,
  downloadPath: '',
}

const availableCodec: SecretCodec = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`encrypted:${Buffer.from(plain).toString('base64')}`),
  decrypt: (encrypted) => Buffer.from(
    encrypted.toString().slice('encrypted:'.length),
    'base64',
  ).toString('utf-8'),
}

const validLegacyToml = [
  '[download]',
  'full_title = "OUT"',
  'default_cover_index = "2"',
  'download_path = ""',
  '',
  '[login]',
  'username = "legacy-user"',
  'password = "legacy-password"',
  '',
  '[cookie]',
  'PHPSESSID = "legacy-session"',
  'jieqiUserInfo = ""',
  'jieqiVisitInfo = ""',
  'cf_clearance = ""',
  '',
].join('\n')

function cloneSecrets(value: SecretPayloadV1): SecretPayloadV1 {
  return { login: { ...value.login }, cookies: { ...value.cookies } }
}

function cloneSettings(value: SettingsConfig): SettingsConfig {
  return {
    download: { ...value.download },
    logging: { ...value.logging },
  }
}

function createStores(secretValue: SecretPayloadV1 = emptySecretPayload()) {
  let settings: SettingsConfig = {
    download: { ...initialDownload },
    logging: { ...DEFAULT_LOG_CONFIG },
  }
  let secrets = cloneSecrets(secretValue)
  const settingsStore: SettingsStorePort = {
    load: vi.fn((): SettingsLoadResult => ({ state: 'ok', value: cloneSettings(settings) })),
    initializeDefaults: vi.fn(() => cloneSettings(DEFAULT_SETTINGS_CONFIG)),
    save: vi.fn((next) => {
      settings = cloneSettings(next)
      return cloneSettings(settings)
    }),
    backupCorrupt: vi.fn(() => null),
  }
  const secretStore: SecretStorePort = {
    load: vi.fn((): SecretLoadResult => ({ state: 'ok', value: cloneSecrets(secrets) })),
    save: vi.fn((next) => {
      secrets = cloneSecrets(next)
      return cloneSecrets(secrets)
    }),
    backupCorrupt: vi.fn(() => null),
    isEncryptionAvailable: vi.fn(() => true),
  }
  return { settingsStore, secretStore }
}

let root: string
let legacyPath: string

describe('ConfigService', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-config-service-'))
    legacyPath = join(root, 'secrets.toml')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('publishes download updates only after one successful save', () => {
    const { settingsStore, secretStore } = createStores()
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(settingsStore.save).mockClear()
    const next = { fullTitle: 'OUT' as const, defaultCoverIndex: 3, downloadPath: 'D:\\Books' }

    expect(service.updateDownload(next).download).toEqual(next)
    expect(settingsStore.save).toHaveBeenCalledTimes(1)
    expect(settingsStore.save).toHaveBeenCalledWith({
      download: next,
      logging: DEFAULT_LOG_CONFIG,
    })
  })

  it('updates logging settings without changing download settings', () => {
    const { settingsStore, secretStore } = createStores()
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    const beforeDownload = service.getDownloadSnapshot()

    const snapshot = service.updateLogging({
      retentionDays: 7,
      maxFileSizeMb: 50,
      maxTotalSizeMb: 100,
    })

    expect(snapshot.logging).toEqual({
      retentionDays: 7,
      maxFileSizeMb: 50,
      maxTotalSizeMb: 100,
    })
    expect(snapshot.download).toEqual(beforeDownload)
  })

  it('preserves the old memory snapshot when secret persistence fails', () => {
    const { settingsStore, secretStore } = createStores()
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    const before = service.getPublicSnapshot()
    vi.mocked(secretStore.save).mockImplementationOnce(() => { throw new Error('disk full') })

    let thrown: unknown
    try {
      service.updateCredentials({
        username: 'new-user',
        password: 'new-password',
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('账号设置保存失败')
    expect((thrown as Error).message).not.toContain(root)
    expect(service.getPublicSnapshot()).toEqual(before)
  })

  it('does not expose the settings file path when persistence fails', () => {
    const { settingsStore, secretStore } = createStores()
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(settingsStore.save).mockImplementationOnce(() => {
      throw new Error(`EPERM: ${join(root, 'settings.toml')}`)
    })

    let thrown: unknown
    try {
      service.updateDownload({
        fullTitle: 'OUT',
        defaultCoverIndex: 1,
        downloadPath: '',
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('下载设置保存失败')
    expect((thrown as Error).message).not.toContain(root)
  })

  it('requires a password when the username changes', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'old-user', password: 'old-password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })

    expect(() => service.updateCredentials({ username: 'new-user' }))
      .toThrow('用户名变更时必须提供密码')
    expect(secretStore.save).not.toHaveBeenCalled()
  })

  it('rejects blank usernames and missing effective passwords in the service boundary', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'same-user', password: '' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    expect(() => service.updateCredentials({ username: '   ', password: 'secret' }))
      .toThrow('请输入用户名')
    expect(() => service.updateCredentials({ username: 'same-user' }))
      .toThrow('请输入密码')
    expect(secretStore.save).not.toHaveBeenCalled()
  })

  it('does not interpret username whitespace as an explicit credential clear request', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'same-user', password: 'old-password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    expect(() => service.updateCredentials({ username: '   ', password: '' }))
      .toThrow('请输入用户名')
    expect(secretStore.save).not.toHaveBeenCalled()
  })

  it('normalizes surrounding username whitespace at the IPC validation boundary', () => {
    expect(validateCredentialsInput({ username: '  tester  ', password: 'secret' }))
      .toEqual({ username: 'tester', password: 'secret' })
  })

  it('preserves an existing password for the same username', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'same-user', password: 'old-password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    service.updateCredentials({ username: 'same-user' })

    expect(secretStore.save).toHaveBeenCalledTimes(1)
    expect(secretStore.save).toHaveBeenCalledWith(expect.objectContaining({
      login: { username: 'same-user', password: 'old-password' },
    }))
  })

  it('clears stale cookies in the same credential save', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'old-user', password: 'old-password' },
      cookies: {
        PHPSESSID: 'session',
        jieqiUserInfo: 'info',
        jieqiVisitInfo: 'visit',
        cf_clearance: 'clearance',
      },
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    service.updateCredentials({ username: 'new-user', password: 'new-password' })

    expect(secretStore.save).toHaveBeenCalledTimes(1)
    expect(secretStore.save).toHaveBeenCalledWith({
      login: { username: 'new-user', password: 'new-password' },
      cookies: emptySecretPayload().cookies,
    })
  })

  it('clears a Cookie-only secret snapshot when explicitly clearing credentials', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: '', password: '' },
      cookies: {
        PHPSESSID: 'session',
        jieqiUserInfo: 'info',
        jieqiVisitInfo: 'visit',
        cf_clearance: 'clearance',
      },
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    const snapshot = service.updateCredentials({ username: '', password: '' })

    expect(secretStore.save).toHaveBeenCalledTimes(1)
    expect(secretStore.save).toHaveBeenCalledWith(emptySecretPayload())
    expect(snapshot.account).toEqual({
      username: '',
      hasPassword: false,
      hasCookies: false,
    })
  })

  it('increments the credential revision only after changed credentials are saved', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'old-user', password: 'old-password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()
    const before = service.getCredentialRevision()

    service.updateCredentials({ username: 'next-user', password: 'next-password' })
    expect(service.getCredentialRevision()).toBe(before + 1)

    service.updateCredentials({ username: 'next-user' })
    expect(service.getCredentialRevision()).toBe(before + 1)
  })

  it('does not increment the credential revision when secret persistence fails', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'old-user', password: 'old-password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()
    const before = service.getCredentialRevision()
    vi.mocked(secretStore.save).mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() => service.updateCredentials({
      username: 'next-user',
      password: 'next-password',
    })).toThrow('账号设置保存失败')
    expect(service.getCredentialRevision()).toBe(before)
  })

  it('returns defensive copies of all snapshots', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'user', password: 'password' },
      cookies: emptySecretPayload().cookies,
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })

    const download = service.getDownloadSnapshot() as DownloadConfig
    const logging = service.getLogSnapshot() as LogConfig
    const credentials = service.getCredentials() as SecretPayloadV1['login']
    download.downloadPath = 'mutated'
    logging.retentionDays = 1
    credentials.username = 'mutated'

    expect(service.getDownloadSnapshot().downloadPath).toBe('')
    expect(service.getLogSnapshot().retentionDays).toBe(30)
    expect(service.getCredentials().username).toBe('user')
  })

  it('reports a settings schema migration through internal load diagnostics', () => {
    const { settingsStore, secretStore } = createStores()
    vi.mocked(settingsStore.load).mockReturnValue({
      state: 'ok',
      value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
      migrated: true,
    })

    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })

    expect(service.getLoadDiagnostics()).toMatchObject({
      settingsState: 'ok',
      settingsMigrated: true,
      secretState: 'ok',
      legacyMigrationState: 'not-needed',
    })
  })

  it('retains the raw settings load error without exposing it publicly', () => {
    const { settingsStore, secretStore } = createStores()
    const loadError = new Error('invalid TOML at line 2')
    vi.mocked(settingsStore.load).mockReturnValue({
      state: 'recovery-required',
      value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
      message: 'settings corrupt',
      error: loadError,
    })

    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })

    expect(service.getLoadDiagnostics()).toMatchObject({
      settingsState: 'recovery-required',
      settingsMigrated: false,
      settingsMessage: 'settings corrupt',
      settingsError: loadError,
    })
    expect(service.getPublicSnapshot()).not.toHaveProperty('settingsError')
  })

  it('restores valid legacy credentials after backing up a corrupt new secret store', async () => {
    const settingsStore = new SettingsStore(join(root, 'settings.toml'))
    const secretsPath = join(root, 'secrets.enc')
    const secretStore = new SecretStore(secretsPath, availableCodec)
    await writeFile(legacyPath, validLegacyToml, 'utf-8')
    await writeFile(secretsPath, 'corrupt-envelope', 'utf-8')

    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    expect(service.getPublicSnapshot().health.state).toBe('recovery-required')
    expect(service.getCredentialRevision()).toBe(0)

    const snapshot = service.resetCorruptConfig()

    expect(snapshot.account).toMatchObject({
      username: 'legacy-user',
      hasPassword: true,
    })
    expect(service.getCredentials()).toEqual({
      username: 'legacy-user',
      password: 'legacy-password',
    })
    expect(service.getCredentialRevision()).toBe(1)
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores legacy settings without rewriting a healthy encrypted secret store', async () => {
    const settingsPath = join(root, 'settings.toml')
    const secretsPath = join(root, 'secrets.enc')
    const settingsStore = new SettingsStore(settingsPath)
    const secretStore = new SecretStore(secretsPath, availableCodec)
    secretStore.save({
      login: { username: 'keep-user', password: 'keep-password' },
      cookies: emptySecretPayload().cookies,
    })
    const secretBefore = await readFile(secretsPath)
    await writeFile(settingsPath, 'corrupt-settings', 'utf-8')
    await writeFile(legacyPath, validLegacyToml, 'utf-8')

    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    const snapshot = service.resetCorruptConfig()

    expect(snapshot.download).toEqual({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: '',
    })
    expect(snapshot.account).toMatchObject({ username: 'keep-user', hasPassword: true })
    await expect(readFile(secretsPath)).resolves.toEqual(secretBefore)
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries a transient migration write failure without backing up repaired data', async () => {
    const settingsPath = join(root, 'settings.toml')
    const secretsPath = join(root, 'secrets.enc')
    const backingSettingsStore = new SettingsStore(settingsPath)
    const backupCorrupt = vi.fn(() => backingSettingsStore.backupCorrupt())
    let failNextSave = true
    const settingsStore: SettingsStorePort = {
      load: () => backingSettingsStore.load(),
      initializeDefaults: () => backingSettingsStore.initializeDefaults(),
      save: vi.fn((next) => {
        if (failNextSave) {
          failNextSave = false
          throw new Error('disk full')
        }
        return backingSettingsStore.save(next)
      }),
      backupCorrupt,
    }
    const secretStore = new SecretStore(secretsPath, availableCodec)
    secretStore.save({
      login: { username: 'keep-user', password: 'keep-password' },
      cookies: emptySecretPayload().cookies,
    })
    await writeFile(settingsPath, 'corrupt-settings', 'utf-8')
    await writeFile(legacyPath, validLegacyToml, 'utf-8')

    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    expect(() => service.resetCorruptConfig()).toThrow('配置重置失败')
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(validLegacyToml)
    expect(backupCorrupt).toHaveBeenCalledTimes(1)

    const snapshot = service.resetCorruptConfig()

    expect(snapshot.download).toEqual({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: '',
    })
    expect(backupCorrupt).toHaveBeenCalledTimes(1)
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resets only damaged settings and preserves healthy credentials', () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'keep-user', password: 'keep-password' },
      cookies: emptySecretPayload().cookies,
    })
    vi.mocked(settingsStore.load).mockReturnValue({
      state: 'recovery-required',
      value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
      message: 'settings corrupt',
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    const result = service.resetCorruptConfig()

    expect(settingsStore.backupCorrupt).toHaveBeenCalledTimes(1)
    expect(settingsStore.initializeDefaults).toHaveBeenCalledTimes(1)
    expect(secretStore.backupCorrupt).not.toHaveBeenCalled()
    expect(secretStore.save).not.toHaveBeenCalled()
    expect(result.account).toMatchObject({ username: 'keep-user', hasPassword: true })
  })

  it('resets only damaged secrets and preserves healthy download settings', () => {
    const { settingsStore, secretStore } = createStores()
    const customDownload = {
      fullTitle: 'OUT' as const,
      defaultCoverIndex: 4,
      downloadPath: 'D:\\Books',
    }
    vi.mocked(settingsStore.load).mockReturnValue({
      state: 'ok',
      value: {
        download: customDownload,
        logging: { ...DEFAULT_LOG_CONFIG },
      },
    })
    vi.mocked(secretStore.load).mockReturnValue({
      state: 'recovery-required',
      value: emptySecretPayload(),
      message: 'secrets corrupt',
    })
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(settingsStore.initializeDefaults).mockClear()
    vi.mocked(settingsStore.save).mockClear()

    const result = service.resetCorruptConfig()

    expect(secretStore.backupCorrupt).toHaveBeenCalledTimes(1)
    expect(secretStore.save).toHaveBeenCalledTimes(1)
    expect(settingsStore.backupCorrupt).not.toHaveBeenCalled()
    expect(settingsStore.initializeDefaults).not.toHaveBeenCalled()
    expect(settingsStore.save).not.toHaveBeenCalled()
    expect(result.download).toEqual(customDownload)
  })

  it('recovers damaged settings while encryption remains unavailable', () => {
    const { settingsStore, secretStore } = createStores()
    vi.mocked(settingsStore.load).mockReturnValue({
      state: 'recovery-required',
      value: cloneSettings(DEFAULT_SETTINGS_CONFIG),
      message: 'settings corrupt',
    })
    vi.mocked(secretStore.load).mockReturnValue({
      state: 'encryption-unavailable',
      value: emptySecretPayload(),
      message: 'encryption unavailable',
    })
    vi.mocked(secretStore.isEncryptionAvailable).mockReturnValue(false)
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    vi.mocked(secretStore.save).mockClear()

    const result = service.resetCorruptConfig()

    expect(settingsStore.backupCorrupt).toHaveBeenCalledTimes(1)
    expect(settingsStore.initializeDefaults).toHaveBeenCalledTimes(1)
    expect(secretStore.backupCorrupt).not.toHaveBeenCalled()
    expect(secretStore.save).not.toHaveBeenCalled()
    expect(result.health.state).toBe('encryption-unavailable')
  })

  it('retries deleting verified plaintext without backing it up or resetting healthy stores', async () => {
    const { settingsStore, secretStore } = createStores({
      login: { username: 'keep-user', password: 'keep-password' },
      cookies: emptySecretPayload().cookies,
    })
    await mkdir(legacyPath)
    await writeFile(join(legacyPath, 'occupied'), 'blocked', 'utf-8')
    const service = ConfigService.load({ settingsStore, secretStore, legacyPath })
    expect(service.getPublicSnapshot().health.state).toBe('recovery-required')

    await rm(legacyPath, { recursive: true, force: true })
    await writeFile(legacyPath, 'verified plaintext', 'utf-8')
    vi.mocked(settingsStore.initializeDefaults).mockClear()
    vi.mocked(settingsStore.save).mockClear()
    vi.mocked(secretStore.save).mockClear()

    const result = service.resetCorruptConfig()

    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(settingsStore.backupCorrupt).not.toHaveBeenCalled()
    expect(secretStore.backupCorrupt).not.toHaveBeenCalled()
    expect(settingsStore.initializeDefaults).not.toHaveBeenCalled()
    expect(settingsStore.save).not.toHaveBeenCalled()
    expect(secretStore.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      account: { username: 'keep-user', hasPassword: true },
      health: { state: 'ok' },
    })
  })
})
