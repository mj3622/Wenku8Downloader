import * as cheerio from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import type { WebCrawler } from '../crawler'
import { Book } from '../book'
import { createBookVersion, type BookSnapshot } from '../book-cache-model'
import type { BookResourceCache } from '../book-cache-repository'

describe('Book.create', () => {
  it('parses detail tags, animation status and heat with bounded normalized tags', async () => {
    const rawTags = [
      ' 校园 ', '青春', '校园',
      ...Array.from({ length: 30 }, (_, index) => `标签${index + 1}`),
      'x'.repeat(51),
    ].join(' ')
    const bookPage = cheerio.load(`
      <div id="content">
        <div><a href="/novel/1/100/index.htm">小说目录</a></div>
        <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
          <td>文库：测试</td><td>作者：测试作者</td><td>状态：连载</td>
          <td>更新：2026-08-29</td><td>长度：100</td>
        </tr></table>
        <span class="hottext"><b>本作已动画化(含OVA/剧场版)</b></span>
        <span class="hottext">作品Tags：${rawTags}</span>
        <span class="hottext">作品热度：S级，当前热度上升指数为：A级</span>
      </div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr></table>
    `)
    const crawler = {
      fetch: vi.fn().mockResolvedValueOnce(bookPage).mockResolvedValueOnce(chapterPage),
    } as unknown as WebCrawler

    const book = await Book.create('100', crawler)

    expect(book.basicInfo['动画化']).toBe(true)
    expect(book.basicInfo['热度']).toBe('S级，当前热度上升指数为：A级')
    expect(book.basicInfo['标签']).toHaveLength(30)
    expect(book.basicInfo['标签'].slice(0, 3)).toEqual(['校园', '青春', '标签1'])
    expect(book.basicInfo['标签']).not.toContain('x'.repeat(51))
  })

  it('passes the task cancellation signal through every metadata request', async () => {
    const bookPage = cheerio.load(`
      <div id="content">
        <div><a href="/novel/1/100/index.htm">小说目录</a></div>
        <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
          <td>文库：测试</td><td>作者：测试作者</td><td>状态：完结</td>
        </tr></table>
      </div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="1.htm">第一章</a></td></tr></table>
    `)
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
    const crawler = { fetch } as unknown as WebCrawler
    const controller = new AbortController()
    const control = {}
    const requestControlFactory = vi.fn(() => control)

    await Book.create('100', crawler, controller.signal, requestControlFactory)

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://www.wenku8.net/book/100.htm',
      true,
      controller.signal,
      control,
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://www.wenku8.net/novel/1/100/index.htm',
      true,
      controller.signal,
      control,
    )
    expect(requestControlFactory.mock.calls).toEqual([
      ['document', 'https://www.wenku8.net/book/100.htm'],
      ['document', 'https://www.wenku8.net/novel/1/100/index.htm'],
    ])
  })

  it('reuses resolved illustration URLs for the same volume', async () => {
    const bookPage = cheerio.load(`
      <div id="content">
        <div><a href="https://www.wenku8.net/novel/1/100/index.htm">小说目录</a></div>
        <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
          <td>文库：测试</td><td>作者：测试作者</td><td>状态：完结</td>
        </tr></table>
      </div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="illustrations.htm">插图</a></td></tr></table>
    `)
    const illustrationPage = cheerio.load(`
      <img src="https://example.com/volume-1-cover.jpg">
    `)
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
      .mockResolvedValueOnce(illustrationPage)
    const crawler = { fetch } as unknown as WebCrawler
    const control = {}
    const requestControlFactory = vi.fn(() => control)
    const book = await Book.create('100', crawler, undefined, requestControlFactory)
    const taskControl = {}
    const taskRequestControlFactory = vi.fn(() => taskControl)

    await expect(book.getChapterImageUrls(
      '第一卷',
      undefined,
      taskRequestControlFactory,
    )).resolves.toEqual([
      'https://example.com/volume-1-cover.jpg',
    ])
    await expect(book.getChapterImageUrls('第一卷')).resolves.toEqual([
      'https://example.com/volume-1-cover.jpg',
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch).toHaveBeenLastCalledWith(
      'https://www.wenku8.net/novel/1/100/illustrations.htm',
      true,
      expect.any(AbortSignal),
      taskControl,
    )
    expect(taskRequestControlFactory).toHaveBeenCalledWith(
      'document',
      'https://www.wenku8.net/novel/1/100/illustrations.htm',
    )
  })

  it('deduplicates in-flight illustration page requests', async () => {
    const bookPage = cheerio.load(`
      <div id="content"><div><a href="/novel/1/100/index.htm">小说目录</a></div>
      <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
      <td>文库：测试</td><td>作者：作者</td><td>状态：连载</td></tr></table></div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="illustrations.htm">插图</a></td></tr></table>
    `)
    const illustrationPage = cheerio.load('<img src="https://img.example/1.jpg">')
    let resolveIllustration!: (value: typeof illustrationPage) => void
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveIllustration = resolve
      }))
    const book = await Book.create('100', { fetch } as unknown as WebCrawler)

    const first = book.getChapterImageUrls('第一卷')
    const second = book.getChapterImageUrls('第一卷')
    await Promise.resolve()
    resolveIllustration(illustrationPage)

    await expect(first).resolves.toEqual(['https://img.example/1.jpg'])
    await expect(second).resolves.toEqual(['https://img.example/1.jpg'])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('keeps a shared illustration request alive when one waiter cancels', async () => {
    const bookPage = cheerio.load(`
      <div id="content"><div><a href="/novel/1/100/index.htm">小说目录</a></div>
      <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
      <td>文库：测试</td><td>作者：作者</td><td>状态：连载</td></tr></table></div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="illustrations.htm">插图</a></td></tr></table>
    `)
    const illustrationPage = cheerio.load('<img src="https://img.example/1.jpg">')
    let resolveIllustration!: (value: typeof illustrationPage) => void
    let sharedSignal!: AbortSignal
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
      .mockImplementationOnce((_url, _parse, signal: AbortSignal) => {
        sharedSignal = signal
        return new Promise(resolve => {
          resolveIllustration = resolve
        })
      })
    const book = await Book.create('100', { fetch } as unknown as WebCrawler)
    const controller = new AbortController()

    const cancelled = book.getChapterImageUrls('第一卷', controller.signal)
    const shared = book.getChapterImageUrls('第一卷')
    controller.abort()

    await expect(cancelled).rejects.toThrow('下载已取消')
    expect(sharedSignal.aborted).toBe(false)
    resolveIllustration(illustrationPage)
    await expect(shared).resolves.toEqual(['https://img.example/1.jpg'])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('restores a complete book from a snapshot without network access', () => {
    const version = createBookVersion({
      updatedAt: '2026-08-29', latestChapter: '第一章', status: '连载',
    }, 1_000)
    const snapshot: BookSnapshot = {
      schemaVersion: 2,
      bookId: '100',
      checkedAt: 1_000,
      version,
      legacyImportGenerationKey: version.generationKey,
      baseChapterUrl: 'https://www.wenku8.net/novel/1/100/',
      volumes: { 第一卷: [{ name: '插图', link: 'illustrations.htm' }] },
      basicInfo: {
        '标题': '测试作品', '作者': '作者', '出版社': '文库', '最新章节': '第一章',
        '连载状态': '连载', '更新时间': '2026-08-29', '全文长度': '1',
        '简介': '简介', 'cover': null,
        '标签': [], '动画化': false, '热度': null,
      },
    }
    const fetch = vi.fn()
    const book = Book.fromSnapshot(snapshot, { fetch } as unknown as WebCrawler)

    expect(book.toSnapshot(1_000)).toEqual(snapshot)
    expect(book.pictureUrls).toEqual({ 第一卷: 'illustrations.htm' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('captures resource guards before cache reads so clear invalidates old requests', async () => {
    const version = createBookVersion({
      updatedAt: '2026-08-29', latestChapter: '第一章', status: '连载',
    }, 1_000)
    const snapshot: BookSnapshot = {
      schemaVersion: 2,
      bookId: '100',
      checkedAt: 1_000,
      version,
      legacyImportGenerationKey: version.generationKey,
      baseChapterUrl: 'https://www.wenku8.net/novel/1/100/',
      volumes: { 第一卷: [{ name: '插图', link: 'illustrations.htm' }] },
      basicInfo: {
        '标题': '测试作品', '作者': '作者', '出版社': '文库', '最新章节': '第一章',
        '连载状态': '连载', '更新时间': '2026-08-29', '全文长度': '1',
        '简介': '简介', 'cover': 'https://img.example/cover.jpg',
        '标签': [], '动画化': false, '热度': null,
      },
    }
    let epoch = 0
    let resolveIllustrationCache!: (value: string[] | null | undefined) => void
    let resolveCoverCache!: (value: Buffer | null) => void
    const illustrationCache = new Promise<string[] | null | undefined>(resolve => {
      resolveIllustrationCache = resolve
    })
    const coverCache = new Promise<Buffer | null>(resolve => {
      resolveCoverCache = resolve
    })
    const captureResourceWriteGuard = vi.fn(() => ({ epoch }))
    const saveIllustration = vi.fn<BookResourceCache['saveIllustration']>(
      async (_bookId, _generationKey, _pageUrl, _urls, guard) => guard.epoch === epoch,
    )
    const saveCover = vi.fn<BookResourceCache['saveCover']>(
      async (_bookId, _generationKey, _coverUrl, _data, guard) => guard.epoch === epoch,
    )
    const resources: BookResourceCache = {
      captureResourceWriteGuard,
      loadIllustration: vi.fn(() => illustrationCache),
      saveIllustration,
      loadCover: vi.fn(() => coverCache),
      saveCover,
    }
    const illustrationPage = cheerio.load('<img src="https://img.example/1.jpg">')
    const crawler = {
      fetch: vi.fn().mockResolvedValue(illustrationPage),
      getImageContent: vi.fn().mockResolvedValue(Buffer.from('cover')),
    } as unknown as WebCrawler
    const book = Book.fromSnapshot(snapshot, crawler, undefined, resources)

    const illustration = book.getChapterImageUrls('第一卷')
    const cover = book.getCoverContent()
    expect(captureResourceWriteGuard).toHaveBeenCalledTimes(2)

    epoch++
    resolveIllustrationCache(undefined)
    resolveCoverCache(null)

    await expect(illustration).resolves.toEqual(['https://img.example/1.jpg'])
    await expect(cover).resolves.toEqual(Buffer.from('cover'))
    expect(saveIllustration).toHaveBeenCalledWith(
      '100',
      version.generationKey,
      'https://www.wenku8.net/novel/1/100/illustrations.htm',
      ['https://img.example/1.jpg'],
      { epoch: 0 },
    )
    expect(saveCover).toHaveBeenCalledWith(
      '100',
      version.generationKey,
      'https://img.example/cover.jpg',
      Buffer.from('cover'),
      { epoch: 0 },
    )
    expect(await saveIllustration.mock.results[0]?.value).toBe(false)
    expect(await saveCover.mock.results[0]?.value).toBe(false)
  })
})
