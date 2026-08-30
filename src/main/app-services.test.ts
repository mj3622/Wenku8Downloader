import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(async (): Promise<Array<{ name: string; value: string }>> => []),
  setCookie: vi.fn(async (): Promise<void> => undefined),
  removeCookie: vi.fn(async (): Promise<void> => undefined),
  sessionFetch: vi.fn(),
  fromPartition: vi.fn(),
  configureLogger: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('./logging/logger', () => ({
  configureLogger: mocks.configureLogger,
  logger: { info: mocks.logInfo, error: mocks.logError },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => 'unused'),
  },
  session: {
    fromPartition: mocks.fromPartition,
    defaultSession: {
      cookies: {
        get: mocks.getCookies,
        set: mocks.setCookie,
        remove: mocks.removeCookie,
      },
    },
  },
  net: { fetch: vi.fn() },
}))

const originalCwd = process.cwd()

beforeEach(() => {
  mocks.fromPartition.mockReturnValue({
    cookies: {
      get: mocks.getCookies,
      set: mocks.setCookie,
      remove: mocks.removeCookie,
    },
    fetch: mocks.sessionFetch,
  })
})

afterEach(() => {
  process.chdir(originalCwd)
  mocks.getCookies.mockReset()
  mocks.getCookies.mockResolvedValue([])
  mocks.setCookie.mockReset()
  mocks.setCookie.mockResolvedValue(undefined)
  mocks.removeCookie.mockReset()
  mocks.removeCookie.mockResolvedValue(undefined)
  mocks.sessionFetch.mockReset()
  mocks.fromPartition.mockReset()
  mocks.configureLogger.mockReset()
  mocks.logInfo.mockReset()
  mocks.logError.mockReset()
})

describe('createAppServices', () => {
  it('has no import-time filesystem side effects and initializes only after invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-app-services-'))
    process.chdir(root)

    try {
      const configDir = join(root, '.dev-user-data', 'config')
      const taskStatePath = join(root, '.dev-user-data', 'state', 'download-tasks.json')
      const { createAppServices } = await import('./app-services')
      await expect(stat(configDir)).rejects.toThrow()

      const services = createAppServices()

      expect(services.discovery).toEqual(expect.objectContaining({
        getHome: expect.any(Function),
        getRanking: expect.any(Function),
        clearMemory: expect.any(Function),
      }))
      expect(services.bookshelf).toEqual(expect.objectContaining({
        getPage: expect.any(Function),
        addBook: expect.any(Function),
        clearMemory: expect.any(Function),
      }))
      expect(mocks.fromPartition).toHaveBeenCalledWith('wenku8')
      expect(services.networkSession).toBe(mocks.fromPartition.mock.results[0]?.value)

      expect((await readdir(configDir)).sort()).toEqual([
        'secrets.enc',
        'settings.toml',
      ])
      await expect(readFile(join(configDir, 'secrets.enc'), 'utf-8')).resolves.toContain(
        '"cipher": "local-aes-256-gcm-v1"',
      )
      await expect(stat(taskStatePath)).rejects.toThrow()
    } finally {
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for the persisted Cookie snapshot to replace the session before resolving', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-app-services-'))
    process.chdir(root)
    let releaseFirstRemoval!: () => void
    mocks.removeCookie.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseFirstRemoval = resolve
    }))

    try {
      const { initializeAppServices } = await import('./app-services')
      let initialized = false
      const initialization = initializeAppServices().then((services) => {
        initialized = true
        return services
      })

      await vi.waitFor(() => expect(mocks.removeCookie).toHaveBeenCalledTimes(1))
      expect(initialized).toBe(false)

      releaseFirstRemoval()
      const services = await initialization

      await expect(stat(join(
        root,
        '.dev-user-data',
        'state',
        'download-tasks.json',
      ))).resolves.toBeDefined()
      expect(mocks.configureLogger).toHaveBeenCalledWith(services.config.getLogSnapshot())
      expect(mocks.configureLogger.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.removeCookie.mock.invocationCallOrder[0])

      expect(mocks.removeCookie.mock.calls).toEqual([
        ['https://www.wenku8.net', 'PHPSESSID'],
        ['https://www.wenku8.net', 'jieqiUserInfo'],
        ['https://www.wenku8.net', 'jieqiVisitInfo'],
        ['https://www.wenku8.net', 'cf_clearance'],
      ])
      expect(mocks.setCookie).not.toHaveBeenCalled()
    } finally {
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records settings schema migration after the configured logger is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-app-services-'))
    process.chdir(root)
    const configDir = join(root, '.dev-user-data', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'settings.toml'),
      '[download]\nfull_title = "OUT"\ndefault_cover_index = "3"\ndownload_path = ""\n',
      'utf-8',
    )

    try {
      const { initializeAppServices } = await import('./app-services')
      await initializeAppServices()

      expect(mocks.logInfo).toHaveBeenCalledWith(
        'config.settings-migrated',
        expect.any(String),
        expect.objectContaining({ settingsState: 'ok' }),
      )
      expect(mocks.configureLogger.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.logInfo.mock.invocationCallOrder[0])
    } finally {
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records the original settings parse error without blocking startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-app-services-'))
    process.chdir(root)
    const configDir = join(root, '.dev-user-data', 'config')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'settings.toml'), '[download\ninvalid', 'utf-8')

    try {
      const { initializeAppServices } = await import('./app-services')

      await expect(initializeAppServices()).resolves.toBeDefined()
      expect(mocks.logError).toHaveBeenCalledWith(
        'config.settings-load-failed',
        expect.any(String),
        expect.any(Error),
        expect.objectContaining({ settingsState: 'recovery-required' }),
      )
    } finally {
      process.chdir(originalCwd)
      await rm(root, { recursive: true, force: true })
    }
  })
})
