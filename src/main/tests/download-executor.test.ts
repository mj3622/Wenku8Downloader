import { describe, expect, it, vi } from 'vitest'
import { DownloadCancelledError } from '../download-cancellation'
import type { CrawlerRequestControlFactory } from '../crawler'
import type { DownloadAssetCache, DownloadCacheContext } from '../cache/download-asset-cache'
import type { DownloadProgress } from '../downloader'
import {
  createDownloadExecutor,
  toSafeDownloadErrorMessage,
  toSafeDownloadWarningMessage,
  type DownloadExecutorBook,
  type DownloadExecutionTask,
  type DownloadRunner,
} from '../download-executor'

const CACHE_KEY = 'a'.repeat(64)

function task(overrides: Partial<DownloadExecutionTask> = {}): DownloadExecutionTask {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    bookId: '100',
    title: '测试作品',
    type: 'epub_full',
    status: 'downloading',
    progress: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function book(overrides: Partial<DownloadExecutorBook> = {}): DownloadExecutorBook {
  return {
    bookId: '100',
    baseChapterUrl: '//www.wenku8.net/novel/1/100/',
    volumes: { '第一卷': [{ name: '插图', link: 'illustrations.htm' }] },
    pictureUrls: { '第一卷': 'illustrations.htm' },
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
    getFormattedTitle: () => '测试作品',
    getChapterImageUrls: vi.fn(async () => ['https://example.com/1.jpg']),
    getCoverContent: vi.fn(async () => Buffer.from('cover')),
    ...overrides,
    generationKey: overrides.generationKey ?? CACHE_KEY,
    legacyImportGenerationKey: overrides.legacyImportGenerationKey ?? CACHE_KEY,
  }
}

function setup(
  targetBook: DownloadExecutorBook | Promise<DownloadExecutorBook> = book(),
  assetCache?: DownloadAssetCache,
) {
  const setOnProgress = vi.fn()
  const downloadNovel = vi.fn(async () => undefined)
  const downloadPictures = vi.fn(async () => undefined)
  const getWarnings = vi.fn(() => [] as string[])
  const createArtifactRecord = vi.fn(async record => record)
  const runner: DownloadRunner = {
    setOnProgress,
    downloadNovel,
    downloadPictures,
    getWarnings,
  }
  const createDownloader = vi.fn(() => runner)
  const loadBook = vi.fn<(
    bookId: string,
    signal: AbortSignal,
    requestControlFactory: CrawlerRequestControlFactory,
    onThrottleWait: (waitMs: number) => void,
  ) => Promise<DownloadExecutorBook>>(async () => targetBook)
  const executor = createDownloadExecutor({
    config: {
      getDownloadSnapshot: () => ({
        fullTitle: 'FULL',
        defaultCoverIndex: 0,
        downloadPath: '',
      }),
    },
    crawler: {
      fetch: vi.fn(),
      getImageContent: vi.fn(async () => null),
    },
    loadBook,
    environment: {
      isPackaged: true,
      downloadsPath: '/downloads',
      devRoot: '/repo',
    },
    createDownloader,
    createArtifactRecord,
    ...(assetCache ? { assetCache } : {}),
  })
  return {
    executor,
    runner,
    createDownloader,
    downloadNovel,
    downloadPictures,
    setOnProgress,
    getWarnings,
    createArtifactRecord,
    loadBook,
  }
}

describe('createDownloadExecutor', () => {
  it('executes an EPUB task with immutable runtime config and signal', async () => {
    const { executor, createDownloader, downloadNovel, setOnProgress } = setup()
    const controller = new AbortController()
    const onProgress = vi.fn()
    const onVolumeCover = vi.fn()

    await expect(executor.execute(task(), {
      signal: controller.signal,
      onProgress,
      onVolumeCover,
    })).resolves.toEqual({
      warnings: [],
      artifacts: [{
        id: 'primary',
        name: '100_测试作品.epub',
        kind: 'file',
        path: '/downloads/Wenku8Downloader/novels/100_测试作品.epub',
        rootPath: '/downloads/Wenku8Downloader',
      }],
    })

    expect(createDownloader).toHaveBeenCalledWith(
      expect.anything(),
      {
        fullTitle: 'FULL',
        defaultCoverIndex: 0,
        downloadPath: '',
        rootPath: '/downloads/Wenku8Downloader',
      },
      {
        logContext: {
          operationId: '123e4567-e89b-42d3-a456-426614174000',
          taskId: '123e4567-e89b-42d3-a456-426614174000',
        },
        signal: controller.signal,
        onVolumeCover,
        rateLimiter: expect.anything(),
      },
    )
    expect(setOnProgress).toHaveBeenCalledWith(expect.any(Function))
    expect(downloadNovel).toHaveBeenCalledWith(expect.anything(), undefined)
  })

  it('keeps the download root captured when the task was created', async () => {
    const { executor, createDownloader, createArtifactRecord } = setup()

    await executor.execute(task({ downloadRoot: '/created/download-root' }), {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })

    expect(createDownloader).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rootPath: '/created/download-root' }),
      expect.anything(),
    )
    expect(createArtifactRecord).toHaveBeenCalledWith(expect.objectContaining({
      path: '/created/download-root/novels/100_测试作品.epub',
      rootPath: '/created/download-root',
    }))
  })

  it('holds one generation lease for the complete image task', async () => {
    const release = vi.fn(async () => undefined)
    const cacheContext = {
      bookId: '100',
      generationKey: CACHE_KEY,
      allowLegacyImport: true,
      lease: { bookId: '100', generationKey: CACHE_KEY, leaseId: 'lease', release },
    } satisfies DownloadCacheContext
    const acquire = vi.fn(() => cacheContext)
    const taskGuard = { epoch: 7 }
    const captureTaskGuard = vi.fn(() => taskGuard)
    const assetCache = { acquire, captureTaskGuard } as unknown as DownloadAssetCache
    const getChapterImageUrls = vi.fn(async () => {
      expect(acquire).toHaveBeenCalledTimes(1)
      expect(release).not.toHaveBeenCalled()
      return ['https://example.com/1.jpg']
    })
    const { executor, createDownloader } = setup(book({ getChapterImageUrls }), assetCache)

    await executor.execute(task({ type: 'images', volume: '第一卷' }), {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })

    expect(captureTaskGuard).toHaveBeenCalledTimes(1)
    expect(acquire).toHaveBeenCalledWith('100', CACHE_KEY, CACHE_KEY, taskGuard)
    expect(createDownloader).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ assetCache, cacheContext }),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('cancels the task-owned book load before starting the next stage', async () => {
    const controller = new AbortController()
    let loadSignal: AbortSignal | undefined
    const { executor, createDownloader, loadBook } = setup()
    loadBook.mockImplementation((_bookId, signal) => {
      loadSignal = signal
      return new Promise<DownloadExecutorBook>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DownloadCancelledError()), { once: true })
      })
    })
    const execution = executor.execute(task(), {
      signal: controller.signal,
      onProgress: vi.fn(),
    })

    await vi.waitFor(() => expect(loadBook).toHaveBeenCalledWith(
      '100',
      controller.signal,
      expect.any(Function),
      expect.any(Function),
    ))
    controller.abort()
    await expect(execution).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(loadSignal?.aborted).toBe(true)
    expect(createDownloader).not.toHaveBeenCalled()
  })

  it('publishes throttle waits reported while loading shared book metadata', async () => {
    const { executor, loadBook } = setup()
    loadBook.mockImplementation(async (_bookId, _signal, _factory, onThrottleWait) => {
      onThrottleWait(120_000)
      return book()
    })
    const onProgress = vi.fn()

    await executor.execute(task(), {
      signal: new AbortController().signal,
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: '服务器限流，已自动减速，约 120 秒后继续',
    }))
  })

  it('executes image downloads for one selected volume', async () => {
    const targetBook = book()
    const { executor, downloadPictures } = setup(targetBook)
    const controller = new AbortController()
    const onVolumeCover = vi.fn()

    const result = await executor.execute(task({ type: 'images', volume: '第一卷' }), {
      signal: controller.signal,
      onProgress: vi.fn<(progress: DownloadProgress) => void>(),
      onVolumeCover,
    })

    expect(targetBook.getChapterImageUrls).toHaveBeenCalledWith('第一卷', controller.signal)
    expect(downloadPictures).toHaveBeenCalledWith(
      ['https://example.com/1.jpg'],
      '第一卷',
      '测试作品',
      '100',
      CACHE_KEY,
      CACHE_KEY,
      0,
    )
    expect(onVolumeCover).toHaveBeenCalledWith('https://example.com/1.jpg')
    expect(result.artifacts).toEqual([{
      id: 'primary',
      name: '1_第一卷',
      kind: 'directory',
      path: '/downloads/Wenku8Downloader/pics/100_测试作品/1_第一卷',
      rootPath: '/downloads/Wenku8Downloader',
    }])
  })

  it('keeps partial warnings while downloading images for all volumes', async () => {
    const targetBook = book({
      volumes: {
        '第一卷': [{ name: '插图', link: 'first.htm' }],
        '第二卷': [{ name: '插图', link: 'second.htm' }],
      },
      pictureUrls: { '第一卷': 'first.htm', '第二卷': 'second.htm' },
      getChapterImageUrls: vi.fn(async (volumeName?: string) => (
        volumeName === '第一卷' ? ['https://example.com/1.jpg'] : null
      )),
    })
    const { executor, downloadPictures, getWarnings } = setup(targetBook)
    getWarnings.mockReturnValue(['封面未能下载，正文内容仍已保存。'])

    await expect(executor.execute(task({ type: 'images' }), {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })).resolves.toEqual({
      warnings: [
        '封面未能下载，正文内容仍已保存。',
        '“第二卷”没有可保存的插图。',
      ],
      artifacts: [{
        id: 'primary',
        name: '100_测试作品',
        kind: 'directory',
        path: '/downloads/Wenku8Downloader/pics/100_测试作品',
        rootPath: '/downloads/Wenku8Downloader',
      }],
    })
    expect(downloadPictures).toHaveBeenCalledTimes(1)
  })

  it('reports all-volume image progress across volumes instead of restarting at one hundred percent', async () => {
    const targetBook = book({
      volumes: {
        '第一卷': [{ name: '插图', link: 'first.htm' }],
        '第二卷': [{ name: '插图', link: 'second.htm' }],
      },
      pictureUrls: { '第一卷': 'first.htm', '第二卷': 'second.htm' },
      getChapterImageUrls: vi.fn(async (volumeName?: string) => (
        [`https://example.com/${volumeName}.jpg`]
      )),
    })
    const { executor, downloadPictures, setOnProgress } = setup(targetBook)
    const onProgress = vi.fn<(progress: DownloadProgress) => void>()
    downloadPictures.mockImplementation(async () => {
      const reportProgress = setOnProgress.mock.calls.at(-1)?.[0]
      reportProgress?.({ current: 1, total: 1, phase: '正在下载图片' })
    })

    await executor.execute(task({ type: 'images' }), {
      signal: new AbortController().signal,
      onProgress,
    })

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { current: 0, total: 2, phase: '正在准备插图 (第一卷)' },
      { current: 1, total: 2, phase: '正在下载图片' },
      { current: 1, total: 2, phase: '正在准备插图 (第二卷)' },
      { current: 2, total: 2, phase: '正在下载图片' },
    ])
  })

  it('does not turn a native abort on the last illustration page into partial success', async () => {
    const controller = new AbortController()
    const targetBook = book({
      volumes: {
        '第一卷': [{ name: '插图', link: 'first.htm' }],
        '第二卷': [{ name: '插图', link: 'second.htm' }],
      },
      pictureUrls: { '第一卷': 'first.htm', '第二卷': 'second.htm' },
      getChapterImageUrls: vi.fn(async (volumeName?: string) => {
        if (volumeName === '第一卷') return ['https://example.com/1.jpg']
        return new Promise<string[]>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        })
      }),
    })
    const { executor, downloadPictures } = setup(targetBook)
    const execution = executor.execute(task({ type: 'images' }), {
      signal: controller.signal,
      onProgress: vi.fn(),
    })
    await vi.waitFor(() => expect(targetBook.getChapterImageUrls).toHaveBeenCalledTimes(2))

    controller.abort()

    await expect(execution).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(downloadPictures).toHaveBeenCalledTimes(1)
  })
})

describe('safe download messages', () => {
  it.each([
    new Error('C:\\Users\\tester\\downloads 写入失败'),
    new Error("Error invoking remote method 'download:images': internal failure"),
    new Error('https://example.com/file?token=secret'),
  ])('replaces technical errors with a generic message', (error) => {
    expect(toSafeDownloadErrorMessage(error)).toBe(
      '下载未能完成，请检查网络和下载设置后重试。',
    )
  })

  it('maps known domain failures without retaining raw technical details', () => {
    expect(toSafeDownloadErrorMessage(new Error('HTTP 403 Cookie expired')))
      .toBe('请前往配置页重新登录，然后再试一次。')
    expect(toSafeDownloadErrorMessage(new Error('ENOSPC: /secret/path')))
      .toBe('请清理磁盘空间或更换下载目录后重试。')
  })

  it('only preserves known partial-content warning forms', () => {
    expect(toSafeDownloadWarningMessage('“第一卷”有 2 张插图未能下载，已保存其余内容。'))
      .toBe('“第一卷”有 2 张插图未能下载，已保存其余内容。')
    expect(toSafeDownloadWarningMessage('C:\\Users\\tester\\cover.jpg?token=secret'))
      .toBe('部分附加内容未能保存，正文或其他已完成内容仍然可用。')
  })
})
