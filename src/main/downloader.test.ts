import { link, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { load } from 'cheerio'
import { afterEach, describe, it, expect, vi } from 'vitest'

const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./logging/logger', () => ({ logger: logMocks }))

import { DownloadRateLimiter } from './download-rate-limiter'
import { Book } from './book'
import { DownloadCancelledError } from './download-cancellation'
import {
  asyncPool,
  atomicWriteDownloadFile,
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
  vi.clearAllMocks()
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

describe('atomicWriteDownloadFile', () => {
  it('keeps the previous file and removes its temporary file when replacement fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-atomic-download-'))
    const target = join(root, 'existing.epub')
    await writeFile(target, 'existing-epub')

    try {
      await expect(atomicWriteDownloadFile(target, Buffer.from('new-epub'), {
        rename: vi.fn(async () => { throw new Error('磁盘写入失败') }),
      })).rejects.toThrow('磁盘写入失败')

      await expect(readFile(target, 'utf-8')).resolves.toBe('existing-epub')
      expect((await readdir(root)).filter(name => name.includes('.tmp-'))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Downloader.downloadPictures', () => {
  it('keeps completion when cancellation arrives after the final image is committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-final-picture-'))
    const controller = new AbortController()
    const getImageContent = vi.fn(async () => Buffer.from('image'))
    const downloader = new Downloader(
      createCrawlerFixture({ getImageContent }),
      runtimeConfig(root),
      { rateLimiter: new DownloadRateLimiter(), signal: controller.signal },
    )
    downloader.setOnProgress(({ current, total }) => {
      if (current === total) controller.abort()
    })

    try {
      await expect(downloader.downloadPictures(
        ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )).resolves.toBeUndefined()

      expect(getImageContent).toHaveBeenCalledTimes(2)
      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '1.jpg')))
        .resolves.toEqual(Buffer.from('image'))
      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '2.jpg')))
        .resolves.toEqual(Buffer.from('image'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps completed files and stops before the next image after cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-cancel-pictures-'))
    const controller = new AbortController()
    const rateLimiter = new DownloadRateLimiter()
    rateLimiter.record(429)
    const getImageContent = vi.fn(async () => Buffer.from('image'))
    const downloader = new Downloader(
      createCrawlerFixture({ getImageContent }),
      runtimeConfig(root),
      { rateLimiter, signal: controller.signal },
    )
    downloader.setOnProgress(({ current }) => {
      if (current === 1) controller.abort()
    })

    try {
      await expect(downloader.downloadPictures(
        ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )).rejects.toBeInstanceOf(DownloadCancelledError)

      expect(getImageContent).toHaveBeenCalledTimes(1)
      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '1.jpg')))
        .resolves.toEqual(Buffer.from('image'))
      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '2.jpg')))
        .rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('keeps successfully downloaded images and records a warning for partial failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-pictures-'))
    const getImageContent = vi.fn(async (url: string) => (
      url.endsWith('ok.jpg') ? Buffer.from('image') : null
    ))

    try {
      const downloader = new Downloader(
        createCrawlerFixture({ getImageContent }),
        runtimeConfig(root),
      )

      await downloader.downloadPictures(
        ['https://example.com/ok.jpg', 'https://example.com/missing.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )

      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '1.jpg')))
        .resolves.toBeInstanceOf(Buffer)
      expect(downloader.getWarnings()).toEqual([
        '“第一卷”有 1 张插图未能下载，已保存其余插图。',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an all-zero-byte picture response instead of writing an empty file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-empty-picture-'))
    const downloader = new Downloader(createCrawlerFixture({
      getImageContent: vi.fn(async () => Buffer.alloc(0)),
    }), runtimeConfig(root))

    try {
      await expect(downloader.downloadPictures(
        ['https://example.com/empty.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )).rejects.toThrow('该分卷没有可保存的插图')
      expect(downloader.getWarnings()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('treats a zero-byte response as a partial failure when another picture succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-partial-empty-picture-'))
    const downloader = new Downloader(createCrawlerFixture({
      getImageContent: vi.fn(async (url: string) => (
        url.endsWith('empty.jpg') ? Buffer.alloc(0) : Buffer.from('image')
      )),
    }), runtimeConfig(root))

    try {
      await downloader.downloadPictures(
        ['https://example.com/empty.jpg', 'https://example.com/ok.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )

      expect(downloader.getWarnings()).toContain(
        '“第一卷”有 1 张插图未能下载，已保存其余插图。',
      )
      await expect(readFile(join(root, 'pics', '100_测试作品', '1_第一卷', '2.jpg')))
        .resolves.toEqual(Buffer.from('image'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('downloads again when a resumed picture file is zero bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-resume-empty-picture-'))
    const volumeDir = join(root, 'pics', '100_测试作品', '1_第一卷')
    await mkdir(volumeDir, { recursive: true })
    await writeFile(join(volumeDir, '1.jpg'), Buffer.alloc(0))
    const getImageContent = vi.fn(async () => Buffer.from('fresh-image'))
    const downloader = new Downloader(
      createCrawlerFixture({ getImageContent }),
      runtimeConfig(root),
    )

    try {
      await downloader.downloadPictures(
        ['https://example.com/1.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )

      expect(getImageContent).toHaveBeenCalledTimes(1)
      await expect(readFile(join(volumeDir, '1.jpg'))).resolves.toEqual(Buffer.from('fresh-image'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('replaces a zero-byte hard link without modifying its other path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-resume-hard-link-'))
    const volumeDir = join(root, 'pics', '100_测试作品', '1_第一卷')
    const linkedFile = join(root, 'outside.jpg')
    await mkdir(volumeDir, { recursive: true })
    await writeFile(linkedFile, Buffer.alloc(0))
    await link(linkedFile, join(volumeDir, '1.jpg'))
    const downloader = new Downloader(
      createCrawlerFixture({ getImageContent: vi.fn(async () => Buffer.from('fresh-image')) }),
      runtimeConfig(root),
    )

    try {
      await downloader.downloadPictures(
        ['https://example.com/1.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )

      await expect(readFile(linkedFile)).resolves.toEqual(Buffer.alloc(0))
      await expect(readFile(join(volumeDir, '1.jpg'))).resolves.toEqual(Buffer.from('fresh-image'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

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
      expect(logMocks.info).toHaveBeenCalledWith(
        'download.pictures.volume-completed',
        expect.any(String),
        expect.objectContaining({
          bookId: '200',
          volumeName: '第一卷',
          total: 1,
          skipped: 0,
          outputPath: expect.any(String),
        }),
      )
      expect(logMocks.info.mock.calls.filter(([event]) => event === 'download.image.completed'))
        .toHaveLength(0)
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
      ).rejects.toThrow('请求过于频繁，已自动降低下载速度，请稍等片刻后重试')
      expect(downloader.getWarnings()).not.toContain(
        '“第一卷”有 1 张插图未能下载，已保存其余插图。',
      )

      expect(getImageContent).toHaveBeenNthCalledWith(1, secretUrl, 1, expect.any(Function))
      expect(rateLimiter.speed.level).toBe(2)
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30000)

      const nextUrl = 'https://example.com/2.jpg'
      await downloader.downloadPictures([nextUrl], '第二卷', '测试作品', '100', 1)
      expect(getImageContent).toHaveBeenNthCalledWith(2, nextUrl, 3, expect.any(Function))
      const warningText = warn.mock.calls.flat().join(' ')
      expect(warningText).not.toContain('password')
      expect(warningText).not.toContain('secret-token')
      const logged = JSON.stringify([
        ...logMocks.warn.mock.calls,
        ...logMocks.error.mock.calls,
        ...logMocks.info.mock.calls,
      ])
      expect(logged).not.toContain('password')
      expect(logged).not.toContain('secret-token')
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
  it.each([
    {
      label: '整本',
      volumeName: undefined,
      outputPath: join('novels', '200_同名作品.epub'),
    },
    {
      label: '分卷',
      volumeName: '第一卷',
      outputPath: join('novels', '200_同名作品', '1_第一卷.epub'),
    },
  ])('replaces an existing $label EPUB without modifying its other hard-link path', async ({
    volumeName,
    outputPath,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-epub-hard-link-'))
    const peerPath = join(root, 'existing-copy.epub')
    const targetPath = join(root, outputPath)
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(peerPath, 'existing-epub')
    await link(peerPath, targetPath)
    const book = createBookFixture({
      volumes: { '第一卷': [{ name: '第一章', link: '1.htm' }] },
    })
    const downloader = new Downloader(createCrawlerFixture({
      fetch: vi.fn(async () => load('<div id="content">有效正文</div>')) as unknown as DownloaderCrawler['fetch'],
    }), runtimeConfig(root))

    try {
      await downloader.downloadNovel(book, volumeName)

      await expect(readFile(peerPath, 'utf-8')).resolves.toBe('existing-epub')
      await expect(readFile(targetPath)).resolves.not.toEqual(Buffer.from('existing-epub'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps an ambiguous legacy full-book EPUB when writing the book-ID path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-novels-'))

    try {
      const legacyFile = join(root, 'novels', '同名作品.epub')
      await mkdir(join(root, 'novels'), { recursive: true })
      await writeFile(legacyFile, 'other-book')

      const book = createBookFixture({
        getCoverContent: async () => { throw new Error('no cover') },
        volumes: { '第一卷': [{ name: '第一章', link: '1.htm' }] },
      })
      const downloader = new Downloader(createCrawlerFixture({
        fetch: vi.fn(async () => load('<div id="content">有效正文</div>')) as unknown as DownloaderCrawler['fetch'],
      }), runtimeConfig(root))

      await downloader.downloadNovel(book)

      await expect(readFile(legacyFile, 'utf-8')).resolves.toBe('other-book')
      await expect(readFile(join(root, 'novels', '200_同名作品.epub'))).resolves.toBeInstanceOf(Buffer)
      expect(downloader.getWarnings()).toContain('封面未能下载，正文内容仍已保存。')
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
        volumes: { '第一卷': [{ name: '第一章', link: '1.htm' }] },
      })
      const downloader = new Downloader(createCrawlerFixture({
        fetch: vi.fn(async () => load('<div id="content">有效正文</div>')) as unknown as DownloaderCrawler['fetch'],
      }), runtimeConfig(root))

      await downloader.downloadNovel(book, '第一卷')

      await expect(readFile(legacyFile, 'utf-8')).resolves.toBe('other-book')
      await expect(readFile(join(root, 'novels', '200_同名作品', '1_第一卷.epub')))
        .resolves.toBeInstanceOf(Buffer)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    [429, '请求过于频繁，已自动降低下载速度，请稍等片刻后重试'],
    [403, '登录状态已失效，请前往配置页重新登录后重试'],
  ] as const)('preserves structured HTTP %s when every picture fails', async (
    status,
    expectedMessage,
  ) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-picture-http-'))
    const statusError = Object.assign(new Error('服务暂时不可用，请稍后重试'), { status })
    const requestError = new Error('图片请求失败', { cause: statusError })
    const rateLimiter = new DownloadRateLimiter(() => undefined)
    const record = vi.spyOn(rateLimiter, 'record')
    const downloader = new Downloader(createCrawlerFixture({
      getImageContent: vi.fn(async () => { throw requestError }),
    }), runtimeConfig(root), rateLimiter)

    try {
      await expect(downloader.downloadPictures(
        ['https://example.com/failed.jpg'],
        '第一卷',
        '测试作品',
        '100',
        0,
      )).rejects.toThrow(expectedMessage)
      expect(record).toHaveBeenCalledWith(status)
      expect(downloader.getWarnings()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    {
      label: '整本',
      volumeName: undefined,
      outputPath: join('novels', '200_同名作品.epub'),
    },
    {
      label: '分卷',
      volumeName: '第一卷',
      outputPath: join('novels', '200_同名作品', '1_第一卷.epub'),
    },
  ])('keeps $label EPUB content when the illustration page cannot be read', async ({
    volumeName,
    outputPath,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-illustration-page-'))
    const book = createBookFixture({
      volumes: {
        '第一卷': [
          { name: '插图', link: 'illust.htm' },
          { name: '第一章', link: '1.htm' },
        ],
      },
      getChapterImageUrls: async () => {
        throw new Error('illustration page timeout')
      },
    })
    const downloader = new Downloader(createCrawlerFixture({
      fetch: vi.fn(async () => load('<div id="content">有效正文</div>')) as unknown as DownloaderCrawler['fetch'],
    }), runtimeConfig(root))

    try {
      await expect(downloader.downloadNovel(book, volumeName)).resolves.toBeUndefined()
      await expect(readFile(join(root, outputPath))).resolves.toBeInstanceOf(Buffer)
      expect(downloader.getWarnings()).toContain(
        '“第一卷”的插图页无法读取，正文内容仍会保存。',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    {
      label: '整本',
      volumeName: undefined,
      outputPath: join('novels', '200_同名作品.epub'),
    },
    {
      label: '分卷',
      volumeName: '第一卷',
      outputPath: join('novels', '200_同名作品', '1_第一卷.epub'),
    },
  ])('keeps $label EPUB正文 when every optional illustration byte request fails', async ({
    volumeName,
    outputPath,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-optional-images-'))
    const book = createBookFixture({
      volumes: {
        '第一卷': [
          { name: '插图', link: 'illust.htm' },
          { name: '第一章', link: '1.htm' },
        ],
      },
      getChapterImageUrls: async () => ['https://example.com/failed.jpg'],
    })
    const downloader = new Downloader(createCrawlerFixture({
      getImageContent: vi.fn(async () => { throw new Error('network failed') }),
      fetch: vi.fn(async () => load('<div id="content">有效正文</div>')) as unknown as DownloaderCrawler['fetch'],
    }), runtimeConfig(root))

    try {
      await expect(downloader.downloadNovel(book, volumeName)).resolves.toBeUndefined()
      await expect(readFile(join(root, outputPath))).resolves.toBeInstanceOf(Buffer)
      expect(downloader.getWarnings()).toContain(
        '“第一卷”的插图未能下载，正文内容仍会保存。',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores a zero-byte image cache entry and downloads the image again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-empty-image-cache-'))
    const cacheDir = join(root, '.cache', '200', 'images', '1_第一卷')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, '0.bin'), Buffer.alloc(0))
    await writeFile(join(cacheDir, '0.meta'), 'jpg', 'utf-8')
    const getImageContent = vi.fn(async () => Buffer.from('fresh-image'))
    const book = createBookFixture({
      volumes: { '第一卷': [{ name: '插图', link: 'illust.htm' }] },
      getChapterImageUrls: async () => ['https://example.com/cover.jpg'],
    })
    const downloader = new Downloader(
      createCrawlerFixture({ getImageContent }),
      runtimeConfig(root),
    )

    try {
      await downloader.downloadNovel(book, '第一卷')
      expect(getImageContent).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { label: '整本', volumeName: undefined },
    { label: '分卷', volumeName: '第一卷' },
  ])('preserves the illustration-page error for an illustration-only $label download', async ({
    volumeName,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-illustration-only-'))
    const pageError = new Error('登录状态已失效，请重新登录后重试')
    const book = createBookFixture({
      volumes: {
        '第一卷': [{ name: '插图', link: 'illust.htm' }],
      },
      getChapterImageUrls: async () => { throw pageError },
    })
    const downloader = new Downloader(createCrawlerFixture(), runtimeConfig(root))

    try {
      await expect(downloader.downloadNovel(book, volumeName)).rejects.toBe(pageError)
      expect(downloader.getWarnings()).not.toContain(
        '“第一卷”的插图页无法读取，正文内容仍会保存。',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an empty chapter before it can be cached or written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-empty-chapter-'))
    const book = createBookFixture({
      volumes: { '第一卷': [{ name: '第一章', link: '1.htm' }] },
    })
    const downloader = new Downloader(createCrawlerFixture({
      fetch: vi.fn(async () => load('<div id="content"><br /></div>')) as unknown as DownloaderCrawler['fetch'],
    }), runtimeConfig(root))

    try {
      await expect(downloader.downloadNovel(book, '第一卷'))
        .rejects.toThrow('章节内容为空')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    [429, '请求过于频繁，已自动降低下载速度，请稍等片刻后重试'],
    [403, '登录状态已失效，请前往配置页重新登录后重试'],
  ] as const)('uses structured HTTP %s failures to update chapter throttling', async (
    status,
    expectedMessage,
  ) => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-http-status-'))
    const statusError = Object.assign(new Error('服务暂时不可用，请稍后重试'), { status })
    const requestError = new Error('请求失败（已重试 3 次）', { cause: statusError })
    const rateLimiter = new DownloadRateLimiter(() => undefined)
    const record = vi.spyOn(rateLimiter, 'record')
    const book = createBookFixture({
      volumes: { '第一卷': [{ name: '第一章', link: '1.htm' }] },
    })
    const downloader = new Downloader(createCrawlerFixture({
      fetch: vi.fn(async () => { throw requestError }) as unknown as DownloaderCrawler['fetch'],
    }), runtimeConfig(root), rateLimiter)

    try {
      await expect(downloader.downloadNovel(book, '第一卷')).rejects.toThrow(expectedMessage)
      expect(record).toHaveBeenCalledWith(status)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a work that has no usable volume content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenku8-empty-book-'))
    const downloader = new Downloader(createCrawlerFixture(), runtimeConfig(root))

    try {
      await expect(downloader.downloadNovel(createBookFixture()))
        .rejects.toThrow('没有可保存的内容')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Book.getCoverContent', () => {
  it('rejects a zero-byte cover response', async () => {
    const book = Object.create(Book.prototype) as Book
    Object.assign(book, {
      basicInfo: { cover: 'https://example.com/cover.jpg' },
      crawler: { getImageContent: vi.fn(async () => Buffer.alloc(0)) },
    })

    await expect(book.getCoverContent()).rejects.toThrow('封面下载失败')
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
  it('stops scheduling items after cancellation', async () => {
    const controller = new AbortController()
    const started: number[] = []
    const task = asyncPool(1, [1, 2, 3], async (item) => {
      started.push(item)
      if (item === 1) controller.abort()
      return item
    }, controller.signal)

    await expect(task).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(started).toEqual([1])
  })

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
