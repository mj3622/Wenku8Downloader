import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { parse } from 'smol-toml'
import {
  DEFAULT_DOWNLOAD_CONFIG,
  DEFAULT_LOG_CONFIG,
  DEFAULT_SETTINGS_CONFIG,
} from './config-schema'
import { SettingsStore } from './settings-store'

let root: string
let settingsPath: string
const booksPath = resolve('Books')

describe('SettingsStore', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-settings-'))
    settingsPath = join(root, 'settings.toml')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('does not create a missing file until defaults are initialized', async () => {
    const store = new SettingsStore(settingsPath)

    expect(store.load()).toEqual({ state: 'missing', value: DEFAULT_SETTINGS_CONFIG })
    await expect(stat(settingsPath)).rejects.toMatchObject({ code: 'ENOENT' })

    expect(store.initializeDefaults()).toEqual(DEFAULT_SETTINGS_CONFIG)
    expect(parse(await readFile(settingsPath, 'utf-8'))).toMatchObject({ config_version: 2 })
  })

  it('persists logging settings without changing download settings', () => {
    const store = new SettingsStore(settingsPath)
    const saved = store.save({
      download: { ...DEFAULT_DOWNLOAD_CONFIG },
      logging: { retentionDays: 14, maxFileSizeMb: 64, maxTotalSizeMb: 256 },
    })

    expect(saved.logging).toEqual({
      retentionDays: 14,
      maxFileSizeMb: 64,
      maxTotalSizeMb: 256,
    })
    expect(saved.download).toEqual(DEFAULT_DOWNLOAD_CONFIG)
    expect(store.load()).toEqual({ state: 'ok', value: saved })
    expect(saved.logging).not.toEqual(DEFAULT_LOG_CONFIG)
  })

  it('preserves malformed TOML byte-for-byte', async () => {
    const malformed = '[download\nfull_title = "FULL"'
    await writeFile(settingsPath, malformed, 'utf-8')

    const result = new SettingsStore(settingsPath).load()

    expect(result.state).toBe('recovery-required')
    expect(result).toMatchObject({ error: expect.any(Error) })
    await expect(readFile(settingsPath, 'utf-8')).resolves.toBe(malformed)
  })

  it('migrates a v0 document atomically', async () => {
    await writeFile(
      settingsPath,
      '[download]\nfull_title = "OUT"\ndefault_cover_index = "3"\ndownload_path = ""\n',
      'utf-8',
    )

    const result = new SettingsStore(settingsPath).load()

    expect(result).toEqual({
      state: 'ok',
      migrated: true,
      value: {
        download: { fullTitle: 'OUT', defaultCoverIndex: 3, downloadPath: '' },
        logging: DEFAULT_LOG_CONFIG,
      },
    })
    expect(parse(await readFile(settingsPath, 'utf-8'))).toMatchObject({
      config_version: 2,
      download: { default_cover_index: 3 },
      logging: {
        retention_days: 30,
        max_file_size_mb: 100,
        max_total_size_mb: 200,
      },
    })
  })

  it('preserves unknown v1 fields during a valid update', async () => {
    await writeFile(
      settingsPath,
      'config_version = 1\nfuture = "keep"\n\n[download]\nfull_title = "FULL"\ndefault_cover_index = 0\ndownload_path = ""\nfuture_option = "keep-me"\n',
      'utf-8',
    )
    const store = new SettingsStore(settingsPath)
    const loaded = store.load()
    expect(loaded.state).toBe('ok')

    store.save({
      download: { fullTitle: 'IN', defaultCoverIndex: 2, downloadPath: booksPath },
      logging: { ...DEFAULT_LOG_CONFIG },
    })

    expect(parse(await readFile(settingsPath, 'utf-8'))).toMatchObject({
      future: 'keep',
      download: {
        full_title: 'IN',
        default_cover_index: 2,
        download_path: booksPath,
        future_option: 'keep-me',
      },
    })
  })

  it('does not overwrite a document from a newer version', async () => {
    const future = 'config_version = 99\n[download]\nfuture = true\n'
    await writeFile(settingsPath, future, 'utf-8')
    const store = new SettingsStore(settingsPath)

    expect(store.load().state).toBe('read-only-newer-version')
    expect(() => store.save(DEFAULT_SETTINGS_CONFIG)).toThrow('更新版本')
    await expect(readFile(settingsPath, 'utf-8')).resolves.toBe(future)
  })
})
