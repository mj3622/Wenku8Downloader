import { randomUUID } from 'crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { EpubBuilder, escapeXml, guessMediaType } from './epub-builder'
import type { Book } from './book'
import type { WebCrawler } from './crawler'
import type { EpubChapter, EpubImage } from './epub-builder'
import { imageExtensionFromUrl, resolveWithin, safePathSegment } from './path-safety'
import {
  DownloadRateLimiter,
  sharedDownloadRateLimiter,
  type DownloadRequestKind,
} from './download-rate-limiter'
import { migrateLegacyVolumeCache } from './legacy-cache-migration'
import type { DownloadConfig } from '../shared/config-types'
import { logger } from './logging/logger'
import {
  DownloadCancelledError,
  throwIfDownloadCancelled,
} from './download-cancellation'
import {
  DownloadAssetCache,
  hasUsableChapterContent,
  type DownloadCacheContext,
} from './cache/download-asset-cache'
import { legacyBookCacheDir } from './cache/legacy-download-cache'

export interface DownloadRuntimeConfig extends DownloadConfig {
  rootPath: string
}

export interface DownloaderLogContext {
  operationId?: string
  taskId?: string
}

export interface DownloaderOptions {
  rateLimiter?: DownloadRateLimiter
  logContext?: DownloaderLogContext
  signal?: AbortSignal
  onVolumeCover?: (cover: string) => void
  assetCache?: DownloadAssetCache
  cacheContext?: DownloadCacheContext
}

export type DownloaderCrawler = Pick<WebCrawler, 'fetch' | 'getImageContent'>

export type DownloaderBook = Pick<
  Book,
  | 'bookId'
  | 'generationKey'
  | 'legacyImportGenerationKey'
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

export const OUTPUT_MANIFEST_NAME = '.wenku8-output.json'

export interface OutputManifest {
  schemaVersion: 1
  bookId: string
  generationKey: string
  volumeName: string
  imageCount: number
}

export function parseOutputManifest(value: unknown): OutputManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1
    || typeof data.bookId !== 'string'
    || !/^\d+$/.test(data.bookId)
    || typeof data.generationKey !== 'string'
    || !/^[a-f0-9]{64}$/.test(data.generationKey)
    || typeof data.volumeName !== 'string'
    || data.volumeName.length > 2_048
    || typeof data.imageCount !== 'number'
    || !Number.isSafeInteger(data.imageCount)
    || data.imageCount < 0) return null
  return {
    schemaVersion: 1,
    bookId: data.bookId,
    generationKey: data.generationKey,
    volumeName: data.volumeName,
    imageCount: data.imageCount,
  }
}

export function buildBookKey(bookTitle: string, bookId: string): string {
  return safePathSegment(`${bookId}_${bookTitle}`, `book-${bookId}`)
}

export function buildVolumeKey(volumeName: string, volumeIndex: number): string {
  return `${volumeIndex + 1}_${safePathSegment(volumeName, 'volume')}`
}

export function normalizeVolumeCoverUrl(
  rawCover: string | undefined,
  baseUrl?: string,
): string | undefined {
  if (!rawCover || rawCover.length > 2_048) return undefined
  try {
    let cover: URL
    try {
      cover = new URL(rawCover)
    } catch {
      if (!baseUrl) return undefined
      const absoluteBaseUrl = baseUrl.startsWith('//') ? `https:${baseUrl}` : baseUrl
      cover = new URL(rawCover, absoluteBaseUrl)
    }
    if (cover.protocol !== 'http:' && cover.protocol !== 'https:') return undefined
    const normalized = cover.toString()
    return normalized.length <= 2_048 ? normalized : undefined
  } catch {
    return undefined
  }
}

export function selectVolumeCoverUrl(
  urls: readonly string[] | null | undefined,
  coverIndex: number,
  baseUrl?: string,
): string | undefined {
  return normalizeVolumeCoverUrl(urls?.[coverIndex], baseUrl)
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
  const targetName = basename(targetPath)
  const tempPath = resolveWithin(
    dirname(targetPath),
    `${targetName.startsWith('.') ? targetName : `.${targetName}`}.tmp-${process.pid}-${randomUUID()}`,
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

/** 并发池：限制同时执行的 Promise 数量，保持结果顺序 */
export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  let failed = false
  let firstError: unknown

  async function worker(): Promise<void> {
    while (!failed && idx < items.length) {
      throwIfDownloadCancelled(signal)
      const i = idx++
      try {
        results[i] = await fn(items[i], i)
        throwIfDownloadCancelled(signal)
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
  throwIfDownloadCancelled(signal)
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
  signal?: AbortSignal,
): Promise<ImageBatchOutcome> {
  throwIfDownloadCancelled(signal)
  const results = await Promise.allSettled(
    items.map(async (item) => {
      throwIfDownloadCancelled(signal)
      const data = await fetchImage(item.url)
      throwIfDownloadCancelled(signal)
      if (!data || data.byteLength === 0) throw new MissingImageDataError()
      return { ...item, data, ext: imageExtensionFromUrl(item.url) }
    }),
  )

  const cancellation = results.find(
    (result) => result.status === 'rejected' && result.reason instanceof DownloadCancelledError,
  )
  if (cancellation?.status === 'rejected') throw cancellation.reason
  throwIfDownloadCancelled(signal)

  const failedIndices = results.flatMap((result, index) =>
    result.status === 'rejected' ? [items[index].index + 1] : [],
  )
  let succeeded = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const item = result.value
      throwIfDownloadCancelled(signal)
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
  signal?: AbortSignal,
): Promise<void> {
  const { failedIndices } = await settleImageBatch(items, fetchImage, onImage, signal)

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
  private readonly signal?: AbortSignal
  private readonly onVolumeCover?: (cover: string) => void
  private readonly assetCache?: DownloadAssetCache
  private activeCacheContext?: DownloadCacheContext
  private readonly warnings: string[] = []
  private onProgress: ((p: DownloadProgress) => void) | null = null
  private lastProgress: DownloadProgress | null = null

  constructor(
    crawler: DownloaderCrawler,
    runtimeConfig: DownloadRuntimeConfig,
    optionsOrRateLimiter: DownloaderOptions | DownloadRateLimiter | DownloaderLogContext = {},
  ) {
    this.crawler = crawler
    this.runtimeConfig = Object.freeze({ ...runtimeConfig })
    if (optionsOrRateLimiter instanceof DownloadRateLimiter) {
      this.rateLimiter = optionsOrRateLimiter
      this.logContext = {}
      this.signal = undefined
      this.onVolumeCover = undefined
      this.assetCache = undefined
    } else if (
      'rateLimiter' in optionsOrRateLimiter
      || 'logContext' in optionsOrRateLimiter
      || 'signal' in optionsOrRateLimiter
      || 'onVolumeCover' in optionsOrRateLimiter
      || 'assetCache' in optionsOrRateLimiter
      || 'cacheContext' in optionsOrRateLimiter
    ) {
      this.rateLimiter = optionsOrRateLimiter.rateLimiter ?? sharedDownloadRateLimiter
      this.logContext = { ...optionsOrRateLimiter.logContext }
      this.signal = optionsOrRateLimiter.signal
      this.onVolumeCover = optionsOrRateLimiter.onVolumeCover
      this.assetCache = optionsOrRateLimiter.assetCache
      this.activeCacheContext = optionsOrRateLimiter.cacheContext
    } else {
      this.rateLimiter = sharedDownloadRateLimiter
      this.logContext = { ...(optionsOrRateLimiter as DownloaderLogContext) }
      this.signal = undefined
      this.onVolumeCover = undefined
      this.assetCache = undefined
    }
  }

  setOnProgress(cb: (p: DownloadProgress) => void): void {
    this.onProgress = cb
  }

  private async withCacheContext<T>(
    bookId: string,
    generationKey: string,
    legacyImportGenerationKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.assetCache) return operation()
    if (this.activeCacheContext) {
      if (this.activeCacheContext.bookId !== bookId
        || this.activeCacheContext.generationKey !== generationKey) {
        throw new Error('下载缓存上下文与作品版本不一致')
      }
      return operation()
    }
    const context = await this.assetCache.acquire(
      bookId,
      generationKey,
      legacyImportGenerationKey,
    )
    const previous = this.activeCacheContext
    this.activeCacheContext = context
    try {
      return await operation()
    } finally {
      this.activeCacheContext = previous
      await context.lease.release()
    }
  }

  private emitProgress(current: number, total: number, phase: string): void {
    const safeCurrent = this.lastProgress?.total === total
      ? Math.max(current, this.lastProgress.current)
      : current
    this.lastProgress = { current: safeCurrent, total, phase }
    this.onProgress?.(this.lastProgress)
  }

  private get speed() {
    return this.rateLimiter.speed
  }

  private reportThrottleWait(waitMs: number): void {
    if (waitMs <= 0) return
    const progress = this.lastProgress ?? { current: 0, total: 0, phase: '' }
    this.emitProgress(
      progress.current,
      progress.total,
      `服务器限流，已自动减速，约 ${Math.max(1, Math.ceil(waitMs / 1000))} 秒后继续`,
    )
  }

  private createRequestControl(
    kind: DownloadRequestKind,
    url: string,
    onResponseObserved: () => void,
  ) {
    return this.rateLimiter.createRequestControl(kind, url, {
      onResponseObserved,
      onThrottleWait: (waitMs) => this.reportThrottleWait(waitMs),
    })
  }

  private async fetchImageWithRetry(
    url: string,
    retries: number,
  ): Promise<Buffer | null> {
    throwIfDownloadCancelled(this.signal)
    let receivedResponseStatus = false
    const recordResponseStatus = (status: number): void => {
      if (receivedResponseStatus) return
      receivedResponseStatus = true
      this.rateLimiter.record(status)
    }
    const control = this.createRequestControl('image', url, () => {
      receivedResponseStatus = true
    })

    try {
      const content = await this.crawler.getImageContent(
        url,
        retries,
        recordResponseStatus,
        this.signal,
        control,
      )
      if (content && !receivedResponseStatus) this.rateLimiter.record(200)
      return content
    } catch (err) {
      throwIfDownloadCancelled(this.signal)
      if (err instanceof DownloadCancelledError) throw err
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
    throwIfDownloadCancelled(this.signal)
    let receivedResponseStatus = false
    const control = this.createRequestControl('document', url, () => {
      receivedResponseStatus = true
    })
    try {
      const $ = await this.crawler.fetch(url, true, this.signal, control)
      const textDiv = $('#content')
      textDiv.find('ul').each((_i, ul) => $(ul).remove())
      const html = (textDiv.html() || '').trim()
      const readableText = textDiv.text().replace(/\u00a0/g, ' ').trim()
      if (!html || (!readableText && textDiv.find('img').length === 0)) {
        throw new NoUsableDownloadContentError('章节内容为空，请稍后重试')
      }
      if (!receivedResponseStatus) this.rateLimiter.record(200)
      return html
    } catch (err) {
      throwIfDownloadCancelled(this.signal)
      const status = httpStatusFromError(err)
      if (status === 429) {
        if (!receivedResponseStatus) this.rateLimiter.record(429)
        throw new Error('请求过于频繁，已自动降低下载速度，请稍等片刻后重试', { cause: err })
      }
      if (status === 403) {
        if (!receivedResponseStatus) this.rateLimiter.record(403)
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
    throwIfDownloadCancelled(this.signal)
    const retries = this.speed.maxRetries
    const total = urls.length
    let completed = 0
    let succeeded = 0
    const failedIndices: number[] = []
    let firstError: unknown

    if (this.speed.imageConcurrency === 1) {
      for (let i = 0; i < urls.length; i++) {
        throwIfDownloadCancelled(this.signal)
        const outcome = await settleImageBatch(
          [{ url: urls[i], index: i }],
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
          this.signal,
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
        throwIfDownloadCancelled(this.signal)
        const batch = urls.slice(i, i + batchSize)
        const outcome = await settleImageBatch(
          batch.map((url, batchIdx) => ({ url, index: i + batchIdx })),
          (url) => this.fetchImageWithRetry(url, retries),
          onImage,
          this.signal,
        )
        succeeded += outcome.succeeded
        failedIndices.push(...outcome.failedIndices)
        firstError ??= outcome.firstError
        completed += batch.length
        onProgress(completed, total)
      }
    }
    return { succeeded, failedIndices, firstError }
  }

  async downloadPictures(
    urls: string[],
    volumeName: string,
    novelName: string,
    bookId: string,
    generationKey: string,
    legacyImportGenerationKey: string,
    volumeIndex?: number,
  ): Promise<void> {
    return this.withCacheContext(
      bookId,
      generationKey,
      legacyImportGenerationKey,
      () => this.downloadPicturesWithCache(
        urls,
        volumeName,
        novelName,
        bookId,
        generationKey,
        volumeIndex,
      ),
    )
  }

  private async downloadPicturesWithCache(
    urls: string[],
    volumeName: string,
    novelName: string,
    bookId: string,
    generationKey: string,
    volumeIndex?: number,
  ): Promise<void> {
    // 每次调用对应一个独立分卷，不能沿用上一卷的单调进度基线。
    this.lastProgress = null
    throwIfDownloadCancelled(this.signal)
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

    const manifest: OutputManifest = {
      schemaVersion: 1,
      bookId,
      generationKey,
      volumeName,
      imageCount: urls.length,
    }
    let savedManifest: OutputManifest | null = null
    try {
      savedManifest = parseOutputManifest(JSON.parse(
        await readFile(resolveWithin(volumePath, OUTPUT_MANIFEST_NAME), 'utf8'),
      ))
    } catch {
      // A missing or malformed manifest forces a full refresh of this volume.
    }
    const canReuseOutput = savedManifest?.bookId === manifest.bookId
      && savedManifest.generationKey === manifest.generationKey
      && savedManifest.volumeName === manifest.volumeName
      && savedManifest.imageCount === manifest.imageCount

    const existingIndices = new Set<number>()
    const currentFiles = new Set<string>()
    if (canReuseOutput) {
      for (const entry of await readdir(volumePath, { withFileTypes: true })) {
        throwIfDownloadCancelled(this.signal)
        if (!entry.isFile()) continue
        const match = entry.name.match(/^(\d+)\.[a-zA-Z0-9]+$/)
        if (!match) continue
        const metadata = await stat(resolveWithin(volumePath, entry.name))
        const index = parseInt(match[1]) - 1
        if (metadata.size > 0 && index >= 0 && index < urls.length) {
          existingIndices.add(index)
          currentFiles.add(entry.name)
        }
      }
    }

    const unresolved: { url: string; idx: number }[] = []
    for (let i = 0; i < urls.length; i++) {
      if (!existingIndices.has(i)) unresolved.push({ url: urls[i], idx: i })
    }

    const skipped = urls.length - unresolved.length
    const summaryContext = {
      ...this.logContext,
      bookId,
      title: novelName,
      volumeName,
      total: urls.length,
      skipped,
      outputPath: volumePath,
    }

    if (unresolved.length === 0) {
      this.emitProgress(urls.length, urls.length, `图片已全部下载，跳过 (${volumeName})`)
      logger.info('download.pictures.volume-completed', '插图卷下载完成', summaryContext)
      return
    }

    let writtenBytes = 0
    let cacheHits = 0
    const toFetch: { url: string; idx: number }[] = []
    for (const item of unresolved) {
      throwIfDownloadCancelled(this.signal)
      const cached = this.assetCache && this.activeCacheContext
        ? await this.assetCache.loadImage(this.activeCacheContext, item.url, {
            downloadRoot: this.runtimeConfig.rootPath,
            volumeKey: dirName,
            index: item.idx,
          })
        : null
      if (!cached) {
        toFetch.push(item)
        continue
      }
      const fileName = `${item.idx + 1}.${cached.extension}`
      await atomicWriteDownloadFile(resolveWithin(volumePath, fileName), cached.data)
      currentFiles.add(fileName)
      writtenBytes += cached.data.byteLength
      cacheHits++
    }
    const guard = this.assetCache && this.activeCacheContext
      ? this.assetCache.captureWriteGuard(this.activeCacheContext)
      : undefined
    const outcome = await this.downloadImagesWithConcurrency(
      toFetch.map(x => x.url),
      async (content, ext, batchIdx) => {
        throwIfDownloadCancelled(this.signal)
        const i = toFetch[batchIdx].idx
        const fileName = `${i + 1}.${ext}`
        const filePath = resolveWithin(volumePath, fileName)
        await atomicWriteDownloadFile(filePath, content)
        currentFiles.add(fileName)
        writtenBytes += content.byteLength
        if (this.assetCache && this.activeCacheContext && guard) {
          await this.assetCache.saveImage(
            this.activeCacheContext,
            toFetch[batchIdx].url,
            { data: content, extension: ext },
            guard,
          )
        }
      },
      (completed, _total) => {
        this.emitProgress(
          skipped + cacheHits + completed,
          urls.length,
          `正在下载图片 (${volumeName})`,
        )
      },
    )
    if (skipped + cacheHits + outcome.succeeded === 0) {
      if (outcome.firstError !== undefined) throw outcome.firstError
      throw new NoUsableDownloadContentError('该分卷没有可保存的插图')
    }
    if (outcome.failedIndices.length > 0) {
      this.addWarning(
        `“${volumeName}”有 ${outcome.failedIndices.length} 张插图未能下载，已保存其余插图。`,
      )
    }
    if (outcome.failedIndices.length === 0
      && skipped + cacheHits + outcome.succeeded === urls.length) {
      for (const entry of await readdir(volumePath, { withFileTypes: true })) {
        if (!entry.isFile()
          || !/^\d+\.[a-zA-Z0-9]+$/.test(entry.name)
          || currentFiles.has(entry.name)) continue
        await rm(resolveWithin(volumePath, entry.name), { force: true })
      }
      await atomicWriteDownloadFile(
        resolveWithin(volumePath, OUTPUT_MANIFEST_NAME),
        Buffer.from(JSON.stringify(manifest), 'utf8'),
      )
    }
    logger.info('download.output.written', '插图文件已写入', {
      ...summaryContext,
      itemCount: cacheHits + outcome.succeeded,
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
    throwIfDownloadCancelled(this.signal)
    try {
      return {
        urls: await book.getChapterImageUrls(volumeName, this.signal),
      }
    } catch (error) {
      throwIfDownloadCancelled(this.signal)
      if (error instanceof DownloadCancelledError) throw error
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
    return this.withCacheContext(
      String(book.bookId),
      book.generationKey,
      book.legacyImportGenerationKey,
      async () => {
        throwIfDownloadCancelled(this.signal)
        if (volumeName) await this.downloadSingleVolume(book, volumeName)
        else await this.downloadFullBook(book)
      },
    )
  }

  private async downloadSingleVolume(book: DownloaderBook, volumeName: string): Promise<void> {
    throwIfDownloadCancelled(this.signal)
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
      legacyBookCacheDir(this.runtimeConfig.rootPath, bookId),
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
    let illustrationUrls: string[] | undefined

    // 先解析插图地址，再让图片 CDN 与章节主站并行下载。
    if (illustItem) {
      this.emitProgress(0, totalChapters, `正在下载插图 (${volumeName})`)
      const illustration = await this.loadIllustrationUrls(book, volumeName)
      const { urls } = illustration
      illustrationError = illustration.error
      if (urls?.length) {
        illustrationUrls = urls
        const cover = selectVolumeCoverUrl(
          urls,
          this.runtimeConfig.defaultCoverIndex,
          book.baseChapterUrl,
        )
        if (cover) {
          this.onVolumeCover?.(cover)
          logger.debug('download.volume-cover.selected', '已选择分卷封面', {
            ...this.logContext,
            bookId,
            volumeName,
            coverIndex: this.runtimeConfig.defaultCoverIndex,
          })
        }
      } else if (illustrationError !== undefined) {
        illustrationWarning = `“${volumeName}”的插图页无法读取，正文内容仍会保存。`
      } else if (urls === null) {
        illustrationWarning = `“${volumeName}”的插图未能获取，正文内容仍会保存。`
      }
    }

    const imageDownload = illustrationUrls
      ? this.downloadVolumeImagesCached(
          illustrationUrls,
          volumeName,
          volumeKey,
          0,
          totalChapters,
          images,
          builder,
          bookId,
          true,
        )
      : Promise.resolve(undefined)
    const chapterDownload = chapterItems.length > 0
      ? this.downloadChaptersWithCache(
          book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
        )
      : Promise.resolve(undefined)
    const [imageResult, chapterResult] = await Promise.allSettled([
      imageDownload,
      chapterDownload,
    ] as const)
    if (imageResult.status === 'rejected') throw imageResult.reason
    if (chapterResult.status === 'rejected') throw chapterResult.reason

    const imgResults = imageResult.value
    if (imgResults) {
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
    }

    const chapterResults = chapterResult.value
    if (chapterResults) {
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

    throwIfDownloadCancelled(this.signal)
    const epubBuffer = await builder.build()
    throwIfDownloadCancelled(this.signal)
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
      throwIfDownloadCancelled(this.signal)
      const c = this.assetCache && this.activeCacheContext
        ? await this.assetCache.loadImage(this.activeCacheContext, urls[i], {
            downloadRoot: this.runtimeConfig.rootPath,
            volumeKey,
            index: i,
          })
        : null
      if (c) cachedImgs.push({ data: c.data, ext: c.extension, idx: i })
    }

    // 从缓存恢复图片
    for (const img of cachedImgs) {
      throwIfDownloadCancelled(this.signal)
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
      const guard = this.assetCache && this.activeCacheContext
        ? this.assetCache.captureWriteGuard(this.activeCacheContext)
        : undefined
      const outcome = await this.downloadImagesWithConcurrency(
        toFetch.map(x => x.url),
        async (data, ext, batchIdx) => {
          throwIfDownloadCancelled(this.signal)
          const idx = toFetch[batchIdx].idx
          if (this.assetCache && this.activeCacheContext && guard) {
            await this.assetCache.saveImage(
              this.activeCacheContext,
              toFetch[batchIdx].url,
              { data, extension: ext },
              guard,
            )
          }
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
      throwIfDownloadCancelled(this.signal)
      const chapterUrl = new URL(chapterItems[i].link, book.baseChapterUrl).toString()
      const c = this.assetCache && this.activeCacheContext
        ? await this.assetCache.loadChapter(this.activeCacheContext, chapterUrl, {
            downloadRoot: this.runtimeConfig.rootPath,
            volumeKey,
            index: i,
          })
        : null
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
      const guard = this.assetCache && this.activeCacheContext
        ? this.assetCache.captureWriteGuard(this.activeCacheContext)
        : undefined
      const fetched = await asyncPool(
        this.speed.chapterConcurrency,
        toFetch,
        async ({ item, idx }) => {
          const link = new URL(item.link, book.baseChapterUrl).toString()
          const html = await this.fetchChapterContent(link)
          if (this.assetCache && this.activeCacheContext && guard) {
            await this.assetCache.saveChapter(
              this.activeCacheContext,
              link,
              { title: item.name, content: html },
              guard,
            )
          }
          completed++
          this.emitProgress(completed, totalChapters,
            `正在下载: ${item.name} (${completed}/${totalChapters})`)
          return { title: item.name, content: html, idx }
        },
        this.signal,
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
    throwIfDownloadCancelled(this.signal)
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
      const coverContent = await book.getCoverContent(this.signal)
      const coverUrl = book.basicInfo['cover'] || ''
      const coverFileName = `cover.${imageExtensionFromUrl(coverUrl)}`
      builder.setCover(coverFileName, coverContent)
    } catch (error) {
      throwIfDownloadCancelled(this.signal)
      if (error instanceof DownloadCancelledError) throw error
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
      throwIfDownloadCancelled(this.signal)
      let htmlParts = ''
      const volumeKey = buildVolumeKey(volName, volumeIndex)
      await migrateLegacyVolumeCache(
        legacyBookCacheDir(this.runtimeConfig.rootPath, bookId),
        volName,
        volumeKey,
        volumeNames,
      )

      const illustItem = volume.find(item => item.name === '插图')
      const chapterItems = volume.filter(item => item.name !== '插图')
      let imageCache = { hits: 0, total: 0 }
      let chapterCache = { hits: 0, total: chapterItems.length }
      let illustrationUrls: string[] | undefined

      // 先解析插图地址，再让图片 CDN 与章节主站并行下载。
      if (illustItem) {
        this.emitProgress(completedChapters, totalChapters, `正在下载插图 (${volName})`)
        const illustration = await this.loadIllustrationUrls(book, volName)
        const { urls } = illustration
        if (urls?.length) {
          illustrationUrls = urls
        } else if (illustration.error !== undefined) {
          illustrationFailures.push({ volumeName: volName, error: illustration.error })
          illustrationWarnings.push(`“${volName}”的插图页无法读取，正文内容仍会保存。`)
        } else if (urls === null) {
          illustrationWarnings.push(`“${volName}”的插图未能获取，正文内容仍会保存。`)
        }
      }

      const imageDownload = illustrationUrls
        ? this.downloadVolumeImagesCached(
            illustrationUrls,
            volName,
            volumeKey,
            completedChapters,
            totalChapters,
            images,
            builder,
            bookId,
            false, // 整本下载不从卷插图设置封面（封面已在前面通过 book.getCoverContent() 设置）
          )
        : Promise.resolve(undefined)
      const chapterDownload = chapterItems.length > 0
        ? this.downloadChaptersWithCache(
            book, chapterItems, bookId, volumeKey, totalChapters, completedChapters,
          )
        : Promise.resolve(undefined)
      const [imageResult, chapterResult] = await Promise.allSettled([
        imageDownload,
        chapterDownload,
      ] as const)
      if (imageResult.status === 'rejected') throw imageResult.reason
      if (chapterResult.status === 'rejected') throw chapterResult.reason

      const imgResults = imageResult.value
      if (imgResults) {
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
      }

      const chapterResults = chapterResult.value
      if (chapterResults) {
        completedChapters = chapterResults.completed
        chapterCache = { hits: chapterResults.cacheHits, total: chapterResults.total }
        for (const ch of chapterResults.chapters) {
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

    throwIfDownloadCancelled(this.signal)
    const epubBuffer = await builder.build()
    throwIfDownloadCancelled(this.signal)
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

  }
}

export { guessMediaType as guessType }
