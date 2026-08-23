import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { DownloadRateLimiter } from './download-rate-limiter'
import {
  asyncPool,
  buildBookKey,
  buildVolumeKey,
  Downloader,
  downloadImageBatch,
  guessType,
  type DownloaderBook,
  type DownloaderCrawler,
  type DownloadRuntimeConfig,
} from './downloader'

function runtimeConfig(rootPath: string): DownloadRuntimeConfig {
  return {
    fullTitle: 'FULL',
    defaultCoverIndex: 0,
    downloadPath: rootPath,
    rootPath,
  }
}

function createCrawlerFixture(
  overrides: Partial<DownloaderCrawler> = {},
): DownloaderCrawler {
  return {
    fetch: vi.fn(),
    getImageContent: vi.fn(async () => null),
    ...overrides,
  } satisfies DownloaderCrawler
}

type DownloaderBookOverrides = Partial<Omit<DownloaderBook, 'basicInfo'>> & {
  basicInfo?: Partial<DownloaderBook['basicInfo']>
}

function createBookFixture(overrides: DownloaderBookOverrides = {}): DownloaderBook {
  const { basicInfo: basicInfoOverrides, ...bookOverrides } = overrides
  return {
    bookId: '200',
    baseChapterUrl: 'https://www.wenku8.net/novel/2/200/',
    volumes: {},
    getFormattedTitle: () => '同名作品',
    getChapterImageUrls: async () => null,
    getCoverContent: async () => Buffer.from('cover'),
    ...bookOverrides,
    basicInfo: {
      '标题': '同名作品',
      '作者': '测试作者',
      '出版社': '',
      '最新章节': null,
      '连载状态': '',
      '更新时间': null,
      '全文长度': null,
      '简介': '',
      cover: null,
      ...basicInfoOverrides,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildBookKey', () => {
  it('keeps sanitized book titles unique by their stable book ID', () => {
    const first = buildBookKey('作品:A', '100')
    const second = buildBookKey('作品?A', '200')

    expect(first).toBe('100_作品_A')
    expect(second).toBe('200_作品_A')
    expect(first).not.toBe(second)
  })
})

describe('buildVolumeKey', () => {
  it('keeps sanitized volume names unique by their stable index', () => {
    const first = buildVolumeKey('卷:A', 0)
    const second = buildVolumeKey('卷?A', 1)

    expect(first).toBe('1_卷_A')
    expect(second).toBe('2_卷_A')
    expect(first).not.toBe(second)
  })
})

describe('Downloader.downloadPictures', () => {
  it('does not reuse an ambiguous legacy image directory for a book ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-pictures-'))

    try {
      const legacyDir = join(root, 'pics', '同名作品', '第一卷')
      await mkdir(legacyDir, { recursive: true })
      await writeFile(join(legacyDir, '1.jpg'), 'legacy-image')

      const crawler = createCrawlerFixture({
        getImageContent: async () => Buffer.from('current-book-image'),
      })
      const downloader = new Downloader(crawler, runtimeConfig(root))

      await downloader.downloadPictures(
        ['https://example.com/1.jpg'],
        '第一卷',
        '同名作品',
        '200',
        0,
      )

      await expect(readFile(join(root, 'pics', '200_同名作品', '1_第一卷', '1.jpg'), 'utf-8'))
        .resolves.toBe('current-book-image')
      await expect(readFile(join(legacyDir, '1.jpg'), 'utf-8')).resolves.toBe('legacy-image')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('delegates retries to the crawler without logging image URL credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-pictures-'))

    const secretUrl = 'https://user:password@example.com/1.jpg?token=secret-token#private'
    const getImageContent = vi
      .fn()
      .mockRejectedValueOnce(new Error('访问过于频繁（HTTP 429）'))
      .mockResolvedValueOnce(Buffer.from('image'))
    const schedule = vi.fn()
    const rateLimiter = new DownloadRateLimiter(schedule)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const downloader = new Downloader(
        createCrawlerFixture({ getImageContent }),
        runtimeConfig(root),
        rateLimiter,
      )

      await expect(
        downloader.downloadPictures([secretUrl], '第一卷', '测试作品', '100', 0),
      ).rejects.toThrow('图片下载失败')

      expect(getImageContent).toHaveBeenNthCalledWith(1, secretUrl, 1, expect.any(Function))
      expect(rateLimiter.speed.level).toBe(2)
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30000)

      const nextUrl = 'https://example.com/2.jpg'
      await downloader.downloadPictures([nextUrl], '第二卷', '测试作品', '100', 1)
      expect(getImageContent).toHaveBeenNthCalledWith(2, nextUrl, 3, expect.any(Function))
      const warningText = warn.mock.calls.flat().join(' ')
      expect(warningText).not.toContain('password')
      expect(warningText).not.toContain('secret-token')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records a throttled response even when the crawler retry succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-pictures-'))

    const scheduled: Array<{ callback: () => void; delayMs: number }> = []
    const rateLimiter = new DownloadRateLimiter((callback, delayMs) => {
      scheduled.push({ callback, delayMs })
    })
    rateLimiter.record(503)
    scheduled.shift()?.callback()

    const getImageContent = vi.fn(async (
      _url: string,
      _maxRetries: number,
      onStatus?: (status: number) => void,
    ) => {
      onStatus?.(429)
      onStatus?.(200)
      return Buffer.from('image-after-retry')
    })

    try {
      const downloader = new Downloader(
        createCrawlerFixture({ getImageContent }),
        runtimeConfig(root),
        rateLimiter,
      )

      await downloader.downloadPictures(
        ['https://example.com/retried.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )

      expect(getImageContent).toHaveBeenCalledWith(
        'https://example.com/retried.jpg',
        2,
        expect.any(Function),
      )
      expect(rateLimiter.speed.level).toBe(2)
      expect(scheduled.map(({ delayMs }) => delayMs)).toContain(30000)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('captures an immutable download root when the task is created', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'wenku8-snapshot-a-'))
    const rootB = await mkdtemp(join(tmpdir(), 'wenku8-snapshot-b-'))
    let resolveImage: ((value: Buffer) => void) | undefined
    const pendingImage = new Promise<Buffer>((resolve) => { resolveImage = resolve })
    const getImageContent = vi.fn(async () => pendingImage)
    const config = runtimeConfig(rootA)

    try {
      const downloader = new Downloader(
        createCrawlerFixture({ getImageContent }),
        config,
      )
      const book = createBookFixture({
        bookId: '100',
        volumes: { '第一卷': [{ name: '插图', link: 'illust.htm' }] },
        getFormattedTitle: () => '测试作品',
        getChapterImageUrls: async () => ['https://example.com/1.jpg'],
      })

      const task = downloader.downloadNovel(book, '第一卷')
      await vi.waitFor(() => expect(getImageContent).toHaveBeenCalledTimes(1))
      config.rootPath = rootB
      config.downloadPath = rootB
      resolveImage?.(Buffer.from('image'))
      await task

      await expect(readFile(join(rootA, 'novels', '100_测试作品', '1_第一卷.epub')))
        .resolves.toBeInstanceOf(Buffer)
      await expect(readFile(join(rootB, 'novels', '100_测试作品', '1_第一卷.epub')))
        .rejects.toThrow()
    } finally {
      await rm(rootA, { recursive: true, force: true })
      await rm(rootB, { recursive: true, force: true })
    }
  })
})

describe('Downloader.downloadNovel', () => {
  it('keeps an ambiguous legacy full-book EPUB when writing the book-ID path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-novels-'))

    try {
      const legacyFile = join(root, 'novels', '同名作品.epub')
      await mkdir(join(root, 'novels'), { recursive: true })
      await writeFile(legacyFile, 'other-book')

      const book = createBookFixture({
        getCoverContent: async () => { throw new Error('no cover') },
      })
      const downloader = new Downloader(createCrawlerFixture(), runtimeConfig(root))

      await downloader.downloadNovel(book)

      await expect(readFile(legacyFile, 'utf-8')).resolves.toBe('other-book')
      await expect(readFile(join(root, 'novels', '200_同名作品.epub'))).resolves.toBeInstanceOf(Buffer)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps an ambiguous legacy volume EPUB when writing the book-ID path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-novels-'))

    try {
      const legacyFile = join(root, 'novels', '同名作品', '第一卷.epub')
      await mkdir(join(root, 'novels', '同名作品'), { recursive: true })
      await writeFile(legacyFile, 'other-book')

      const book = createBookFixture({
        volumes: { '第一卷': [] },
      })
      const downloader = new Downloader(createCrawlerFixture(), runtimeConfig(root))

      await downloader.downloadNovel(book, '第一卷')

      await expect(readFile(legacyFile, 'utf-8')).resolves.toBe('other-book')
      await expect(readFile(join(root, 'novels', '200_同名作品', '1_第一卷.epub')))
        .resolves.toBeInstanceOf(Buffer)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('guessType', () => {
  it('returns jpeg for unknown extensions', () => {
    expect(guessType('unknown')).toBe('image/jpeg')
  })

  it('returns png for .png', () => {
    expect(guessType('png')).toBe('image/png')
  })

  it('returns gif for .gif', () => {
    expect(guessType('gif')).toBe('image/gif')
  })

  it('returns webp for .webp', () => {
    expect(guessType('webp')).toBe('image/webp')
  })

  it('returns svg for .svg', () => {
    expect(guessType('svg')).toBe('image/svg+xml')
  })

  it('handles uppercase extensions', () => {
    expect(guessType('PNG')).toBe('image/png')
    expect(guessType('JPG')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpg', () => {
    expect(guessType('jpg')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpeg', () => {
    expect(guessType('jpeg')).toBe('image/jpeg')
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('asyncPool', () => {
  it('保持结果顺序与输入一致', async () => {
    const items = [3, 1, 4, 1, 5]
    const results = await asyncPool(2, items, async (n) => {
      await sleep(n * 10)
      return n * 10
    })
    expect(results).toEqual([30, 10, 40, 10, 50])
  })

  it('限制并发数不超上限', async () => {
    let maxConcurrent = 0
    let running = 0
    const concurrency = 2
    const items = Array.from({ length: 8 }, (_, i) => i)

    await asyncPool(concurrency, items, async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(20 - i * 2)
      running--
      return i
    })

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency)
  })

  it('concurrency=Infinity 时所有任务并行', async () => {
    let maxConcurrent = 0
    let running = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await asyncPool(Infinity, items, async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(10)
      running--
      return i
    })

    expect(maxConcurrent).toBe(10)
  })

  it('单个任务失败时等待在途任务结束且不再启动新任务', async () => {
    let finishSlowTask: (() => void) | undefined
    let settled = false
    const started: number[] = []
    const slowTask = new Promise<void>((resolve) => { finishSlowTask = resolve })

    const result = asyncPool(2, [1, 2, 3], async (n) => {
      started.push(n)
      if (n === 1) throw new Error('任务1失败')
      if (n === 2) await slowTask
      return n
    })
    void result.then(
      () => { settled = true },
      () => { settled = true },
    )

    await vi.waitFor(() => expect(started).toEqual([1, 2]))
    expect(settled).toBe(false)
    finishSlowTask?.()

    await expect(result).rejects.toThrow('任务1失败')
    expect(started).toEqual([1, 2])
  })

  it('空数组直接返回空结果', async () => {
    const results = await asyncPool(5, [], async () => 'x')
    expect(results).toEqual([])
  })

  it('单元素数组正常工作', async () => {
    const results = await asyncPool(1, [42], async (n) => n * 2)
    expect(results).toEqual([84])
  })

  it('concurrency=1 时完全串行', async () => {
    let maxConcurrent = 0
    let running = 0

    await asyncPool(1, [1, 2, 3, 4, 5], async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(5)
      running--
      return i
    })

    expect(maxConcurrent).toBe(1)
  })
})

describe('downloadImageBatch', () => {
  it('rejects without exposing image URL credentials', async () => {
    const secretUrl = 'https://user:password@example.com/1.jpg?token=secret-token#private'

    const result = downloadImageBatch(
      [{ url: secretUrl, index: 0 }],
      async () => null,
      () => undefined,
    )

    await expect(result).rejects.toThrow('图片下载失败')
    await expect(result).rejects.not.toThrow('secret-token')
    await expect(result).rejects.not.toThrow('password')
  })

  it('waits for the whole in-flight batch before rejecting', async () => {
    let slowDownloadFinished = false
    const persistedIndices: number[] = []

    const result = downloadImageBatch(
      [
        { url: 'https://example.com/fail.jpg', index: 0 },
        { url: 'https://example.com/slow.jpg', index: 1 },
      ],
      async (url) => {
        if (url.endsWith('/fail.jpg')) return null
        await sleep(20)
        slowDownloadFinished = true
        return Buffer.from('image')
      },
      (_data, _ext, index) => { persistedIndices.push(index) },
    )

    await expect(result).rejects.toThrow('图片下载失败')
    expect(slowDownloadFinished).toBe(true)
    expect(persistedIndices).toEqual([1])
  })

  it('propagates image persistence errors', async () => {
    await expect(
      downloadImageBatch(
        [{ url: 'https://example.com/1.jpg', index: 0 }],
        async () => Buffer.from('image'),
        () => {
          throw new Error('磁盘空间不足')
        },
      ),
    ).rejects.toThrow('磁盘空间不足')
  })

  it('awaits asynchronous image persistence', async () => {
    let persisted = false

    await downloadImageBatch(
      [{ url: 'https://example.com/1.jpg', index: 0 }],
      async () => Buffer.from('image'),
      async () => {
        await sleep(5)
        persisted = true
      },
    )

    expect(persisted).toBe(true)
  })

  it('preserves each image original index', async () => {
    const written: number[] = []

    await downloadImageBatch(
      [
        { url: 'https://example.com/a.jpg', index: 4 },
        { url: 'https://example.com/b.png', index: 9 },
      ],
      async (url) => Buffer.from(url),
      (_data, _ext, index) => { written.push(index) },
    )

    expect(written).toEqual([4, 9])
  })
})
