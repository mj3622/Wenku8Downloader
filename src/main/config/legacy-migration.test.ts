import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import type { SecretCodec } from './secret-codec'
import { SecretStore } from './secret-store'
import { SettingsStore } from './settings-store'
import { migrateLegacyConfig } from './legacy-migration'

const availableCodec: SecretCodec = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`encrypted:${Buffer.from(plain).toString('base64')}`),
  decrypt: (encrypted) => Buffer.from(
    encrypted.toString().slice('encrypted:'.length),
    'base64',
  ).toString('utf-8'),
}

const unavailableCodec: SecretCodec = {
  isAvailable: () => false,
  encrypt: () => { throw new Error('unavailable') },
  decrypt: () => { throw new Error('unavailable') },
}

const booksPath = resolve('Books')
const tomlBooksPath = booksPath.replaceAll('\\', '\\\\')

const legacyToml = [
  '[download]',
  'full_title = "OUT"',
  'default_cover_index = "2"',
  `download_path = "${tomlBooksPath}"`,
  'future_non_sensitive = "preserve-me"',
  '',
  '[login]',
  'username = "legacy-user"',
  'password = "legacy-password-sentinel"',
  '',
  '[cookie]',
  'PHPSESSID = "legacy-cookie-sentinel"',
  'jieqiUserInfo = "user-info"',
  'jieqiVisitInfo = "visit-info"',
  'cf_clearance = "clearance"',
  '',
].join('\n')

let root: string
let legacyPath: string
let settingsPath: string
let secretsPath: string

describe('migrateLegacyConfig', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-legacy-config-'))
    legacyPath = join(root, 'secrets.toml')
    settingsPath = join(root, 'settings.toml')
    secretsPath = join(root, 'secrets.enc')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('migrates and verifies valid legacy settings and secrets', async () => {
    await writeFile(legacyPath, legacyToml, 'utf-8')
    const settingsStore = new SettingsStore(settingsPath)
    const secretStore = new SecretStore(secretsPath, availableCodec)

    expect(migrateLegacyConfig({ legacyPath, settingsStore, secretStore })).toEqual({
      state: 'migrated',
    })

    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const settingsRaw = await readFile(settingsPath, 'utf-8')
    expect(settingsRaw).toContain('future_non_sensitive = "preserve-me"')
    expect(settingsRaw).not.toContain('legacy-password-sentinel')
    expect(settingsRaw).not.toContain('legacy-cookie-sentinel')
    expect(settingsStore.load()).toMatchObject({
      state: 'ok',
      value: { fullTitle: 'OUT', defaultCoverIndex: 2, downloadPath: booksPath },
    })
    expect(secretStore.load()).toMatchObject({
      state: 'ok',
      value: {
        login: { username: 'legacy-user', password: 'legacy-password-sentinel' },
        cookies: { PHPSESSID: 'legacy-cookie-sentinel' },
      },
    })
  })

  it('retries safely when settings exist but encrypted secrets are missing', async () => {
    await writeFile(legacyPath, legacyToml, 'utf-8')
    const settingsStore = new SettingsStore(settingsPath)
    settingsStore.initializeDefaults()
    settingsStore.save({ fullTitle: 'IN', defaultCoverIndex: 4, downloadPath: '' })
    const secretStore = new SecretStore(secretsPath, availableCodec)

    expect(migrateLegacyConfig({ legacyPath, settingsStore, secretStore }).state).toBe('migrated')
    expect(settingsStore.load()).toMatchObject({
      value: { fullTitle: 'IN', defaultCoverIndex: 4, downloadPath: '' },
    })
    expect(secretStore.load()).toMatchObject({
      value: { login: { username: 'legacy-user' } },
    })
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves malformed legacy TOML byte-for-byte unchanged', async () => {
    const malformed = '[login\nusername = "recover-me"'
    await writeFile(legacyPath, malformed, 'utf-8')

    const result = migrateLegacyConfig({
      legacyPath,
      settingsStore: new SettingsStore(settingsPath),
      secretStore: new SecretStore(secretsPath, availableCodec),
    })

    expect(result).toMatchObject({
      state: 'recovery-required',
      reason: 'legacy-invalid',
    })
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(malformed)
    await expect(stat(settingsPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('loads non-sensitive settings but preserves plaintext secrets when encryption is unavailable', async () => {
    await writeFile(legacyPath, legacyToml, 'utf-8')

    const result = migrateLegacyConfig({
      legacyPath,
      settingsStore: new SettingsStore(settingsPath),
      secretStore: new SecretStore(secretsPath, unavailableCodec),
    })

    expect(result.state).toBe('encryption-unavailable')
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(legacyToml)
    expect(new SettingsStore(settingsPath).load()).toMatchObject({
      state: 'ok',
      value: { fullTitle: 'OUT', defaultCoverIndex: 2, downloadPath: booksPath },
    })
    await expect(stat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not overwrite a newer settings document', async () => {
    const futureSettings = 'config_version = 99\n[download]\nfuture = true\n'
    await writeFile(settingsPath, futureSettings, 'utf-8')
    await writeFile(legacyPath, legacyToml, 'utf-8')

    const result = migrateLegacyConfig({
      legacyPath,
      settingsStore: new SettingsStore(settingsPath),
      secretStore: new SecretStore(secretsPath, availableCodec),
    })

    expect(result.state).toBe('read-only-newer-version')
    await expect(readFile(settingsPath, 'utf-8')).resolves.toBe(futureSettings)
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(legacyToml)
  })

  it('identifies a corrupt new store without consuming valid legacy data', async () => {
    await writeFile(settingsPath, 'corrupt-settings', 'utf-8')
    await writeFile(legacyPath, legacyToml, 'utf-8')

    const result = migrateLegacyConfig({
      legacyPath,
      settingsStore: new SettingsStore(settingsPath),
      secretStore: new SecretStore(secretsPath, availableCodec),
    })

    expect(result).toMatchObject({
      state: 'recovery-required',
      reason: 'new-store-invalid',
    })
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(legacyToml)
  })

  it('identifies persistence failures and preserves valid legacy data', async () => {
    await writeFile(legacyPath, legacyToml, 'utf-8')
    const settingsStore = new SettingsStore(settingsPath)
    const result = migrateLegacyConfig({
      legacyPath,
      settingsStore: {
        load: () => settingsStore.load(),
        save: () => { throw new Error('disk full') },
      },
      secretStore: new SecretStore(secretsPath, availableCodec),
    })

    expect(result).toMatchObject({
      state: 'recovery-required',
      reason: 'write-failed',
    })
    await expect(readFile(legacyPath, 'utf-8')).resolves.toBe(legacyToml)
  })

  it('removes a stale legacy file only after both new stores verify', async () => {
    const settingsStore = new SettingsStore(settingsPath)
    settingsStore.initializeDefaults()
    const secretStore = new SecretStore(secretsPath, availableCodec)
    secretStore.save({
      login: { username: 'new-user', password: 'new-password' },
      cookies: { PHPSESSID: '', jieqiUserInfo: '', jieqiVisitInfo: '', cf_clearance: '' },
    })
    await writeFile(legacyPath, legacyToml, 'utf-8')

    expect(migrateLegacyConfig({ legacyPath, settingsStore, secretStore }).state).toBe('migrated')
    expect(secretStore.load()).toMatchObject({ value: { login: { username: 'new-user' } } })
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a retryable cleanup state when verified plaintext cannot be removed', async () => {
    const settingsStore = new SettingsStore(settingsPath)
    settingsStore.initializeDefaults()
    const secretStore = new SecretStore(secretsPath, availableCodec)
    secretStore.save({
      login: { username: 'new-user', password: 'new-password' },
      cookies: { PHPSESSID: '', jieqiUserInfo: '', jieqiVisitInfo: '', cf_clearance: '' },
    })
    await mkdir(legacyPath)

    expect(migrateLegacyConfig({ legacyPath, settingsStore, secretStore })).toMatchObject({
      state: 'cleanup-required',
    })
    expect((await stat(legacyPath)).isDirectory()).toBe(true)
  })
})
