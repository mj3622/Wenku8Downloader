import { mkdtemp, readdir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(async (): Promise<Array<{ name: string; value: string }>> => []),
  setCookie: vi.fn(async (): Promise<void> => undefined),
  removeCookie: vi.fn(async (): Promise<void> => undefined),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => 'unused'),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(plainText, 'utf-8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
  },
  session: {
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

afterEach(() => {
  process.chdir(originalCwd)
  mocks.getCookies.mockReset()
  mocks.getCookies.mockResolvedValue([])
  mocks.setCookie.mockReset()
  mocks.setCookie.mockResolvedValue(undefined)
  mocks.removeCookie.mockReset()
  mocks.removeCookie.mockResolvedValue(undefined)
})

describe('createAppServices', () => {
  it('has no import-time filesystem side effects and initializes only after invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-app-services-'))
    process.chdir(root)

    try {
      const configDir = join(root, '.dev-user-data', 'config')
      const { createAppServices } = await import('./app-services')
      await expect(stat(configDir)).rejects.toThrow()

      createAppServices()

      expect((await readdir(configDir)).sort()).toEqual([
        'secrets.enc',
        'settings.toml',
      ])
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
      await initialization

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
})
