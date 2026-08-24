import { randomUUID } from 'crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { EpubBuilder, escapeXml, guessMediaType } from './epub-builder'
import type { Book } from './book'
import type { WebCrawler } from './crawler'
import type { EpubChapter, EpubImage } from './epub-builder'
import { sleep } from './utils'
import { imageExtensionFromUrl, resolveWithin, safePathSegment } from './path-safety'
import { DownloadRateLimiter, sharedDownloadRateLimiter } from './download-rate-limiter'
import { migrateLegacyVolumeCache } from './legacy-cache-migration'
import type { DownloadConfig } from '../shared/config-types'
import { logger } from './logging/logger'

export interface DownloadRuntimeConfig extends DownloadConfig {
  rootPath: string
}

export interface DownloaderLogContext {
  operationId?: string
  taskId?: string
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

interface AtomicDownloadFileOps {
  open(path: string, flags: 'wx', mode: number): ReturnType<typeof open>
  rename(oldPath: string, newPath: string): Promise<void>
  rm(path: string, options: { force: true }): Promise<void>
}

const DEFAULT_ATOMIC_DOWNLOAD_FILE_OPS: AtomicDownloadFileOps = { open, rename, rm }

export async function atomicWriteDownloadFile(
  targetPath: string,
  content: Buffer,
  overrides: Partial<AtomicDownloadFileOps> = {},
): Promise<void> {
  const ops = { ...DEFAULT_ATOMIC_DOWNLOAD_FILE_OPS, ...overrides }
  const tempPath = resolveWithin(
    dirname(targetPath),
    `.${basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await ops.open(tempPath, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    // Renaming replaces the directory entry instead of following an existing link.
    await ops.rename(tempPath, targetPath)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      await ops.rm(tempPath, { force: true })
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
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

function hasUsableChapterContent(content: string): boolean {
  if (!content.trim()) return false
  if (/<img\b/i.test(content)) return true
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .trim()
    .length > 0
}

function httpStatusFromError(error: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as { status?: unknown; cause?: unknown }
    if (typeof record.status === 'number' && Number.isInteger(record.status)) {
      return record.status
    }
    current = record.cause
  }
  return undefined
}

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
    const cached = JSON.parse(await readFile(p, 'utf-8')) as CachedChapter
    return hasUsableChapterContent(cached.content) ? cached : null
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
    return data.byteLength > 0 ? { data, ext } : null
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

type ImageBatchOutcome = {
  succeeded: number
  failedIndices: number[]
  firstError?: unknown
}

class MissingImageDataError extends Error {
  constructor() {
    super('图片响应中没有可保存的内容')
    this.name = 'MissingImageDataError'
  }
}

async function settleImageBatch(
  items: ImageBatchItem[],
  fetchImage: (url: string) => Promise<Buffer | null>,
  onImage: (data: Buffer, ext: string, index: number) => void | Promise<void>,
): Promise<ImageBatchOutcome> {
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const data = await fetchImage(item.url)
      if (!data || data.byteLength === 0) throw new MissingImageDataError()
      return { ...item, data, ext: imageExtensionFromUrl(item.url) }
    }),
  )

  const failedIndices = results.flatMap((result, index) =>
    result.status === 'rejected' ? [items[index].index + 1] : [],
  )
  let succeeded = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const item = result.value
      await onImage(item.data, item.ext, item.index)
      succeeded++
    }
  }
  const firstError = results.find(
    (result) => result.status === 'rejected' && !(result.reason instanceof MissingImageDataError),
  )
  return {
    succeeded,
    failedIndices,
    firstError: firstError?.status === 'rejected' ? firstError.reason : undefined,
  }
}

export async function downloadImageBatch(
  items: ImageBatchItem[],
  fetchImage: (url: string) => Promise<Buffer | null>,
  onImage: (data: Buffer, ext: string, index: number) => void | Promise<void>,
): Promise<void> {
  const { failedIndices } = await settleImageBatch(items, fetchImage, onImage)

  if (failedIndices.length > 0) {
    throw new Error(`图片下载失败（序号：${failedIndices.join(', ')}）`)
  }
}

export class NoUsableDownloadContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoUsableDownloadContentError'
  }
}

export class Downloader {
  private crawler: DownloaderCrawler
  private readonly runtimeConfig: Readonly<DownloadRuntimeConfig>
  private readonly rateLimiter: DownloadRateLimiter
  private readonly logContext: DownloaderLogContext
  private readonly warnings: string[] = []
  private onProgress: ((p: DownloadProgress) => void) | null = null

  constructor(
    crawler: DownloaderCrawler,
    runtimeConfig: DownloadRuntimeConfig,
    rateLimiterOrLogContext: DownloadRateLimiter | DownloaderLogContext = sharedDownloadRateLimiter,
    logContext: DownloaderLogContext = {},
  ) {
    this.crawler = crawler
    this.runtimeConfig = Object.freeze({ ...runtimeConfig })
    if (rateLimiterOrLogContext instanceof DownloadRateLimiter) {
      this.rateLimiter = rateLimiterOrLogContext
      this.logContext = { ...logContext }
    } else {
      this.rateLimiter = sharedDownloadRateLimiter
      this.logContext = { ...rateLimiterOrLogContext }
    }
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
      const message = err instanceof Error ? err.message : ''
      const status = httpStatusFromError(err)
        ?? (/\bHTTP\s*429\b/i.test(message) ? 429 : undefined)
        ?? (/\bHTTP\s*403\b/i.test(message) ? 403 : undefined)
      if (!receivedResponseStatus) {
        if (status === 429) this.rateLimiter.record(429)
        else if (status === 403) this.rateLimiter.record(403)
        else this.rateLimiter.record(503)
      }
      if (status === 429) {
        throw new Error('请求过于频繁，已自动降低下载速度，请稍等片刻后重试', { cause: err })
      }
      if (status === 403) {
        throw new Error('登录状态已失效，请前往配置页重新登录后重试', { cause: err })
      }
      if (err instanceof Error) throw err
      throw new Error('图片下载失败，请稍后重试', { cause: err })
    }
  }

  private async fetchChapterContent(url: string): Promise<string> {
    await sleep(this.speed.delayMs)
    try {
      const $ = await this.crawler.fetch(url)
      const textDiv = $('#content')
      textDiv.find('ul').each((_i, ul) => $(ul).remove())
      const html = (textDiv.html() || '').trim()
      const readableText = textDiv.text().replace(/\u00a0/g, ' ').trim()
      if (!html || (!readableText && textDiv.find('img').length === 0)) {
        throw new NoUsableDownloadContentError('章节内容为空，请稍后重试')
      }
      this.rateLimiter.record(200)
      return html
    } catch (err) {
      const status = httpStatusFromError(err)
      if (status === 429) {
        this.rateLimiter.record(429)
        throw new Error('请求过于频繁，已自动降低下载速度，请稍等片刻后重试', { cause: err })
      }
      if (status === 403) {
        this.rateLimiter.record(403)
        throw new Error('登录状态已失效，请前往配置页重新登录后重试', { cause: err })
      }
      throw err
    }
  }

  private async downloadImagesWithConcurrency(
    urls: string[],
    onImage: (data: Buffer, ext: string, index: number) => void | Promise<void>,
    onProgress: (completed: number, total: number) => void,
  ): Promise<ImageBatchOutcome> {
    const retries = this.speed.maxRetries
    const total = urls.length
    let completed = 0
    let succeeded = 0
    const failedIndices: number[] = []
    let firstError: unknown

    if (this.speed.imageConcurrency === 1) {
      for (let i = 0; i < urls.length; i++) {
        const outcome = await settleImageBatch(
          [{ url: urls[i], index: i }],
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
        )
        succeeded += outcome.succeeded
        failedIndices.push(...outcome.failedIndices)
        firstError ??= outcome.firstError
        completed++
        onProgress(completed, total)
      }
    } else {
      const batchSize = this.speed.imageConcurrency
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize)
        const outcome = await settleImageBatch(
          batch.map((url, batchIdx) => ({ url, index: i + batchIdx })),
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
        )
        succeeded += outcome.succeeded
        failedIndices.push(...outcome.failedIndices)
        firstError ??= outcome.firstError
        completed += batch.length
        onProgress(completed, total)
        if (this.speed.delayMs > 0) await sleep(this.speed.delayMs)
      }
    }
    return { succeeded, failedIndices, firstError }
  }

  async downloadPictures(
    urls: string[],
    volumeName: string,
    novelName: string,
    bookId: string,
    volumeIndex?: number,
  ): Promise<void> {
    if (urls.length === 0) {
      throw new NoUsableDownloadContentError('该分卷没有可保存的插图')
    }
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
    for (const entry of await readdir(volumePath, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const match = entry.name.match(/^(\d+)\./)
      if (!match) continue
      const metadata = await stat(resolveWithin(volumePath, entry.name))
      if (metadata.size > 0) existingIndices.add(parseInt(match[1]) - 1)
    }

    const toFetch: { url: string; idx: number }[] = []
    for (let i = 0; i < urls.length; i++) {
      if (!existingIndices.has(i)) {
        toFetch.push({ url: urls[i], idx: i })
      }
    }

    const skipped = urls.length - toFetch.length
    const summaryContext = {
      ...this.logContext,
      bookId,
      title: novelName,
      volumeName,
      total: urls.length,
      skipped,
      outputPath: volumePath,
    }

    if (toFetch.length === 0) {
      this.emitProgress(urls.length, urls.length, `图片已全部下载，跳过 (${volumeName})`)
      logger.info('download.pictures.volume-completed', '插图卷下载完成', summaryContext)
      return
    }

    let writtenBytes = 0
    const outcome = await this.downloadImagesWithConcurrency(
      toFetch.map(x => x.url),
      async (content, ext, batchIdx) => {
        const i = toFetch[batchIdx].idx
        const filePath = resolveWithin(volumePath, `${i + 1}.${ext}`)
        await atomicWriteDownloadFile(filePath, content)
        writtenBytes += content.byteLength
      },
      (completed, _total) => {
        this.emitProgress(
          existingIndices.size + completed,
          urls.length,
          `正在下载图片 (${volumeName})`,
        )
      },
    )
    if (skipped + outcome.succeeded === 0) {
      if (outcome.firstError !== undefined) throw outcome.firstError
      throw new NoUsableDownloadContentError('该分卷没有可保存的插图')
    }
    if (outcome.failedIndices.length > 0) {
      this.addWarning(
        `“${volumeName}”有 ${outcome.failedIndices.length} 张插图未能下载，已保存其余插图。`,
      )
    }
    logger.info('download.output.written', '插图文件已写入', {
      ...summaryContext,
      itemCount: outcome.succeeded,
      byteCount: writtenBytes,
    })
    logger.info('download.pictures.volume-completed', '插图卷下载完成', summaryContext)
  }

  getWarnings(): string[] {
    return [...this.warnings]
  }

  private addWarning(message: string): void {
    if (this.warnings.includes(message)) return
    this.warnings.push(message)
    logger.warn('download.partial-warning', message, { ...this.logContext })
  }

  private async loadIllustrationUrls(
    book: DownloaderBook,
    volumeName: string,
  ): Promise<{ urls: string[] | null; error?: unknown }> {
    try {
      return { urls: await book.getChapterImageUrls(volumeName) }
    } catch (error) {
      logger.error(
        'download.illustration-page.failed',
        '插图页读取失败',
        error,
        {
          ...this.logContext,
          bookId: String(book.bookId),
          volumeName,
        },
      )
      return { urls: null, error }
    }
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
    let imageCache = { hits: 0, total: 0 }
    let chapterCache = { hits: 0, total: chapterItems.length }
    let illustrationError: unknown
    let illustrationDownloadError: unknown
    let illustrationWarning: string | undefined

    // 插图下载（带缓存）
    if (illustItem) {
      this.emitProgress(0, totalChapters, `正在下载插图 (${volumeName})`)
      const illustration = await this.loadIllustrationUrls(book, volumeName)
      const { urls } = illustration
      illustrationError = illustration.error
      if (urls?.length) {
        const imgResults = await this.downloadVolumeImagesCached(
          urls, volumeName, volumeKey, 0, totalChapters, images, builder, bookId,
        )
        imageCache = { hits: imgResults.cacheHits, total: imgResults.total }
        illustrationDownloadError = imgResults.firstError
        if (imgResults.failedCount > 0) {
          illustrationWarning = imgResults.html
            ? `“${volumeName}”有 ${imgResults.failedCount} 张插图未能下载，已保存其余内容。`
            : `“${volumeName}”的插图未能下载，正文内容仍会保存。`
        }
        if (imgResults.html) {
          chapters.push({
            title: '插图',
            content: imgResults.html,
            fileName: `illustrations_${volumeKey}.xhtml`,
          })
        }
      } else if (illustrationError !== undefined) {
        illustrationWarning = `“${volumeName}”的插图页无法读取，正文内容仍会保存。`
      } else if (urls === null) {
        illustrationWarning = `“${volumeName}”的插图未能获取，正文内容仍会保存。`
      }
    }

    // 章节下载（带缓存）
    if (chapterItems.length > 0) {
      const chapterResults = await this.downloadChaptersWithCache(
        book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
      )
      completedChapters = chapterResults.completed
      chapterCache = { hits: chapterResults.cacheHits, total: chapterResults.total }
      chapters.push(...chapterResults.chapters)
    }

    this.logCacheSummary(bookId, volumeName, imageCache, chapterCache)

    if (chapters.length === 0 && images.length === 0) {
      if (illustrationError !== undefined) throw illustrationError
      if (illustrationDownloadError !== undefined) throw illustrationDownloadError
      throw new NoUsableDownloadContentError('该分卷没有可保存的内容')
    }
    if (illustrationWarning) this.addWarning(illustrationWarning)

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const savePath = this.runtimeConfig.rootPath
    const saveDir = resolveWithin(savePath, 'novels', bookKey)
    const outputFileName = `${volumeKey}.epub`
    await mkdir(saveDir, { recursive: true })
    const outputPath = resolveWithin(saveDir, outputFileName)
    await atomicWriteDownloadFile(outputPath, epubBuffer)
    logger.info('download.output.written', 'EPUB 文件已写入', {
      ...this.logContext,
      bookId,
      title: bookTitle,
      volumeName,
      outputPath,
      byteCount: epubBuffer.byteLength,
    })
    await clearBookCache(this.runtimeConfig.rootPath, bookId)
  }

  private async downloadVolumeImagesCached(
    urls: string[],
    volumeName: string,
    volumeKey: string,
    itemIdx: number,
    total: number,
    images: EpubImage[],
    builder: EpubBuilder,
    bookId: string,
    setCover = true,
  ): Promise<{
    html: string
    cacheHits: number
    total: number
    failedCount: number
    firstError?: unknown
  }> {
    let htmlParts = ''
    let failedCount = 0
    let firstError: unknown

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
      const outcome = await this.downloadImagesWithConcurrency(
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
      failedCount = outcome.failedIndices.length
      firstError = outcome.firstError
    }

    return {
      html: htmlParts,
      cacheHits: cachedImgs.length,
      total: urls.length,
      failedCount,
      firstError,
    }
  }

  /** 下载章节列表，优先使用缓存。startCompleted 为跨卷累计的已完成章节数 */
  private async downloadChaptersWithCache(
    book: DownloaderBook,
    chapterItems: { name: string; link: string }[],
    bookId: string,
    volumeKey: string,
    totalChapters: number,
    startCompleted: number,
  ): Promise<{ chapters: EpubChapter[]; completed: number; cacheHits: number; total: number }> {
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
      cacheHits: results.length - toFetch.length,
      total: chapterItems.length,
    }
  }

  private logCacheSummary(
    bookId: string,
    volumeName: string,
    images: { hits: number; total: number },
    chapters: { hits: number; total: number },
  ): void {
    logger.info('download.cache.summary', '下载缓存统计', {
      ...this.logContext,
      bookId,
      volumeName,
      chapterTotal: chapters.total,
      chapterCacheHits: chapters.hits,
      imageTotal: images.total,
      imageCacheHits: images.hits,
    })
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
    } catch (error) {
      logger.error('download.cover.failed', '封面下载失败，继续生成 EPUB', error, {
        ...this.logContext,
        bookId: book.bookId,
        title: bookTitle,
      })
      this.addWarning('封面未能下载，正文内容仍已保存。')
    }

    const bookId = String(book.bookId)
    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []
    const allVolumes = Object.entries(book.volumes)
    const volumeNames = allVolumes.map(([name]) => name)
    if (allVolumes.length === 0) {
      throw new NoUsableDownloadContentError('该作品没有可保存的内容')
    }

    let totalChapters = 0
    for (const [, volume] of allVolumes) {
      totalChapters += volume.filter(item => item.name !== '插图').length
    }
    let completedChapters = 0
    const illustrationFailures: Array<{ volumeName: string; error: unknown }> = []
    const illustrationWarnings: string[] = []

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
      let imageCache = { hits: 0, total: 0 }
      let chapterCache = { hits: 0, total: chapterItems.length }

      // 插图下载（带缓存）
      if (illustItem) {
        this.emitProgress(completedChapters, totalChapters, `正在下载插图 (${volName})`)
        const illustration = await this.loadIllustrationUrls(book, volName)
        const { urls } = illustration
        if (urls?.length) {
          const imgResults = await this.downloadVolumeImagesCached(
            urls, volName, volumeKey, completedChapters, totalChapters, images, builder, bookId,
            false, // 整本下载不从卷插图设置封面（封面已在前面通过 book.getCoverContent() 设置）
          )
          imageCache = { hits: imgResults.cacheHits, total: imgResults.total }
          if (imgResults.failedCount > 0) {
            if (!imgResults.html && imgResults.firstError !== undefined) {
              illustrationFailures.push({ volumeName: volName, error: imgResults.firstError })
            }
            illustrationWarnings.push(
              imgResults.html
                ? `“${volName}”有 ${imgResults.failedCount} 张插图未能下载，已保存其余内容。`
                : `“${volName}”的插图未能下载，正文内容仍会保存。`,
            )
          }
          if (imgResults.html) htmlParts += imgResults.html + '<br/>'
        } else if (illustration.error !== undefined) {
          illustrationFailures.push({ volumeName: volName, error: illustration.error })
          illustrationWarnings.push(`“${volName}”的插图页无法读取，正文内容仍会保存。`)
        } else if (urls === null) {
          illustrationWarnings.push(`“${volName}”的插图未能获取，正文内容仍会保存。`)
        }
      }

      // 章节下载（带缓存）
      if (chapterItems.length > 0) {
        const result = await this.downloadChaptersWithCache(
          book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
        )
        completedChapters = result.completed
        chapterCache = { hits: result.cacheHits, total: result.total }
        for (const ch of result.chapters) {
          htmlParts += `<h2>${escapeXml(ch.title)}</h2><div>${ch.content}</div><br/>`
        }
      }

      if (hasUsableChapterContent(htmlParts)) {
        chapters.push({
          title: volName,
          content: htmlParts,
          fileName: `${volumeKey}.xhtml`,
        })
      }
      this.logCacheSummary(bookId, volName, imageCache, chapterCache)
    }

    if (chapters.length === 0 && images.length === 0) {
      if (illustrationFailures.length > 0) throw illustrationFailures[0].error
      throw new NoUsableDownloadContentError('该作品没有可保存的内容')
    }
    for (const warning of illustrationWarnings) this.addWarning(warning)

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const savePath = this.runtimeConfig.rootPath
    const novelsDir = resolveWithin(savePath, 'novels')
    const outputFileName = `${bookKey}.epub`
    await mkdir(novelsDir, { recursive: true })
    const outputPath = resolveWithin(novelsDir, outputFileName)
    await atomicWriteDownloadFile(outputPath, epubBuffer)
    logger.info('download.output.written', 'EPUB 文件已写入', {
      ...this.logContext,
      bookId,
      title: bookTitle,
      outputPath,
      byteCount: epubBuffer.byteLength,
    })

    // 下载成功，清理缓存
    await clearBookCache(this.runtimeConfig.rootPath, bookId)
  }
}

export { guessMediaType as guessType }
