import { describe, expect, it, vi } from 'vitest'
import type { DownloadTask } from '../../shared/ipc-types'
import { DownloadCancelledError } from '../download-cancellation'
import type { DownloadProgress } from '../downloader'
import {
  createDownloadExecutor,
  toSafeDownloadErrorMessage,
  toSafeDownloadWarningMessage,
  type DownloadExecutorBook,
  type DownloadRunner,
} from '../download-executor'

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
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
    baseChapterUrl: 'https://www.wenku8.net/novel/1/100/',
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
  }
}

function setup(
  targetBook: DownloadExecutorBook | Promise<DownloadExecutorBook> = book(),
) {
  const setOnProgress = vi.fn()
  const downloadNovel = vi.fn(async () => undefined)
  const downloadPictures = vi.fn(async () => undefined)
  const getWarnings = vi.fn(() => [] as string[])
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
  })
  return {
    executor,
    runner,
    createDownloader,
    downloadNovel,
    downloadPictures,
    setOnProgress,
    getWarnings,
    loadBook,
  }
}

describe('createDownloadExecutor', () => {
  it('executes an EPUB task with immutable runtime config and signal', async () => {
    const { executor, createDownloader, downloadNovel, setOnProgress } = setup()
    const controller = new AbortController()
    const onProgress = vi.fn()

    await expect(executor.execute(task(), {
      signal: controller.signal,
      onProgress,
    })).resolves.toEqual({ warnings: [] })

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
      },
    )
    expect(setOnProgress).toHaveBeenCalledWith(onProgress)
    expect(downloadNovel).toHaveBeenCalledWith(expect.anything(), undefined)
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

    await vi.waitFor(() => expect(loadBook).toHaveBeenCalledWith('100', controller.signal))
    controller.abort()
    await expect(execution).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(loadSignal?.aborted).toBe(true)
    expect(createDownloader).not.toHaveBeenCalled()
  })

  it('executes image downloads for one selected volume', async () => {
    const targetBook = book()
    const { executor, downloadPictures } = setup(targetBook)
    const controller = new AbortController()

    await executor.execute(task({ type: 'images', volume: '第一卷' }), {
      signal: controller.signal,
      onProgress: vi.fn<(progress: DownloadProgress) => void>(),
    })

    expect(targetBook.getChapterImageUrls).toHaveBeenCalledWith('第一卷', controller.signal)
    expect(downloadPictures).toHaveBeenCalledWith(
      ['https://example.com/1.jpg'],
      '第一卷',
      '测试作品',
      '100',
      0,
    )
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
    })
    expect(downloadPictures).toHaveBeenCalledTimes(1)
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
