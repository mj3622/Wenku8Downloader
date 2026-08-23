import { resolve } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcBook, IpcServices } from './ipc-handlers'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    listeners,
    downloadsPath: process.cwd(),
    logsPath: `${process.cwd()}\\logs`,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener)
    }),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    mkdir: vi.fn(async () => undefined),
    setOnProgress: vi.fn(),
    downloadNovel: vi.fn(async () => undefined),
    downloadPictures: vi.fn(async () => undefined),
    downloaderConfigs: [] as unknown[],
    acquireCookie: vi.fn(async () => ({ loginCookies: {} })),
    configureLogger: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn((name: string) => name === 'downloads' ? mocks.downloadsPath : 'unused'),
  },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: { openExternal: mocks.openExternal, openPath: mocks.openPath },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}))

vi.mock('./logging/logger', () => ({
  configureLogger: mocks.configureLogger,
  getLogDirectory: () => mocks.logsPath,
  logger: mocks.logger,
}))

vi.mock('fs/promises', () => ({
  mkdir: mocks.mkdir,
}))

vi.mock('./cookie-service', () => ({
  CookieService: class {
    acquire = mocks.acquireCookie
  },
}))

vi.mock('./downloader', async (importOriginal) => {
  const original = await importOriginal<typeof import('./downloader')>()
  return {
    ...original,
    Downloader: class {
      constructor(_crawler: unknown, runtimeConfig: unknown) {
        mocks.downloaderConfigs.push(runtimeConfig)
      }

      setOnProgress = mocks.setOnProgress
      downloadNovel = mocks.downloadNovel
      downloadPictures = mocks.downloadPictures
    },
  }
})

import { registerIpcHandlers } from './ipc-handlers'

const booksPath = resolve('Books')

const publicSnapshot = {
  download: {
    fullTitle: 'FULL' as const,
    defaultCoverIndex: 0,
    downloadPath: '',
  },
  logging: {
    retentionDays: 30,
    maxFileSizeMb: 100,
    maxTotalSizeMb: 200,
  },
  account: {
    username: 'tester',
    hasPassword: true,
    hasCookies: true,
  },
  health: { state: 'ok' as const },
}

function createBookFixture() {
  return {
    bookId: '3057',
    baseChapterUrl: 'https://www.wenku8.net/novel/3/3057/',
    basicInfo: {
      '标题': '测试作品',
      '作者': '测试作者',
      '出版社': '',
      '最新章节': null,
      '连载状态': '',
      '更新时间': null,
      '全文长度': null,
      '简介': '',
      cover: null,
    },
    volumes: { '第一卷': [{ name: '第一章', link: '/chapter/1' }] },
    pictureUrls: { '第一卷': 'fixture' },
    getFormattedTitle: () => '测试作品',
    getChapterImageUrls: vi.fn(async () => ['https://example.com/1.jpg']),
    getCoverContent: vi.fn(async () => Buffer.from('cover')),
  } satisfies IpcBook
}

type BookFixture = ReturnType<typeof createBookFixture>

function createServices(
  bookPromise: Promise<BookFixture> = Promise.resolve(createBookFixture()),
): IpcServices {
  return {
    config: {
      getPublicSnapshot: vi.fn(() => structuredClone(publicSnapshot)),
      getDownloadSnapshot: vi.fn(() => ({ ...publicSnapshot.download })),
      getLogSnapshot: vi.fn(() => ({ ...publicSnapshot.logging })),
      updateDownload: vi.fn(() => structuredClone(publicSnapshot)),
      updateLogging: vi.fn(() => structuredClone(publicSnapshot)),
      updateCredentials: vi.fn(() => structuredClone(publicSnapshot)),
      resetCorruptConfig: vi.fn(() => structuredClone(publicSnapshot)),
      getCredentials: vi.fn(() => ({ username: 'tester', password: 'hidden' })),
      getCookies: vi.fn(() => ({
        PHPSESSID: 'hidden',
        jieqiUserInfo: '',
        jieqiVisitInfo: '',
        cf_clearance: '',
      })),
    },
    crawler: {
      syncCookies: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
      getCookie: vi.fn(async () => undefined),
      fetch: vi.fn(),
      getImageContent: vi.fn(async () => null),
    },
    books: {
      get: vi.fn(() => bookPromise),
      clear: vi.fn(),
    },
  } satisfies IpcServices
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler(...args)
}

let services: IpcServices

beforeEach(() => {
  mocks.handlers.clear()
  mocks.listeners.clear()
  mocks.downloaderConfigs.length = 0
  vi.clearAllMocks()
  services = createServices()
  registerIpcHandlers(services)
})

describe('registerIpcHandlers configuration boundary', () => {
  it('returns only the secret-free public snapshot', async () => {
    const result = await invoke('config:get', {})
    const serialized = JSON.stringify(result)

    expect(result).toEqual(publicSnapshot)
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('PHPSESSID')
    expect(serialized).not.toContain('hidden')
  })

  it('maps one download update to one validated service transaction', async () => {
    const input = {
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: booksPath,
    }

    await invoke('config:update-download', {}, input)

    expect(services.config.updateDownload).toHaveBeenCalledTimes(1)
    expect(services.config.updateDownload).toHaveBeenCalledWith(input)
  })

  it('persists logging settings before applying them to the active logger', async () => {
    const input = { retentionDays: 14, maxFileSizeMb: 64, maxTotalSizeMb: 256 }
    vi.mocked(services.config.updateLogging).mockReturnValue({
      ...structuredClone(publicSnapshot),
      logging: input,
    })

    await invoke('config:update-logging', {}, input)

    expect(services.config.updateLogging).toHaveBeenCalledWith(input)
    expect(mocks.configureLogger).toHaveBeenCalledWith(input)
    expect(vi.mocked(services.config.updateLogging).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.configureLogger.mock.invocationCallOrder[0])
  })

  it('rejects malformed configuration input before persistence', async () => {
    const invalidDownloads = [
      [],
      { fullTitle: 'INVALID', defaultCoverIndex: 0, downloadPath: '' },
      { fullTitle: 'FULL', defaultCoverIndex: -1, downloadPath: '' },
      { fullTitle: 'FULL', defaultCoverIndex: 0, downloadPath: '', extra: true },
    ]
    for (const input of invalidDownloads) {
      await expect(invoke('config:update-download', {}, input)).rejects.toThrow()
    }

    const invalidCredentials = [
      [],
      { username: 'next', password: 1 },
      { username: 'next', password: 'secret', extra: true },
    ]
    for (const input of invalidCredentials) {
      await expect(invoke('config:update-credentials', {}, input)).rejects.toThrow()
    }

    expect(services.config.updateDownload).not.toHaveBeenCalled()
    expect(services.config.updateCredentials).not.toHaveBeenCalled()
    expect(services.crawler.syncCookies).not.toHaveBeenCalled()
    expect(services.books.clear).not.toHaveBeenCalled()
  })

  it('persists credentials before synchronizing cookies and clearing books', async () => {
    const events: string[] = []
    vi.mocked(services.config.updateCredentials).mockImplementation(() => {
      events.push('persist')
      return structuredClone(publicSnapshot)
    })
    vi.mocked(services.crawler.syncCookies).mockImplementation(async () => {
      events.push('sync')
    })
    vi.mocked(services.books.clear).mockImplementation(() => {
      events.push('clear')
    })

    await invoke('config:update-credentials', {}, {
      username: 'tester',
      password: 'new-secret',
    })

    expect(events).toEqual(['persist', 'sync', 'clear'])
  })

  it('does not run credential side effects when persistence fails', async () => {
    vi.mocked(services.config.updateCredentials).mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(invoke('config:update-credentials', {}, {
      username: 'tester',
      password: 'new-secret',
    })).rejects.toThrow('disk full')

    expect(services.crawler.syncCookies).not.toHaveBeenCalled()
    expect(services.books.clear).not.toHaveBeenCalled()
  })

  it('reports a safe error when persisted credentials cannot synchronize', async () => {
    vi.mocked(services.crawler.syncCookies).mockRejectedValue(new Error('session failed'))

    await expect(invoke('config:update-credentials', {}, {
      username: 'tester',
      password: 'new-secret',
    })).rejects.toThrow('账号设置已保存，但 Cookie 同步失败')

    expect(services.config.updateCredentials).toHaveBeenCalledTimes(1)
    expect(services.books.clear).not.toHaveBeenCalled()
  })

  it('returns the latest canonical snapshot after credential synchronization', async () => {
    const persisted = structuredClone(publicSnapshot)
    const latest = {
      ...structuredClone(publicSnapshot),
      account: { ...publicSnapshot.account, username: 'newer-user' },
    }
    let releaseSync!: () => void
    vi.mocked(services.config.updateCredentials).mockReturnValue(persisted)
    vi.mocked(services.config.getPublicSnapshot).mockReturnValue(latest)
    vi.mocked(services.crawler.syncCookies).mockReturnValue(new Promise<void>((resolve) => {
      releaseSync = resolve
    }))

    const request = invoke('config:update-credentials', {}, {
      username: 'tester',
      password: 'new-secret',
    })
    await vi.waitFor(() => expect(services.crawler.syncCookies).toHaveBeenCalledTimes(1))
    releaseSync()

    await expect(request).resolves.toEqual(latest)
  })

  it('returns the latest canonical snapshot after reset synchronization', async () => {
    const persisted = structuredClone(publicSnapshot)
    const latest = {
      ...structuredClone(publicSnapshot),
      account: { ...publicSnapshot.account, username: 'restored-user' },
    }
    let releaseSync!: () => void
    vi.mocked(services.config.resetCorruptConfig).mockReturnValue(persisted)
    vi.mocked(services.config.getPublicSnapshot).mockReturnValue(latest)
    vi.mocked(services.crawler.syncCookies).mockReturnValue(new Promise<void>((resolve) => {
      releaseSync = resolve
    }))

    const request = invoke('config:reset-corrupt', {})
    await vi.waitFor(() => expect(services.crawler.syncCookies).toHaveBeenCalledTimes(1))
    releaseSync()

    await expect(request).resolves.toEqual(latest)
  })
})

describe('registerIpcHandlers application operations', () => {
  it('logs the selected folder path', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['D:\\Books'],
    })

    await expect(invoke('dialog:selectFolder', {})).resolves.toBe('D:\\Books')
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'dialog.select-folder.completed',
      expect.any(String),
      expect.objectContaining({
        canceled: false,
        folderPath: 'D:\\Books',
      }),
    )
  })

  it('logs when folder selection is canceled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })

    await expect(invoke('dialog:selectFolder', {})).resolves.toBeNull()
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'dialog.select-folder.completed',
      expect.any(String),
      expect.objectContaining({ canceled: true }),
    )
  })

  it('opens only the main-process log directory', async () => {
    await invoke('logs:open-directory', {}, 'D:\\attacker-controlled')

    expect(mocks.mkdir).toHaveBeenCalledWith(mocks.logsPath, { recursive: true })
    expect(mocks.openPath).toHaveBeenCalledWith(mocks.logsPath)
    expect(mocks.openPath).not.toHaveBeenCalledWith('D:\\attacker-controlled')
  })

  it('logs failed operations with safe context and duration', async () => {
    vi.mocked(services.crawler.search).mockRejectedValueOnce(new Error('HTTP 503'))

    await expect(invoke('search:title', {}, { query: '败犬女主' })).rejects.toThrow('HTTP 503')

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'search.title.failed',
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({
        query: '败犬女主',
        operationId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    )
  })

  it('accepts renderer error reports through a one-way channel', () => {
    const listener = mocks.listeners.get('log:renderer-error')
    expect(listener).toBeDefined()

    listener?.(
      { sender: { id: 7 } },
      { kind: 'error', message: 'render failed', source: 'file:///app.js' },
    )

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'renderer.error',
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ senderId: 7, source: 'file:///app.js' }),
      'renderer',
    )
  })

  it('rejects invalid payloads before external side effects', async () => {
    await expect(invoke('search:title', {}, { query: '' })).rejects.toThrow('搜索内容长度')
    await expect(invoke('book:get', {}, { bookId: '../3057' })).rejects.toThrow('作品编号')
    await expect(invoke('download:epub', {}, { bookId: 'not-a-book' })).rejects.toThrow('作品编号')
    await expect(invoke('shell:openExternal', {}, 'http://wenku8.net')).rejects.toThrow('允许范围')
    await expect(invoke('shell:openFolder', {}, '../config')).rejects.toThrow('下载文件夹')

    expect(services.crawler.search).not.toHaveBeenCalled()
    expect(services.books.get).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(mocks.downloadNovel).not.toHaveBeenCalled()
  })

  it.each([
    ['download:epub', null, 'download.novel.failed'],
    ['download:images', { bookId: '3057', taskId: 'invalid-task' }, 'download.pictures.failed'],
  ] as const)('logs malformed download payloads for %s without starting work', async (
    channel,
    payload,
    failedEvent,
  ) => {
    await expect(invoke(channel, { sender: { send: vi.fn() } }, payload)).rejects.toThrow()

    expect(mocks.logger.error).toHaveBeenCalledWith(
      failedEvent,
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({
        operationId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    )
    expect(mocks.downloadNovel).not.toHaveBeenCalled()
    expect(mocks.downloadPictures).not.toHaveBeenCalled()
  })

  it('passes a stable runtime snapshot and task progress into downloads', async () => {
    const send = vi.fn()

    await invoke(
      'download:epub',
      { sender: { send } },
      { bookId: '3057', volumeName: '第一卷', taskId: 'dl-123-1' },
    )

    expect(mocks.downloaderConfigs).toEqual([{
      ...publicSnapshot.download,
      rootPath: resolve(mocks.downloadsPath, 'Wenku8Downloader'),
    }])
    expect(mocks.downloadNovel).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: '3057' }),
      '第一卷',
    )
    const onProgress = mocks.setOnProgress.mock.calls[0]?.[0] as (
      progress: { current: number; total: number; phase: string }
    ) => void
    onProgress({ current: 1, total: 2, phase: '正在下载' })
    expect(send).toHaveBeenCalledWith('download:progress', {
      taskId: 'dl-123-1',
      current: 1,
      total: 2,
      phase: '正在下载',
    })
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'download.novel.started',
      expect.any(String),
      expect.objectContaining({
        taskId: 'dl-123-1',
        operationId: 'dl-123-1',
        bookId: '3057',
        volumeName: '第一卷',
      }),
    )
  })

  it.each([
    ['download:epub', mocks.downloadNovel],
    ['download:images', mocks.downloadPictures],
  ] as const)('captures the runtime root before awaiting book loading for %s', async (
    channel,
    download,
  ) => {
    const rootA = resolve('download-root-a')
    const rootB = resolve('download-root-b')
    let activeRoot = rootA
    let releaseBook!: (book: BookFixture) => void
    const pendingBook = new Promise<BookFixture>((resolveBook) => {
      releaseBook = resolveBook
    })

    mocks.handlers.clear()
    services = createServices(pendingBook)
    registerIpcHandlers(services)
    vi.mocked(services.config.getDownloadSnapshot).mockImplementation(() => ({
      ...publicSnapshot.download,
      downloadPath: activeRoot,
    }))

    const request = invoke(channel, { sender: { send: vi.fn() } }, {
      bookId: '3057',
      volumeName: '第一卷',
      taskId: 'dl-123-1',
    })
    await vi.waitFor(() => {
      expect(services.config.getDownloadSnapshot).toHaveBeenCalledTimes(1)
    })
    activeRoot = rootB
    releaseBook(createBookFixture())
    await request

    expect(download).toHaveBeenCalledTimes(1)
    expect(mocks.downloaderConfigs[0]).toMatchObject({ rootPath: rootA })
  })

  it('opens only whitelisted external URLs and current download folders', async () => {
    await invoke('shell:openExternal', {}, 'https://wenku8.net')
    await invoke('shell:openFolder', {}, 'novels')

    expect(mocks.openExternal).toHaveBeenCalledWith('https://wenku8.net/')
    expect(mocks.openPath).toHaveBeenCalledWith(
      resolve(mocks.downloadsPath, 'Wenku8Downloader', 'novels'),
    )
  })

  it('creates and opens the current download root', async () => {
    const downloadRoot = resolve(mocks.downloadsPath, 'Wenku8Downloader')

    await invoke('shell:openFolder', {}, 'root')

    expect(mocks.mkdir).toHaveBeenCalledWith(downloadRoot, { recursive: true })
    expect(mocks.openPath).toHaveBeenCalledWith(downloadRoot)
  })

  it('invalidates cached books after automatic Cookie refresh', async () => {
    await invoke('cookie:auto', { sender: { send: vi.fn() } })

    expect(mocks.acquireCookie).toHaveBeenCalledTimes(1)
    expect(services.books.clear).toHaveBeenCalledTimes(1)
  })
})
