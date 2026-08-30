import type {
  CrawlerRequestControlFactory,
  CrawlerRequestKind,
  WebCrawler,
} from './crawler'
import type { TitleFormat } from '../shared/config-types'
import type {
  BasicInfo,
  BookVersionFields,
  Chapter,
} from '../shared/book-types'
import { formatBookTitle } from '../shared/title-format'
import {
  createBookVersion,
  type BookSnapshot,
  type BookVersion,
} from './book-cache-model'
import type { BookResourceCache } from './book-cache-repository'
import {
  DownloadCancelledError,
  throwIfDownloadCancelled,
} from './download-cancellation'

export interface ParsedBookPage {
  basicInfo: BasicInfo
  chapterIndexUrl: string
  versionFields: BookVersionFields
}

interface ChapterImageLoad {
  controller: AbortController
  promise: Promise<string[] | null>
  waiters: Set<symbol>
}

function waitForChapterImages(
  entry: ChapterImageLoad,
  signal?: AbortSignal,
): Promise<string[] | null> {
  throwIfDownloadCancelled(signal)
  const waiter = Symbol('chapter-image-waiter')
  entry.waiters.add(waiter)
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      entry.waiters.delete(waiter)
      if (entry.waiters.size === 0 && !entry.controller.signal.aborted) {
        entry.controller.abort()
      }
    }
    const onAbort = (): void => {
      cleanup()
      reject(new DownloadCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    entry.promise.then(
      (urls) => {
        cleanup()
        resolve(urls)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export class Book {
  readonly bookId: string
  readonly version: BookVersion
  readonly legacyImportGenerationKey: string
  baseChapterUrl: string = ''
  volumes: Record<string, Chapter[]> = {}
  pictureUrls: Record<string, string> = {}
  basicInfo: BasicInfo = {
    '标题': '',
    '作者': '',
    '出版社': '',
    '最新章节': null,
    '连载状态': '',
    '更新时间': null,
    '全文长度': null,
    '简介': '',
    '标签': [],
    '动画化': false,
    '热度': null,
    'cover': null,
  }

  private readonly crawler: WebCrawler
  private readonly requestControlFactory?: CrawlerRequestControlFactory
  private readonly resources?: BookResourceCache
  private readonly chapterImageUrlCache = new Map<string, string[] | null>()
  private readonly chapterImageUrlLoads = new Map<string, ChapterImageLoad>()

  private constructor(
    bookId: string,
    crawler: WebCrawler,
    version: BookVersion,
    legacyImportGenerationKey: string,
    requestControlFactory?: CrawlerRequestControlFactory,
    resources?: BookResourceCache,
  ) {
    this.bookId = bookId
    this.crawler = crawler
    this.version = version
    this.legacyImportGenerationKey = legacyImportGenerationKey
    this.requestControlFactory = requestControlFactory
    this.resources = resources
  }

  get generationKey(): string {
    return this.version.generationKey
  }

  get versionFields(): BookVersionFields {
    return { ...this.version.fields }
  }

  static async create(
    bookId: string,
    crawler: WebCrawler,
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
    resources?: BookResourceCache,
  ): Promise<Book> {
    const page = await Book.fetchPage(bookId, crawler, signal, requestControlFactory)
    const version = createBookVersion(page.versionFields, Date.now())
    return Book.createFromPage(
      bookId,
      crawler,
      page,
      version,
      version.generationKey,
      signal,
      requestControlFactory,
      resources,
    )
  }

  static async fetchPage(
    bookId: string,
    crawler: WebCrawler,
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
  ): Promise<ParsedBookPage> {
    const version = createBookVersion({ updatedAt: '', latestChapter: '', status: '' }, 0)
    const parser = new Book(bookId, crawler, version, version.generationKey, requestControlFactory)
    const bookUrl = `https://www.wenku8.net/book/${bookId}.htm`
    const control = parser.requestControl('document', bookUrl)
    const $ = control
      ? await crawler.fetch(bookUrl, true, signal, control)
      : await crawler.fetch(bookUrl, true, signal)

    let rawChapterIndexUrl = ''
    $('#content div a').each((_i, element) => {
      const link = $(element)
      if (link.text().includes('小说目录') && link.attr('href')) {
        rawChapterIndexUrl = link.attr('href')!
        return false
      }
    })
    if (!rawChapterIndexUrl) throw new Error('未找到小说目录链接')

    const contentDiv = $('#content')
    const table = contentDiv.find('table').first()
    const title = table.find('b').first().text().trim()
    const cells: string[] = []
    table.find('tr').eq(2).find('td').each((_i, td) => cells.push($(td).text().trim()))

    let latestChapter: string | null = null
    let description = ''
    let tags: string[] = []
    let animated = false
    let heat: string | null = null
    $('#content span.hottext').each((_i, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim()
      if (/\bTags\s*[:：]/i.test(text)) {
        const values = text.split(/\bTags\s*[:：]/i).slice(1).join(':')
        const seen = new Set<string>()
        tags = values
          .split(/[\s,，、]+/)
          .map(value => value.trim())
          .filter(value => {
            if (!value || value.length > 50 || seen.has(value)) return false
            seen.add(value)
            return true
          })
          .slice(0, 30)
      }
      if (/已(?:动画|動畫)化/.test(text)) animated = true
      if (text.includes('作品热度') || text.includes('作品熱度')) {
        heat = text.split(/(?:作品热度|作品熱度)\s*[:：]/).slice(1).join(':').trim() || null
      }
      if (text.includes('最新章节') || text.includes('最近章节')) {
        const link = $(element).nextAll('span').first().find('a')
        if (link.length > 0) latestChapter = link.text().trim()
      }
      if (text.includes('内容简介')) {
        description = $(element).nextAll('span').first().text().trim()
      }
    })

    const basicInfo: BasicInfo = {
      '标题': title,
      '作者': cells[1]?.split('：')[1] || '',
      '出版社': cells[0]?.split('：')[1] || '',
      '最新章节': latestChapter,
      '连载状态': cells[2]?.split('：')[1] || '',
      '更新时间': cells[3]?.split('：')[1] || null,
      '全文长度': cells[4]?.split('：')[1] || null,
      '简介': description,
      '标签': tags,
      '动画化': animated,
      '热度': heat,
      'cover': contentDiv.find('img').first().attr('src') || null,
    }
    return {
      basicInfo,
      chapterIndexUrl: new URL(rawChapterIndexUrl, bookUrl).toString(),
      versionFields: {
        updatedAt: basicInfo['更新时间'] ?? '',
        latestChapter: basicInfo['最新章节'] ?? '',
        status: basicInfo['连载状态'],
      },
    }
  }

  static async createFromPage(
    bookId: string,
    crawler: WebCrawler,
    page: ParsedBookPage,
    version: BookVersion,
    legacyImportGenerationKey: string,
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
    resources?: BookResourceCache,
  ): Promise<Book> {
    const book = new Book(
      bookId,
      crawler,
      version,
      legacyImportGenerationKey,
      requestControlFactory,
      resources,
    )
    const control = book.requestControl('document', page.chapterIndexUrl)
    const $ = control
      ? await crawler.fetch(page.chapterIndexUrl, true, signal, control)
      : await crawler.fetch(page.chapterIndexUrl, true, signal)
    const volumes: Record<string, Chapter[]> = {}
    let currentVolume = ''
    $('table.css tr').each((_i, tr) => {
      const volumeCell = $(tr).find('td.vcss')
      if (volumeCell.length > 0) {
        currentVolume = volumeCell.text().trim()
        volumes[currentVolume] = []
        return
      }
      $(tr).find('a').each((_j, anchor) => {
        const name = $(anchor).text().trim()
        const link = $(anchor).attr('href')
        if (currentVolume && name && link) volumes[currentVolume].push({ name, link })
      })
    })
    book.baseChapterUrl = new URL('.', page.chapterIndexUrl).toString()
    book.volumes = volumes
    book.pictureUrls = book.buildPictureUrlMap()
    book.basicInfo = { ...page.basicInfo, '标签': [...page.basicInfo['标签']] }
    return book
  }

  static fromSnapshot(
    snapshot: BookSnapshot,
    crawler: WebCrawler,
    requestControlFactory?: CrawlerRequestControlFactory,
    resources?: BookResourceCache,
  ): Book {
    const book = new Book(
      snapshot.bookId,
      crawler,
      snapshot.version,
      snapshot.legacyImportGenerationKey,
      requestControlFactory,
      resources,
    )
    book.baseChapterUrl = snapshot.baseChapterUrl
    book.volumes = Object.fromEntries(
      Object.entries(snapshot.volumes).map(([name, chapters]) => [
        name,
        chapters.map(chapter => ({ ...chapter })),
      ]),
    )
    book.pictureUrls = book.buildPictureUrlMap()
    book.basicInfo = { ...snapshot.basicInfo, '标签': [...snapshot.basicInfo['标签']] }
    return book
  }

  toSnapshot(checkedAt: number): BookSnapshot {
    return {
      schemaVersion: 2,
      bookId: this.bookId,
      checkedAt,
      version: {
        fields: { ...this.version.fields },
        generationKey: this.version.generationKey,
        stable: this.version.stable,
      },
      legacyImportGenerationKey: this.legacyImportGenerationKey,
      baseChapterUrl: this.baseChapterUrl,
      volumes: Object.fromEntries(
        Object.entries(this.volumes).map(([name, chapters]) => [
          name,
          chapters.map(chapter => ({ ...chapter })),
        ]),
      ),
      basicInfo: { ...this.basicInfo, '标签': [...this.basicInfo['标签']] },
    }
  }

  private requestControl(
    kind: CrawlerRequestKind,
    url: string,
    requestControlFactory = this.requestControlFactory,
  ) {
    if (!requestControlFactory) return undefined
    let absoluteUrl = url
    try {
      absoluteUrl = new URL(url, 'https://www.wenku8.net/').toString()
    } catch {
      // WebCrawler surfaces malformed URLs; the scheduler still receives a bounded key.
    }
    return requestControlFactory(kind, absoluteUrl)
  }

  private buildPictureUrlMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [volumeName, chapters] of Object.entries(this.volumes)) {
      const illustration = chapters.find(chapter => chapter.name === '插图')
      if (illustration) map[volumeName] = illustration.link
    }
    return map
  }

  async getChapterImageUrls(
    volumeName?: string,
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
  ): Promise<string[] | null> {
    if (!volumeName) return null
    throwIfDownloadCancelled(signal)
    if (this.chapterImageUrlCache.has(volumeName)) {
      return this.cloneUrls(this.chapterImageUrlCache.get(volumeName) ?? null)
    }
    const pictureUrl = this.pictureUrls[volumeName]
    if (!pictureUrl) return null
    const url = new URL(pictureUrl, this.baseChapterUrl).toString()
    let entry = this.chapterImageUrlLoads.get(volumeName)
    if (entry?.controller.signal.aborted) {
      this.chapterImageUrlLoads.delete(volumeName)
      entry = undefined
    }
    if (!entry) {
      const controller = new AbortController()
      const promise = this.loadChapterImageUrls(url, controller.signal, requestControlFactory)
      const created: ChapterImageLoad = { controller, promise, waiters: new Set() }
      entry = created
      this.chapterImageUrlLoads.set(volumeName, created)
      promise.then(
        (urls) => {
          if (this.chapterImageUrlLoads.get(volumeName) !== created) return
          this.chapterImageUrlLoads.delete(volumeName)
          if (created.controller.signal.aborted) return
          this.chapterImageUrlCache.set(volumeName, this.cloneUrls(urls))
        },
        () => {
          if (this.chapterImageUrlLoads.get(volumeName) === created) {
            this.chapterImageUrlLoads.delete(volumeName)
          }
        },
      )
    }
    return this.cloneUrls(await waitForChapterImages(entry, signal))
  }

  private async loadChapterImageUrls(
    url: string,
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
  ): Promise<string[] | null> {
    const guard = this.resources?.captureResourceWriteGuard(this.bookId, this.generationKey)
    const cached = await this.resources?.loadIllustration(this.bookId, this.generationKey, url)
    if (cached !== undefined) return cached
    const control = this.requestControl('document', url, requestControlFactory)
    const $ = control
      ? await this.crawler.fetch(url, true, signal, control)
      : await this.crawler.fetch(url, true, signal)
    const urls: string[] = []
    $('img').each((_i, image) => {
      const source = $(image).attr('src')
      if (!source) return
      try {
        urls.push(new URL(source, url).toString())
      } catch {
        // Ignore malformed illustration sources.
      }
    })
    const result = urls.length > 0 ? urls : null
    if (guard) {
      await this.resources?.saveIllustration(
        this.bookId,
        this.generationKey,
        url,
        result,
        guard,
      )
    }
    return result
  }

  async getCoverContent(
    signal?: AbortSignal,
    requestControlFactory?: CrawlerRequestControlFactory,
  ): Promise<Buffer> {
    const rawCoverUrl = this.basicInfo['cover']
    if (!rawCoverUrl) throw new Error('无封面图片')
    const coverUrl = new URL(rawCoverUrl, `https://www.wenku8.net/book/${this.bookId}.htm`).toString()
    const guard = this.resources?.captureResourceWriteGuard(this.bookId, this.generationKey)
    const cached = await this.resources?.loadCover(this.bookId, this.generationKey, coverUrl)
    if (cached) return Buffer.from(cached)
    const control = this.requestControl('image', coverUrl, requestControlFactory)
    const content = control
      ? await this.crawler.getImageContent(coverUrl, 3, undefined, signal, control)
      : await this.crawler.getImageContent(coverUrl, 3, undefined, signal)
    if (!content || content.byteLength === 0) throw new Error('封面下载失败')
    if (guard) {
      await this.resources?.saveCover(
        this.bookId,
        this.generationKey,
        coverUrl,
        content,
        guard,
      )
    }
    return content
  }

  private cloneUrls(urls: string[] | null): string[] | null {
    return urls ? [...urls] : null
  }

  getFormattedTitle(format: TitleFormat): string {
    return formatBookTitle(this.basicInfo['标题'], format)
  }
}
