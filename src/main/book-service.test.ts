import { describe, expect, it, vi } from 'vitest'
import type { Book, ParsedBookPage } from './book'
import type { BookSnapshot, BookVersion } from './book-cache-model'
import { createBookVersion } from './book-cache-model'
import { BookService, type BookSource } from './book-service'

const logMocks = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn() }))

vi.mock('./logging/logger', () => ({
  logger: { debug: logMocks.debug, info: logMocks.info, warn: vi.fn(), error: vi.fn() },
}))

const STABLE_FIELDS = {
  updatedAt: '2026-08-29',
  latestChapter: '第一章',
  status: '连载',
}

function page(overrides: Partial<ParsedBookPage['versionFields']> = {}): ParsedBookPage {
  const versionFields = { ...STABLE_FIELDS, ...overrides }
  return {
    chapterIndexUrl: 'https://www.wenku8.net/novel/1/123/index.htm',
    versionFields,
    basicInfo: {
      '标题': '测试作品', '作者': '作者', '出版社': '文库',
      '最新章节': versionFields.latestChapter || null,
      '连载状态': versionFields.status,
      '更新时间': versionFields.updatedAt || null,
      '全文长度': '100', '简介': '新简介', 'cover': null,
      '标签': ['校园'], '动画化': false, '热度': 'A级',
    },
  }
}

function snapshot(options: {
  checkedAt?: number
  version?: BookVersion
  legacyImportGenerationKey?: string
} = {}): BookSnapshot {
  const version = options.version ?? createBookVersion(STABLE_FIELDS, 1_000)
  return {
    schemaVersion: 2,
    bookId: '123',
    checkedAt: options.checkedAt ?? 1_000,
    version,
    legacyImportGenerationKey: options.legacyImportGenerationKey ?? version.generationKey,
    baseChapterUrl: 'https://www.wenku8.net/novel/1/123/',
    volumes: { 第一卷: [{ name: '第一章', link: '1.htm' }] },
    basicInfo: {
      '标题': '测试作品', '作者': '作者', '出版社': '文库', '最新章节': '第一章',
      '连载状态': '连载', '更新时间': '2026-08-29', '全文长度': '100',
      '简介': '旧简介', 'cover': null,
      '标签': [], '动画化': false, '热度': null,
    },
  }
}

function bookFromSnapshot(value: BookSnapshot): Book {
  return {
    bookId: value.bookId,
    version: value.version,
    generationKey: value.version.generationKey,
    legacyImportGenerationKey: value.legacyImportGenerationKey,
    basicInfo: value.basicInfo,
    volumes: value.volumes,
    baseChapterUrl: value.baseChapterUrl,
    pictureUrls: {},
    toSnapshot: (checkedAt: number) => ({ ...value, checkedAt }),
  } as unknown as Book
}

function setup(options: {
  cached?: BookSnapshot | null
  now?: () => number
  fetchPage?: BookSource['fetchPage']
  buildFromPage?: BookSource['buildFromPage']
  maxResolvedBooks?: number
} = {}) {
  const loadSnapshot = vi.fn().mockResolvedValue(options.cached ?? null)
  const saveSnapshot = vi.fn().mockResolvedValue(true)
  const removeOtherGenerations = vi.fn().mockResolvedValue(undefined)
  const repository = {
    captureWriteGuard: vi.fn(() => ({ epoch: 0 })),
    loadSnapshot,
    saveSnapshot,
    removeOtherGenerations,
  }
  const fetchPage = vi.fn(options.fetchPage ?? (async () => page()))
  const buildFromPage = vi.fn(options.buildFromPage ?? (async (
    _bookId: string,
    currentPage: ParsedBookPage,
    version: BookVersion,
    legacyImportGenerationKey: string,
  ) => bookFromSnapshot({
    ...snapshot({ version, legacyImportGenerationKey }),
    basicInfo: currentPage.basicInfo,
  })))
  const restore = vi.fn((value: BookSnapshot) => bookFromSnapshot(value))
  const source = { fetchPage, buildFromPage, restore }
  const service = new BookService(source, repository, {
    now: options.now,
    maxResolvedBooks: options.maxResolvedBooks,
  })
  return { service, repository, source }
}

describe('BookService', () => {
  it('deduplicates in-flight loads and broadcasts throttle waits', async () => {
    let resolvePage!: (value: ParsedBookPage) => void
    let notifyThrottle!: (waitMs: number) => void
    const { service, source } = setup({
      fetchPage: (_bookId, _signal, onThrottleWait) => new Promise(resolve => {
        notifyThrottle = onThrottleWait
        resolvePage = resolve
      }),
    })
    const firstProgress = vi.fn()
    const secondProgress = vi.fn()
    const first = service.get('123', { onThrottleWait: firstProgress })
    const second = service.get('123', { onThrottleWait: secondProgress })
    await Promise.resolve()
    await Promise.resolve()
    notifyThrottle(120_000)
    resolvePage(page())

    await expect(first).resolves.toBe(await second)
    expect(source.fetchPage).toHaveBeenCalledTimes(1)
    expect(firstProgress).toHaveBeenCalledWith(120_000)
    expect(secondProgress).toHaveBeenCalledWith(120_000)
  })

  it('lets one waiter cancel without aborting a shared load', async () => {
    let resolvePage!: (value: ParsedBookPage) => void
    let sharedSignal!: AbortSignal
    const { service } = setup({
      fetchPage: (_bookId, signal) => new Promise(resolve => {
        sharedSignal = signal
        resolvePage = resolve
      }),
    })
    const controller = new AbortController()
    const cancelled = service.get('123', { signal: controller.signal })
    const shared = service.get('123')
    controller.abort()

    await expect(cancelled).rejects.toThrow('下载已取消')
    expect(sharedSignal.aborted).toBe(false)
    resolvePage(page())
    await expect(shared).resolves.toEqual(expect.objectContaining({ bookId: '123' }))
  })

  it('aborts and evicts a load after its final waiter cancels', async () => {
    let firstSignal!: AbortSignal
    const { service, source } = setup({
      fetchPage: vi.fn()
        .mockImplementationOnce((_bookId, signal: AbortSignal) => {
          firstSignal = signal
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        })
        .mockResolvedValueOnce(page()),
    })
    const controller = new AbortController()
    const first = service.get('123', { signal: controller.signal })
    controller.abort()

    await expect(first).rejects.toThrow('下载已取消')
    expect(firstSignal.aborted).toBe(true)
    await expect(service.get('123')).resolves.toEqual(expect.objectContaining({ bookId: '123' }))
    expect(source.fetchPage).toHaveBeenCalledTimes(2)
  })

  it('reuses a stable snapshot inside the 60 second validation grace', async () => {
    let now = 1_000
    const cached = snapshot({ checkedAt: now })
    const { service, repository, source } = setup({ cached, now: () => now })

    await expect(service.get('123')).resolves.toEqual(expect.objectContaining({ bookId: '123' }))
    now += 59_999
    await service.get('123')

    expect(repository.loadSnapshot).toHaveBeenCalledTimes(1)
    expect(source.fetchPage).not.toHaveBeenCalled()
  })

  it('revalidates a snapshot whose checked time is in the future', async () => {
    const cached = snapshot({ checkedAt: 2_000 })
    const { service, source } = setup({ cached, now: () => 1_000 })

    await service.get('123')

    expect(source.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('after 60 seconds fetches only the book page when the stable version matches', async () => {
    const now = 62_000
    const cached = snapshot({ checkedAt: 1_000 })
    const { service, repository, source } = setup({ cached, now: () => now })

    const result = await service.get('123')

    expect(source.fetchPage).toHaveBeenCalledTimes(1)
    expect(source.buildFromPage).not.toHaveBeenCalled()
    expect(result.basicInfo['简介']).toBe('新简介')
    expect(repository.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ checkedAt: now, volumes: cached.volumes }),
      expect.any(Object),
    )
    expect(repository.removeOtherGenerations).not.toHaveBeenCalled()
  })

  it('explicit revalidation always rebuilds the directory', async () => {
    const cached = snapshot({ checkedAt: 1_000 })
    const { service, repository, source } = setup({ cached, now: () => 2_000 })

    await service.get('123', { revalidate: true })

    expect(source.fetchPage).toHaveBeenCalledTimes(1)
    expect(source.buildFromPage).toHaveBeenCalledTimes(1)
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(1)
  })

  it('serializes revalidation behind an in-flight normal load for the same book', async () => {
    let resolveNormal!: (value: ParsedBookPage) => void
    const fetchPage = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveNormal = resolve
      }))
      .mockResolvedValueOnce(page({ latestChapter: '第二章' }))
    const { service, repository, source } = setup({ fetchPage })

    const normal = service.get('123')
    const revalidated = service.get('123', { revalidate: true })
    await vi.waitFor(() => expect(source.fetchPage).toHaveBeenCalledTimes(1))

    resolveNormal(page())
    await normal
    await revalidated

    expect(source.fetchPage).toHaveBeenCalledTimes(2)
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2)
    expect(repository.saveSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          generationKey: createBookVersion({
            ...STABLE_FIELDS,
            latestChapter: '第二章',
          }, 1_000).generationKey,
        }),
      }),
      expect.any(Object),
    )
  })

  it('keeps the previous generation when a changed catalog fails', async () => {
    const cached = snapshot({ checkedAt: 1_000 })
    const { service, repository, source } = setup({
      cached,
      now: () => 62_000,
      fetchPage: async () => page({ latestChapter: '第二章' }),
      buildFromPage: async () => { throw new Error('catalog failed') },
    })

    await expect(service.get('123')).rejects.toThrow('catalog failed')
    expect(repository.saveSnapshot).not.toHaveBeenCalled()
    expect(repository.removeOtherGenerations).not.toHaveBeenCalled()
    expect(source.buildFromPage).toHaveBeenCalledWith(
      '123',
      expect.any(Object),
      expect.objectContaining({ generationKey: expect.not.stringMatching(cached.version.generationKey) }),
      cached.legacyImportGenerationKey,
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })

  it('reuses metadata-free snapshots for six hours then creates a new generation', async () => {
    let now = 1_000
    const unknownVersion = createBookVersion({ updatedAt: '', latestChapter: '', status: '' }, now)
    const cached = snapshot({ checkedAt: now, version: unknownVersion })
    const { service, source } = setup({
      cached,
      now: () => now,
      fetchPage: async () => page({ updatedAt: '', latestChapter: '', status: '' }),
    })

    now += 6 * 60 * 60 * 1000 - 1
    await service.get('123')
    expect(source.fetchPage).not.toHaveBeenCalled()

    now += 1
    const refreshed = await service.get('123')
    expect(source.fetchPage).toHaveBeenCalledTimes(1)
    expect(source.buildFromPage).toHaveBeenCalledTimes(1)
    expect(refreshed.generationKey).not.toBe(unknownVersion.generationKey)
  })

  it('does not retain rejected loads', async () => {
    const { service, source } = setup({
      fetchPage: vi.fn()
        .mockRejectedValueOnce(new Error('network failed'))
        .mockResolvedValueOnce(page()),
    })
    await expect(service.get('123')).rejects.toThrow('network failed')
    await expect(service.get('123')).resolves.toEqual(expect.objectContaining({ bookId: '123' }))
    expect(source.fetchPage).toHaveBeenCalledTimes(2)
  })

  it('does not repopulate memory from a load that started before clearMemory', async () => {
    let resolveFirst!: (value: ParsedBookPage) => void
    const { service, source } = setup({
      fetchPage: vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveFirst = resolve
        }))
        .mockResolvedValueOnce(page()),
    })
    const first = service.get('123')
    await vi.waitFor(() => expect(source.fetchPage).toHaveBeenCalledTimes(1))
    service.clearMemory()
    resolveFirst(page())
    await first

    await service.get('123')

    expect(source.fetchPage).toHaveBeenCalledTimes(2)
  })

  it('bounds resolved books with least-recently-used eviction', async () => {
    const { service, repository, source } = setup({ maxResolvedBooks: 2 })

    await service.get('1')
    await service.get('2')
    await service.get('1')
    await service.get('3')
    await service.get('2')

    expect(source.fetchPage).toHaveBeenCalledTimes(4)
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(4)
  })
})
