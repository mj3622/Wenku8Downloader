import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { EpubBuilder, escapeXml, guessMediaType } from './epub-builder'
import type { Book } from './book'
import type { WebCrawler } from './crawler'
import type { EpubChapter, EpubImage } from './epub-builder'
import { sleep } from './utils'
import { imageExtensionFromUrl, resolveWithin, safePathSegment } from './path-safety'
import { DownloadRateLimiter, sharedDownloadRateLimiter } from './download-rate-limiter'
import { migrateLegacyVolumeCache } from './legacy-cache-migration'
import type { DownloadConfig } from '../shared/config-types'

export interface DownloadRuntimeConfig extends DownloadConfig {
  rootPath: string
}

export type DownloaderCrawler = Pick<WebCrawler, 'fetch' | 'getImageContent'>

export type DownloaderBook = Pick<
  Book,
  | 'bookId'
  | 'baseChapterUrl'
  | 'volumes'
  | 'basicInfo'
  | 'getFormattedTitle'
  | 'getChapterImageUrls'
  | 'getCoverContent'
>

export function resolveDownloadRoot(
  config: DownloadConfig,
  environment: {
    isPackaged: boolean
    downloadsPath: string
    devRoot: string
  },
): string {
  if (config.downloadPath) return config.downloadPath
  return environment.isPackaged
    ? join(environment.downloadsPath, 'Wenku8Downloader')
    : join(environment.devRoot, 'downloads')
}

export type DownloadProgress = {
  current: number
  total: number
  phase: string
}

export function buildBookKey(bookTitle: string, bookId: string): string {
  return safePathSegment(`${bookId}_${bookTitle}`, `book-${bookId}`)
}

export function buildVolumeKey(volumeName: string, volumeIndex: number): string {
  return `${volumeIndex + 1}_${safePathSegment(volumeName, 'volume')}`
}

// ---- 下载缓存：支持断点续传 ----

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时后缓存自动失效

function cacheRoot(rootPath: string): string {
  return resolveWithin(rootPath, '.cache')
}

function bookCacheDir(rootPath: string, bookId: string): string {
  return resolveWithin(cacheRoot(rootPath), safePathSegment(bookId, 'book'))
}

interface CachedChapter { title: string; content: string }

async function saveChapterCache(
  rootPath: string,
  bookId: string,
  vol: string,
  idx: number,
  ch: CachedChapter,
): Promise<void> {
  const p = resolveWithin(bookCacheDir(rootPath, bookId), 'chapters', safePathSegment(vol, 'volume'), `${idx}.json`)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(ch), 'utf-8')
}

async function loadChapterCache(
  rootPath: string,
  bookId: string,
  vol: string,
  idx: number,
): Promise<CachedChapter | null> {
  const p = resolveWithin(bookCacheDir(rootPath, bookId), 'chapters', safePathSegment(vol, 'volume'), `${idx}.json`)
  try {
    if (Date.now() - (await stat(p)).mtimeMs > CACHE_TTL_MS) return null
    return JSON.parse(await readFile(p, 'utf-8'))
  } catch {
    return null
  }
}

async function saveImageCache(
  rootPath: string,
  bookId: string,
  vol: string,
  idx: number,
  data: Buffer,
  ext: string,
): Promise<void> {
  const dir = resolveWithin(bookCacheDir(rootPath, bookId), 'images', safePathSegment(vol, 'volume'))
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(join(dir, `${idx}.bin`), data),
    writeFile(join(dir, `${idx}.meta`), ext, 'utf-8'),
  ])
}

async function loadImageCache(
  rootPath: string,
  bookId: string,
  vol: string,
  idx: number,
): Promise<{ data: Buffer; ext: string } | null> {
  const dir = resolveWithin(bookCacheDir(rootPath, bookId), 'images', safePathSegment(vol, 'volume'))
  const dp = join(dir, `${idx}.bin`)
  const mp = join(dir, `${idx}.meta`)
  try {
    if (Date.now() - (await stat(dp)).mtimeMs > CACHE_TTL_MS) return null
    const [data, ext] = await Promise.all([readFile(dp), readFile(mp, 'utf-8')])
    return { data, ext }
  } catch {
    return null
  }
}

async function clearBookCache(rootPath: string, bookId: string): Promise<void> {
  await rm(bookCacheDir(rootPath, bookId), { recursive: true, force: true })
}

/** 并发池：限制同时执行的 Promise 数量，保持结果顺序 */
export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  let failed = false
  let firstError: unknown

  async function worker(): Promise<void> {
    while (!failed && idx < items.length) {
      const i = idx++
      try {
        results[i] = await fn(items[i], i)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }

  const workerCount = isFinite(concurrency)
    ? Math.min(concurrency, items.length)
    : items.length
  const workers = Array.from(
    { length: workerCount },
    () => worker(),
  )
  await Promise.all(workers)
  if (failed) throw firstError
  return results
}

type ImageBatchItem = {
  url: string
  index: number
}

export async function downloadImageBatch(
  items: ImageBatchItem[],
  fetchImage: (url: string) => Promise<Buffer | null>,
  onImage: (data: Buffer, ext: string, index: number) => void | Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const data = await fetchImage(item.url)
      if (!data) {
        throw new Error('图片下载失败')
      }
      const ext = imageExtensionFromUrl(item.url)
      return { ...item, data, ext }
    }),
  )

  const failedIndices = results.flatMap((result, index) =>
    result.status === 'rejected' ? [items[index].index + 1] : [],
  )
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const item = result.value
      await onImage(item.data, item.ext, item.index)
    }
  }

  if (failedIndices.length > 0) {
    throw new Error(`图片下载失败（序号：${failedIndices.join(', ')}）`)
  }
}

export class Downloader {
  private crawler: DownloaderCrawler
  private readonly runtimeConfig: Readonly<DownloadRuntimeConfig>
  private onProgress: ((p: DownloadProgress) => void) | null = null

  constructor(
    crawler: DownloaderCrawler,
    runtimeConfig: DownloadRuntimeConfig,
    private readonly rateLimiter: DownloadRateLimiter = sharedDownloadRateLimiter,
  ) {
    this.crawler = crawler
    this.runtimeConfig = Object.freeze({ ...runtimeConfig })
  }

  setOnProgress(cb: (p: DownloadProgress) => void): void {
    this.onProgress = cb
  }

  private emitProgress(current: number, total: number, phase: string): void {
    this.onProgress?.({ current, total, phase })
  }

  private get speed() {
    return this.rateLimiter.speed
  }

  private async fetchImageWithRetry(
    url: string,
    retries: number,
  ): Promise<Buffer | null> {
    let receivedResponseStatus = false
    const recordResponseStatus = (status: number): void => {
      receivedResponseStatus = true
      this.rateLimiter.record(status)
    }

    try {
      const content = await this.crawler.getImageContent(url, retries, recordResponseStatus)
      if (content && !receivedResponseStatus) this.rateLimiter.record(200)
      return content
    } catch (err) {
      if (!receivedResponseStatus) {
        const msg = (err as Error).message
        if (msg.includes('429')) this.rateLimiter.record(429)
        else if (msg.includes('403')) this.rateLimiter.record(403)
        else this.rateLimiter.record(503)
      }
      return null
    }
  }

  private async fetchChapterContent(url: string): Promise<string> {
    await sleep(this.speed.delayMs)
    try {
      const $ = await this.crawler.fetch(url)
      const textDiv = $('#content')
      textDiv.find('ul').each((_i, ul) => $(ul).remove())
      const html = textDiv.html() || ''
      this.rateLimiter.record(200)
      return html
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('429')) {
        this.rateLimiter.record(429)
        throw new Error('服务器限流（HTTP 429），已自动降低下载速度并进入冷却期，请等待片刻后重试', { cause: err })
      }
      if (msg.includes('403')) {
        this.rateLimiter.record(403)
        throw new Error('访问被拒绝（HTTP 403），Cookie 可能已过期，请前往「配置」页面刷新 Cookie', { cause: err })
      }
      throw err
    }
  }

  private async downloadImagesWithConcurrency(
    urls: string[],
    onImage: (data: Buffer, ext: string, index: number) => void | Promise<void>,
    onProgress: (completed: number, total: number) => void,
  ): Promise<void> {
    const retries = this.speed.maxRetries
    const total = urls.length
    let completed = 0

    if (this.speed.imageConcurrency === 1) {
      for (let i = 0; i < urls.length; i++) {
        await downloadImageBatch(
          [{ url: urls[i], index: i }],
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
        )
        completed++
        onProgress(completed, total)
      }
    } else {
      const batchSize = this.speed.imageConcurrency
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize)
        await downloadImageBatch(
          batch.map((url, batchIdx) => ({ url, index: i + batchIdx })),
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
        )
        completed += batch.length
        onProgress(completed, total)
        if (this.speed.delayMs > 0) await sleep(this.speed.delayMs)
      }
    }
  }

  async downloadPictures(
    urls: string[],
    volumeName: string,
    novelName: string,
    bookId: string,
    volumeIndex?: number,
  ): Promise<void> {
    const savePath = this.runtimeConfig.rootPath
    const bookKey = buildBookKey(novelName, bookId)
    const safeVolumeName = safePathSegment(volumeName, 'volume')
    const dirName = volumeIndex === undefined
      ? safeVolumeName
      : buildVolumeKey(volumeName, volumeIndex)
    const volumePath = resolveWithin(savePath, 'pics', bookKey, dirName)
    await mkdir(volumePath, { recursive: true })

    // 检查已有文件，跳过已下载的图片
    const existingIndices = new Set<number>()
    for (const f of await readdir(volumePath)) {
      const match = f.match(/^(\d+)\./)
      if (match) existingIndices.add(parseInt(match[1]) - 1)
    }

    const toFetch: { url: string; idx: number }[] = []
    for (let i = 0; i < urls.length; i++) {
      if (!existingIndices.has(i)) {
        toFetch.push({ url: urls[i], idx: i })
      }
    }

    if (toFetch.length === 0) {
      this.emitProgress(urls.length, urls.length, `图片已全部下载，跳过 (${volumeName})`)
      return
    }

    await this.downloadImagesWithConcurrency(
      toFetch.map(x => x.url),
      async (content, ext, batchIdx) => {
        const i = toFetch[batchIdx].idx
        const filePath = resolveWithin(volumePath, `${i + 1}.${ext}`)
        await writeFile(filePath, content)
      },
      (completed, _total) => {
        this.emitProgress(
          existingIndices.size + completed,
          urls.length,
          `正在下载图片 (${volumeName})`,
        )
      },
    )
  }

  async downloadNovel(book: DownloaderBook, volumeName?: string): Promise<void> {
    if (volumeName) {
      await this.downloadSingleVolume(book, volumeName)
    } else {
      await this.downloadFullBook(book)
    }
  }

  private async downloadSingleVolume(book: DownloaderBook, volumeName: string): Promise<void> {
    const builder = new EpubBuilder()
    builder.setLanguage('zh')
    builder.setAuthor(book.basicInfo['作者'])

    const bookTitle = book.getFormattedTitle(
      this.runtimeConfig.fullTitle,
    )
    const bookKey = buildBookKey(bookTitle, book.bookId)
    builder.setTitle(`${bookTitle} ${volumeName}`)

    const volume = book.volumes[volumeName]
    if (!volume) throw new Error(`未找到卷: ${volumeName}`)
    const volumeNames = Object.keys(book.volumes)
    const volumeIndex = volumeNames.indexOf(volumeName)
    const volumeKey = buildVolumeKey(volumeName, volumeIndex)

    const bookId = String(book.bookId)
    await migrateLegacyVolumeCache(
      bookCacheDir(this.runtimeConfig.rootPath, bookId),
      volumeName,
      volumeKey,
      volumeNames,
    )
    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []

    const illustItem = volume.find(item => item.name === '插图')
    const chapterItems = volume.filter(item => item.name !== '插图')
    const totalChapters = chapterItems.length
    let completedChapters = 0

    // 插图下载（带缓存）
    if (illustItem) {
      this.emitProgress(0, totalChapters, `正在下载插图 (${volumeName})`)
      const urls = await book.getChapterImageUrls(volumeName)
      if (urls) {
        const imgResults = await this.downloadVolumeImagesCached(
          urls, volumeKey, 0, totalChapters, images, builder, bookId,
        )
        chapters.push({
          title: '插图',
          content: imgResults.html,
          fileName: `illustrations_${volumeKey}.xhtml`,
        })
      }
    }

    // 章节下载（带缓存）
    if (chapterItems.length > 0) {
      const chapterResults = await this.downloadChaptersWithCache(
        book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
      )
      completedChapters = chapterResults.completed
      chapters.push(...chapterResults.chapters)
    }

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const savePath = this.runtimeConfig.rootPath
    const saveDir = resolveWithin(savePath, 'novels', bookKey)
    const outputFileName = `${volumeKey}.epub`
    await mkdir(saveDir, { recursive: true })
    await writeFile(resolveWithin(saveDir, outputFileName), epubBuffer)
    await clearBookCache(this.runtimeConfig.rootPath, bookId)
  }

  private async downloadVolumeImagesCached(
    urls: string[],
    volumeKey: string,
    itemIdx: number,
    total: number,
    images: EpubImage[],
    builder: EpubBuilder,
    bookId: string,
    setCover = true,
  ): Promise<{ html: string }> {
    let htmlParts = ''

    // 加载已缓存的图片
    const cachedImgs: { data: Buffer; ext: string; idx: number }[] = []
    for (let i = 0; i < urls.length; i++) {
      const c = await loadImageCache(this.runtimeConfig.rootPath, bookId, volumeKey, i)
      if (c) cachedImgs.push({ ...c, idx: i })
    }

    // 从缓存恢复图片
    for (const img of cachedImgs) {
      const imgName = `images/${volumeKey}_${img.idx + 1}.${img.ext}`
      images.push({ fileName: imgName, data: img.data, mediaType: guessMediaType(img.ext) })
      htmlParts += `<img src="${imgName}"/>`
      if (setCover) {
        const coverIndex = this.runtimeConfig.defaultCoverIndex
        if (coverIndex === img.idx) {
          builder.setCover(`${volumeKey}_${img.idx + 1}.${img.ext}`, img.data)
        }
      }
    }

    // 下载未缓存的图片
    const toFetch = urls
      .map((url, i) => ({ url, idx: i }))
      .filter(x => !cachedImgs.some(r => r.idx === x.idx))

    if (toFetch.length > 0) {
      await this.downloadImagesWithConcurrency(
        toFetch.map(x => x.url),
        async (data, ext, batchIdx) => {
          const idx = toFetch[batchIdx].idx
          await saveImageCache(this.runtimeConfig.rootPath, bookId, volumeKey, idx, data, ext)
          const imgName = `images/${volumeKey}_${idx + 1}.${ext}`
          images.push({ fileName: imgName, data, mediaType: guessMediaType(ext) })
          htmlParts += `<img src="${imgName}"/>`
          if (setCover) {
            const coverIndex = this.runtimeConfig.defaultCoverIndex
            if (coverIndex === idx) {
              builder.setCover(`${volumeKey}_${idx + 1}.${ext}`, data)
            }
          }
        },
        (completed, _totalUrls) => {
          this.emitProgress(
            itemIdx + 1, total,
            `正在下载图片 ${cachedImgs.length + completed}/${urls.length}`,
          )
        },
      )
    }

    return { html: htmlParts }
  }

  /** 下载章节列表，优先使用缓存。startCompleted 为跨卷累计的已完成章节数 */
  private async downloadChaptersWithCache(
    book: DownloaderBook,
    chapterItems: { name: string; link: string }[],
    bookId: string,
    volumeKey: string,
    totalChapters: number,
    startCompleted: number,
  ): Promise<{ chapters: EpubChapter[]; completed: number }> {
    const results: { title: string; content: string; idx: number }[] = []
    let completed = startCompleted

    // 加载已缓存的章节
    for (let i = 0; i < chapterItems.length; i++) {
      const c = await loadChapterCache(this.runtimeConfig.rootPath, bookId, volumeKey, i)
      if (c) {
        results.push({ ...c, idx: i })
        completed++
      }
    }

    // 下载未缓存的章节
    const toFetch = chapterItems
      .map((item, i) => ({ item, idx: i }))
      .filter(x => !results.some(r => r.idx === x.idx))

    if (toFetch.length > 0) {
      const fetched = await asyncPool(
        this.speed.chapterConcurrency,
        toFetch,
        async ({ item, idx }) => {
          const link = `${book.baseChapterUrl}${item.link}`
          const html = await this.fetchChapterContent(link)
          await saveChapterCache(
            this.runtimeConfig.rootPath,
            bookId,
            volumeKey,
            idx,
            { title: item.name, content: html },
          )
          completed++
          this.emitProgress(completed, totalChapters,
            `正在下载: ${item.name} (${completed}/${totalChapters})`)
          return { title: item.name, content: html, idx }
        },
      )
      results.push(...fetched)
    }

    // 按原始顺序排序
    results.sort((a, b) => a.idx - b.idx)

    return {
      chapters: results.map(ch => ({
        title: ch.title,
        content: ch.content,
        fileName: `${ch.idx}.xhtml`,
      })),
      completed,
    }
  }

  private async downloadFullBook(book: DownloaderBook): Promise<void> {
    const builder = new EpubBuilder()
    builder.setLanguage('zh')
    builder.setAuthor(book.basicInfo['作者'])

    const bookTitle = book.getFormattedTitle(
      this.runtimeConfig.fullTitle,
    )
    const bookKey = buildBookKey(bookTitle, book.bookId)
    builder.setTitle(bookTitle)

    // 设置封面
    try {
      const coverContent = await book.getCoverContent()
      const coverUrl = book.basicInfo['cover'] || ''
      const coverFileName = `cover.${imageExtensionFromUrl(coverUrl)}`
      builder.setCover(coverFileName, coverContent)
    } catch {
      // 封面下载失败，继续
    }

    const bookId = String(book.bookId)
    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []
    const allVolumes = Object.entries(book.volumes)
    const volumeNames = allVolumes.map(([name]) => name)

    let totalChapters = 0
    for (const [, volume] of allVolumes) {
      totalChapters += volume.filter(item => item.name !== '插图').length
    }
    let completedChapters = 0

    for (const [volumeIndex, [volName, volume]] of allVolumes.entries()) {
      let htmlParts = ''
      const volumeKey = buildVolumeKey(volName, volumeIndex)
      await migrateLegacyVolumeCache(
        bookCacheDir(this.runtimeConfig.rootPath, bookId),
        volName,
        volumeKey,
        volumeNames,
      )

      const illustItem = volume.find(item => item.name === '插图')
      const chapterItems = volume.filter(item => item.name !== '插图')

      // 插图下载（带缓存）
      if (illustItem) {
        this.emitProgress(completedChapters, totalChapters, `正在下载插图 (${volName})`)
        const urls = await book.getChapterImageUrls(volName)
        if (urls) {
          const imgResults = await this.downloadVolumeImagesCached(
            urls, volumeKey, completedChapters, totalChapters, images, builder, bookId,
            false, // 整本下载不从卷插图设置封面（封面已在前面通过 book.getCoverContent() 设置）
          )
          htmlParts += imgResults.html + '<br/>'
        }
      }

      // 章节下载（带缓存）
      if (chapterItems.length > 0) {
        const result = await this.downloadChaptersWithCache(
          book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
        )
        completedChapters = result.completed
        for (const ch of result.chapters) {
          htmlParts += `<h2>${escapeXml(ch.title)}</h2><div>${ch.content}</div><br/>`
        }
      }

      chapters.push({
        title: volName,
        content: htmlParts,
        fileName: `${volumeKey}.xhtml`,
      })
    }

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const savePath = this.runtimeConfig.rootPath
    const novelsDir = resolveWithin(savePath, 'novels')
    const outputFileName = `${bookKey}.epub`
    await mkdir(novelsDir, { recursive: true })
    await writeFile(resolveWithin(novelsDir, outputFileName), epubBuffer)

    // 下载成功，清理缓存
    await clearBookCache(this.runtimeConfig.rootPath, bookId)
  }
}

export { guessMediaType as guessType }
