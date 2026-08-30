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
    packaged: true,
    logsPath: `${process.cwd()}\\logs`,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener)
    }),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(() => undefined),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    mkdir: vi.fn(async () => undefined),
    browserWindows: [] as Array<{
      isDestroyed: () => boolean
      webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
    }>,
    downloadSubscriber: undefined as ((event: unknown) => void) | undefined,
    getDownloadSnapshot: vi.fn(() => ({
      revision: 1,
      tasks: [],
      legacyImportCompleted: false,
    })),
    enqueueDownload: vi.fn(),
    enqueueDownloadBatch: vi.fn(),
    cancelDownload: vi.fn(),
    cancelDownloadBatch: vi.fn(),
    retryDownload: vi.fn(),
    retryDownloadBatch: vi.fn(),
    removeDownload: vi.fn(),
    clearDownloadHistory: vi.fn(),
    importLegacyDownloadHistory: vi.fn(),
    getArtifactTarget: vi.fn(async () => ({
      path: resolve(process.cwd(), 'downloads', 'book.epub'),
      kind: 'file' as 'file' | 'directory',
    })),
    resolveVolumeCovers: vi.fn(async () => ({
      '第一卷': 'https://example.com/volume-1.jpg',
    })),
    subscribeDownloads: vi.fn((listener: (event: unknown) => void) => {
      mocks.downloadSubscriber = listener
      return vi.fn()
    }),
    acquireCookie: vi.fn(async (
      _onProgress?: (progress: { step: string; message: string }) => void,
    ) => ({ loginCookies: {} })),
    configureLogger: vi.fn(),
    getLogStats: vi.fn(() => ({ totalSizeBytes: 2048 })),
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
    get isPackaged() { return mocks.packaged },
    getVersion: vi.fn(() => '2.1.0'),
    getPath: vi.fn((name: string) => name === 'downloads' ? mocks.downloadsPath : 'unused'),
  },
  BrowserWindow: { getAllWindows: () => mocks.browserWindows },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: {
    openExternal: mocks.openExternal,
    openPath: mocks.openPath,
    showItemInFolder: mocks.showItemInFolder,
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}))

vi.mock('./logging/logger', () => ({
  configureLogger: mocks.configureLogger,
  getLogDirectory: () => mocks.logsPath,
  getLogStats: mocks.getLogStats,
  logger: mocks.logger,
}))

vi.mock('fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs/promises')>(),
  mkdir: mocks.mkdir,
}))

vi.mock('./cookie-service', () => ({
  CookieService: class {
    acquire = mocks.acquireCookie
  },
}))

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
    generationKey: 'a'.repeat(64),
    legacyImportGenerationKey: 'a'.repeat(64),
    baseChapterUrl: 'https://www.wenku8.net/novel/3/3057/',
    versionFields: { updatedAt: '', latestChapter: '', status: '' },
    basicInfo: {
      '标题': '测试作品',
      '作者': '测试作者',
      '出版社': '',
      '最新章节': null,
      '连载状态': '',
      '更新时间': null,
      '全文长度': null,
      '简介': '',
      '标签': [],
      '动画化': false,
      '热度': null,
      cover: null,
    },
    volumes: { '第一卷': [{ name: '第一章', link: '/chapter/1' }] },
    pictureUrls: { '第一卷': 'fixture' },
    getFormattedTitle: () => '测试作品',
    getChapterImageUrls: vi.fn(async () => ['https://example.com/1.jpg']),
    getCoverContent: vi.fn(async () => Buffer.from('cover')),
  } satisfies IpcBook
}

function createServices(
  bookPromise: Promise<IpcBook> = Promise.resolve(createBookFixture()),
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
      getCookie: vi.fn(async () => undefined),
      fetch: vi.fn(),
      getImageContent: vi.fn(async () => null),
    },
    search: {
      search: vi.fn(async () => ({
        status: 'ok' as const,
        results: [],
        fetchedAt: 1,
        cached: false,
      })),
    },
    catalog: {
      getPage: vi.fn(async query => ({
        query, books: [], page: query.page, totalPages: 1, fetchedAt: 1, stale: false,
      })),
    },
    discovery: {
      getHome: vi.fn(async () => ({
        sections: [], fetchedAt: 1, stale: false,
      })),
      getRanking: vi.fn(async (type, page) => ({
        type, page, title: '排行榜', totalPages: 1, books: [], fetchedAt: 1, stale: false,
      })),
      getAnnualRanking: vi.fn(async year => ({
        year,
        categories: { bunko: [], tankobon: [] },
        fetchedAt: 1,
        stale: false,
      })),
    },
    bookshelf: {
      getPage: vi.fn(async () => ({ entries: [], fetchedAt: 1, stale: false })),
      addBook: vi.fn(async () => ({ entries: [], fetchedAt: 1, stale: false })),
    },
    updates: {
      check: vi.fn(async () => ({
        currentVersion: '2.1.0',
        latestVersion: '2.1.0',
        updateAvailable: false,
        releaseUrl: 'https://github.com/mj3622/Wenku8Downloader/releases/tag/v2.1.0',
        checkedAt: 1,
      })),
    },
    books: {
      get: vi.fn(() => bookPromise),
    },
    clearCache: vi.fn(async () => ({ deferred: false })),
    invalidateBookCache: vi.fn(async () => undefined),
    resolveVolumeCovers: mocks.resolveVolumeCovers,
    downloads: {
      getSnapshot: mocks.getDownloadSnapshot,
      enqueue: mocks.enqueueDownload,
      enqueueBatch: mocks.enqueueDownloadBatch,
      cancel: mocks.cancelDownload,
      cancelBatch: mocks.cancelDownloadBatch,
      retry: mocks.retryDownload,
      retryBatch: mocks.retryDownloadBatch,
      remove: mocks.removeDownload,
      clearHistory: mocks.clearDownloadHistory,
      importLegacyHistory: mocks.importLegacyDownloadHistory,
      getArtifactTarget: mocks.getArtifactTarget,
      subscribe: mocks.subscribeDownloads,
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
  mocks.browserWindows.length = 0
  mocks.downloadSubscriber = undefined
  mocks.packaged = true
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
    expect(services.invalidateBookCache).not.toHaveBeenCalled()
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
    vi.mocked(services.invalidateBookCache).mockImplementation(async () => {
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
    expect(services.invalidateBookCache).not.toHaveBeenCalled()
  })

  it('reports a safe error when persisted credentials cannot synchronize', async () => {
    vi.mocked(services.crawler.syncCookies).mockRejectedValue(new Error('session failed'))

    await expect(invoke('config:update-credentials', {}, {
      username: 'tester',
      password: 'new-secret',
    })).rejects.toThrow('账号设置已保存，但登录状态同步失败')

    expect(services.config.updateCredentials).toHaveBeenCalledTimes(1)
    expect(services.invalidateBookCache).not.toHaveBeenCalled()
  })

  it('explains that credentials were cleared when stale login cleanup fails', async () => {
    vi.mocked(services.crawler.syncCookies).mockRejectedValue(new Error('session cleanup failed'))

    await expect(invoke('config:update-credentials', {}, {
      username: '',
      password: '',
    })).rejects.toThrow('登录信息已清除，但旧登录状态清理未完成，请重启应用')

    expect(services.config.updateCredentials).toHaveBeenCalledWith({
      username: '',
      password: '',
    })
    expect(services.invalidateBookCache).not.toHaveBeenCalled()
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

  it('returns log statistics without logging the read itself', async () => {
    await expect(invoke('logs:get-stats', {})).resolves.toEqual({ totalSizeBytes: 2048 })

    expect(mocks.getLogStats).toHaveBeenCalledTimes(1)
    expect(mocks.logger.info).not.toHaveBeenCalled()
  })

  it('validates and resolves selected volume covers through the main process', async () => {
    await expect(invoke('book:volume-covers', {}, {
      bookId: '3057',
      volumes: ['第一卷', '第一卷'],
    })).resolves.toEqual({
      covers: { '第一卷': 'https://example.com/volume-1.jpg' },
    })

    expect(mocks.resolveVolumeCovers).toHaveBeenCalledWith('3057', ['第一卷'])
    await expect(invoke('book:volume-covers', {}, {
      bookId: '3057',
      volumes: [],
    })).rejects.toThrow('分卷列表')
  })

  it('logs failed operations with safe context and duration', async () => {
    vi.mocked(services.search.search).mockRejectedValueOnce(new Error('HTTP 503'))

    await expect(invoke('search:title', {}, { query: '败犬女主' })).rejects.toThrow('HTTP 503')

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'search.title.failed',
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({
        operationId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    )
    expect(mocks.logger.error.mock.calls.at(-1)?.[3]).not.toHaveProperty('query')
  })

  it('forwards validated searches to the search service', async () => {
    vi.mocked(services.search.search).mockResolvedValueOnce({
      status: 'cooldown',
      retryAt: 12_000,
    })

    await expect(invoke('search:author', {}, { query: ' 雨森焚火 ' })).resolves.toEqual({
      status: 'cooldown',
      retryAt: 12_000,
    })
    expect(services.search.search).toHaveBeenCalledWith('author', '雨森焚火')
  })

  it('validates and forwards explicit book revalidation', async () => {
    await invoke('book:get', {}, { bookId: '3057', revalidate: true })

    expect(services.books.get).toHaveBeenCalledWith('3057', { revalidate: true })
    await expect(invoke('book:get', {}, {
      bookId: '3057', revalidate: 'yes',
    })).rejects.toThrow('请求参数格式无效')
    await expect(invoke('book:get', {}, {
      bookId: '3057', revalidate: true, path: '/tmp',
    })).rejects.toThrow('请求参数格式无效')
  })

  it('validates and forwards discovery requests', async () => {
    await invoke('discovery:get-home', {}, { refresh: true })
    await invoke('discovery:get-ranking', {}, {
      type: 'monthvisit', page: 3, refresh: false,
    })
    await invoke('discovery:get-annual-ranking', {}, { year: 2026, refresh: true })

    expect(services.discovery.getHome).toHaveBeenCalledWith({ refresh: true })
    expect(services.discovery.getRanking).toHaveBeenCalledWith(
      'monthvisit',
      3,
      { refresh: false },
    )
    expect(services.discovery.getAnnualRanking).toHaveBeenCalledWith(2026, { refresh: true })
    await expect(invoke('discovery:get-ranking', {}, {
      type: 'arbitrary', page: 1,
    })).rejects.toThrow('榜单类型')
    await expect(invoke('discovery:get-annual-ranking', {}, { year: 2027 }))
      .rejects.toThrow('年度榜单')
  })

  it('returns the Electron app version and validates manual update checks', async () => {
    mocks.packaged = false
    await expect(invoke('app:get-info', {})).resolves.toEqual({ version: '2.1.0' })
    mocks.packaged = true
    await expect(invoke('app:get-info', {})).resolves.toEqual({ version: '2.1.0' })
    await invoke('app:check-update', {}, { refresh: true })
    expect(services.updates.check).toHaveBeenCalledWith({ refresh: true })
    await expect(invoke('app:check-update', {}, { refresh: true, url: 'https://example.com' }))
      .rejects.toThrow('版本检查请求格式无效')
  })

  it('accepts only the fixed bookshelf refresh option', async () => {
    await invoke('bookshelf:get', {}, { refresh: true })

    expect(services.bookshelf.getPage).toHaveBeenCalledWith({ refresh: true })
    await expect(invoke('bookshelf:get', {}, {
      refresh: false,
      url: 'https://example.com/',
    })).rejects.toThrow('请求参数格式无效')
  })

  it('validates and forwards only a book ID when adding to the bookshelf', async () => {
    await invoke('bookshelf:add', {}, { bookId: '3057' })

    expect(services.bookshelf.addBook).toHaveBeenCalledWith('3057')
    await expect(invoke('bookshelf:add', {}, { bookId: '../3057' }))
      .rejects.toThrow('作品编号')
    await expect(invoke('bookshelf:add', {}, {
      bookId: '3057',
      url: 'https://example.com/',
    })).rejects.toThrow('请求参数格式无效')
  })

  it('validates batch inputs and forwards only main-generated batch operations', async () => {
    const item = {
      bookId: '3057', title: '测试作品', type: 'epub_volume', volume: '第一卷',
    }
    const batchId = '550e8400-e29b-41d4-a716-446655440000'

    await invoke('download:enqueue-batch', {}, { inputs: [item] })
    await invoke('download:cancel-batch', {}, { batchId })
    await invoke('download:retry-batch', {}, { batchId })

    expect(mocks.enqueueDownloadBatch).toHaveBeenCalledWith([item])
    expect(mocks.cancelDownloadBatch).toHaveBeenCalledWith(batchId)
    expect(mocks.retryDownloadBatch).toHaveBeenCalledWith(batchId)
    await expect(invoke('download:enqueue-batch', {}, {
      inputs: [{ ...item, batchId }],
    })).rejects.toThrow('批次任务格式')
    await expect(invoke('download:cancel-batch', {}, { batchId, taskId: batchId }))
      .rejects.toThrow('批次请求格式')
  })

  it('validates and forwards catalog requests without logging arbitrary fields', async () => {
    const query = {
      tag: '校园' as const,
      status: 'serializing' as const,
      animation: 'animated' as const,
      sort: 'lastupdate' as const,
      page: 3,
    }

    await invoke('catalog:get', {}, { query, refresh: true })

    expect(services.catalog.getPage).toHaveBeenCalledWith(query, { refresh: true })
    await expect(invoke('catalog:get', {}, {
      query: { ...query, url: 'file:///tmp' }, refresh: false,
    })).rejects.toThrow('找书请求格式无效')
    expect(mocks.logger.info.mock.calls.flatMap(call => Object.keys(call[2] ?? {})))
      .not.toContain('tag')
  })

  it('exposes only a parameter-free full cache clear', async () => {
    vi.mocked(services.clearCache).mockResolvedValueOnce({ deferred: true })

    await expect(invoke('cache:clear', {})).resolves.toEqual({ deferred: true })
    expect(services.clearCache).toHaveBeenCalledTimes(1)
    await expect(invoke('cache:clear', {}, { path: '/tmp' }))
      .rejects.toThrow('请求参数格式无效')
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
    await expect(invoke('search:title', {}, { query: '' })).rejects.toThrow('请输入 1 到 100 个字符')
    await expect(invoke('book:get', {}, { bookId: '../3057' })).rejects.toThrow('作品编号')
    await expect(invoke('download:enqueue', {}, {
      bookId: 'not-a-book',
      title: '测试作品',
      type: 'epub_full',
    })).rejects.toThrow('作品编号')
    await expect(invoke('shell:openExternal', {}, 'http://wenku8.net')).rejects.toThrow('允许范围')
    await expect(invoke('shell:openFolder', {}, '../config')).rejects.toThrow('下载文件夹')

    expect(services.search.search).not.toHaveBeenCalled()
    expect(services.books.get).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(mocks.enqueueDownload).not.toHaveBeenCalled()
  })

  it('validates and forwards all download manager commands', async () => {
    const taskId = 'dl-1720000000000-3'
    const enqueueInput = {
      bookId: '3057',
      title: '测试作品',
      cover: 'https://example.com/cover.jpg',
      type: 'epub_volume',
      volume: '第一卷',
    } as const
    mocks.enqueueDownload.mockReturnValueOnce({
      revision: 2,
      tasks: [{
        id: taskId,
        ...enqueueInput,
        status: 'pending',
        progress: 0,
        createdAt: 1,
        updatedAt: 1,
      }],
      legacyImportCompleted: true,
    })

    await invoke('download:get-snapshot', {})
    await invoke('download:enqueue', {}, enqueueInput)
    await invoke('download:cancel', {}, { taskId })
    await invoke('download:retry', {}, { taskId })
    await invoke('download:remove', {}, { taskId })
    await invoke('download:clear-history', {}, { scope: 'terminal' })
    await invoke('download:import-legacy-history', {}, { tasks: [{ id: taskId }] })

    expect(mocks.getDownloadSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueDownload).toHaveBeenCalledWith(enqueueInput)
    expect(mocks.cancelDownload).toHaveBeenCalledWith(taskId)
    expect(mocks.retryDownload).toHaveBeenCalledWith(taskId)
    expect(mocks.removeDownload).toHaveBeenCalledWith(taskId)
    expect(mocks.clearDownloadHistory).toHaveBeenCalledWith('terminal')
    expect(mocks.importLegacyDownloadHistory).toHaveBeenCalledWith([{ id: taskId }])
  })

  it.each([
    ['download:cancel', { taskId: 'invalid' }],
    ['download:retry', null],
    ['download:clear-history', { scope: 'active' }],
    ['download:import-legacy-history', { tasks: 'invalid' }],
    ['download:artifact-open', { taskId: 'dl-1720000000000-3', artifactId: '../file' }],
  ] as const)('rejects malformed manager payloads for %s', async (channel, payload) => {
    await expect(invoke(channel, {}, payload)).rejects.toThrow()
  })

  it('opens and reveals only manager-resolved artifacts', async () => {
    const taskId = 'dl-1720000000000-3'
    const artifactId = 'primary'
    const path = resolve(process.cwd(), 'downloads', 'book.epub')
    mocks.getArtifactTarget.mockResolvedValue({ path, kind: 'file' })

    await invoke('download:artifact-open', {}, { taskId, artifactId })
    await invoke('download:artifact-reveal', {}, { taskId, artifactId })

    expect(mocks.getArtifactTarget).toHaveBeenNthCalledWith(1, taskId, artifactId)
    expect(mocks.getArtifactTarget).toHaveBeenNthCalledWith(2, taskId, artifactId)
    expect(mocks.openPath).toHaveBeenCalledWith(path)
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(path)
  })

  it('opens a directory when revealing it and reports shell failures safely', async () => {
    const taskId = 'dl-1720000000000-3'
    const path = resolve(process.cwd(), 'downloads', 'pics', 'book')
    mocks.getArtifactTarget.mockResolvedValue({ path, kind: 'directory' })

    await invoke('download:artifact-reveal', {}, { taskId, artifactId: 'primary' })
    expect(mocks.openPath).toHaveBeenCalledWith(path)
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()

    mocks.openPath.mockResolvedValueOnce('native shell detail')
    await expect(invoke('download:artifact-open', {}, {
      taskId,
      artifactId: 'primary',
    })).rejects.toThrow('无法打开下载文件，请确认文件仍然存在')
  })

  it('broadcasts state changes only to live renderer windows', () => {
    const liveSend = vi.fn()
    const destroyedSend = vi.fn()
    mocks.browserWindows.push(
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: liveSend },
      },
      {
        isDestroyed: () => true,
        webContents: { isDestroyed: () => false, send: destroyedSend },
      },
    )
    const stateEvent = {
      snapshot: { revision: 2, tasks: [], legacyImportCompleted: true },
    }

    mocks.downloadSubscriber?.(stateEvent)

    expect(liveSend).toHaveBeenCalledWith('download:state-changed', stateEvent)
    expect(destroyedSend).not.toHaveBeenCalled()
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
    const send = vi.fn()
    mocks.acquireCookie.mockImplementationOnce(async (onProgress) => {
      onProgress?.({ step: 'login', message: '正在登录...' })
      return { loginCookies: {} }
    })

    await invoke(
      'cookie:auto',
      { sender: { send } },
      { operationId: 'login-123-1' },
    )

    expect(mocks.acquireCookie).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('cookie:progress', {
      operationId: 'login-123-1',
      step: 'login',
      message: '正在登录...',
    })
    expect(services.invalidateBookCache).toHaveBeenCalledTimes(1)
  })

  it('preserves a safe Cloudflare verification error for the renderer', async () => {
    mocks.acquireCookie.mockRejectedValueOnce(
      new Error('安全验证未完成，请重新刷新登录状态'),
    )

    await expect(invoke(
      'cookie:auto',
      { sender: { send: vi.fn() } },
      { operationId: 'login-123-2' },
    )).rejects.toThrow('安全验证未完成，请重新刷新登录状态')

    expect(services.invalidateBookCache).not.toHaveBeenCalled()
  })
})
