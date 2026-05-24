import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { config } from './config-manager'
import { EpubBuilder, escapeXml, guessMediaType } from './epub-builder'
import type { Book } from './book'
import type { WebCrawler } from './crawler'
import type { EpubChapter, EpubImage } from './epub-builder'
import { sleep } from './utils'

export function getSavePath(): string {
  const customPath = config.get('download', 'download_path') as string
  if (customPath) return customPath
  return app.isPackaged
    ? join(app.getPath('downloads'), 'Wenku8Downloader')
    : join(process.cwd(), 'downloads')
}

export type DownloadProgress = {
  current: number
  total: number
  phase: string
}

const SPEED_TIERS = [
  { level: 0, name: '激进', chapterConcurrency: 5, imageConcurrency: 4, delayMs: 100, maxRetries: 1 },
  { level: 1, name: '中等', chapterConcurrency: 3, imageConcurrency: 2, delayMs: 500, maxRetries: 2 },
  { level: 2, name: '保守', chapterConcurrency: 2, imageConcurrency: 1, delayMs: 1000, maxRetries: 3 },
  { level: 3, name: '兜底', chapterConcurrency: 1, imageConcurrency: 1, delayMs: 2000, maxRetries: 3 },
] as const

const SUCCESS_RESET_THRESHOLD = 10

// ---- 下载缓存：支持断点续传 ----

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时后缓存自动失效

function safeVolName(name: string): string {
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法的卷名: ${name}`)
  }
  return name.replace(/[^a-zA-Z0-9一-鿿぀-ヿ_-]/g, '_')
}

function cacheRoot(): string {
  return join(getSavePath(), '.cache')
}

function bookCacheDir(bookId: string): string {
  return join(cacheRoot(), bookId)
}

interface CachedChapter { title: string; content: string }

function saveChapterCache(bookId: string, vol: string, idx: number, ch: CachedChapter): void {
  const p = join(bookCacheDir(bookId), 'chapters', safeVolName(vol), `${idx}.json`)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(ch), 'utf-8')
}

function loadChapterCache(bookId: string, vol: string, idx: number): CachedChapter | null {
  const p = join(bookCacheDir(bookId), 'chapters', safeVolName(vol), `${idx}.json`)
  if (!existsSync(p)) return null
  // 缓存过期检查
  if (Date.now() - statSync(p).mtimeMs > CACHE_TTL_MS) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

function saveImageCache(bookId: string, vol: string, idx: number, data: Buffer, ext: string): void {
  const dir = join(bookCacheDir(bookId), 'images', safeVolName(vol))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${idx}.bin`), data)
  writeFileSync(join(dir, `${idx}.meta`), ext, 'utf-8')
}

function loadImageCache(bookId: string, vol: string, idx: number): { data: Buffer; ext: string } | null {
  const dir = join(bookCacheDir(bookId), 'images', safeVolName(vol))
  const dp = join(dir, `${idx}.bin`)
  const mp = join(dir, `${idx}.meta`)
  if (!existsSync(dp) || !existsSync(mp)) return null
  // 缓存过期检查
  if (Date.now() - statSync(dp).mtimeMs > CACHE_TTL_MS) return null
  try {
    return { data: readFileSync(dp), ext: readFileSync(mp, 'utf-8') }
  } catch { return null }
}

function clearBookCache(bookId: string): void {
  rmSync(bookCacheDir(bookId), { recursive: true, force: true })
}

/** 并发池：限制同时执行的 Promise 数量，保持结果顺序 */
async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!isFinite(concurrency)) {
    return Promise.all(items.map((item, i) => fn(item, i)))
  }
  const results: R[] = new Array(items.length)
  let idx = 0

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

export class Downloader {
  private crawler: WebCrawler
  private speedTier = 0
  private consecutiveSuccess = 0
  private tierLock = false
  private onProgress: ((p: DownloadProgress) => void) | null = null

  constructor(crawler: WebCrawler) {
    this.crawler = crawler
    mkdirSync(join(getSavePath(), 'pics'), { recursive: true })
    mkdirSync(join(getSavePath(), 'novels'), { recursive: true })
  }

  setOnProgress(cb: (p: DownloadProgress) => void): void {
    this.onProgress = cb
  }

  private emitProgress(current: number, total: number, phase: string): void {
    this.onProgress?.({ current, total, phase })
  }

  private get speed(): typeof SPEED_TIERS[number] {
    return SPEED_TIERS[this.speedTier]
  }

  private checkRateLimit(status: number): void {
    if (status === 429) {
      this.consecutiveSuccess = 0
      if (this.speedTier < SPEED_TIERS.length - 1) {
        this.tierLock = true
        this.speedTier = Math.max(this.speedTier, 2)
        console.warn(`[下载] 检测到 429 限流，降级至「${this.speed.name}」等级并进入 30 秒冷却期`)
        setTimeout(() => { this.tierLock = false }, 30000)
      }
    } else if (status === 503) {
      this.consecutiveSuccess = 0
      if (!this.tierLock && this.speedTier < SPEED_TIERS.length - 1) {
        this.tierLock = true
        this.speedTier++
        console.warn(`[下载] 检测到 503，降级至「${this.speed.name}」等级`)
        setTimeout(() => { this.tierLock = false }, 10000)
      }
    } else if (status === 403) {
      this.consecutiveSuccess = 0
      console.warn('[下载] 检测到 403，Cookie 可能已过期')
    } else if (status === 200) {
      this.consecutiveSuccess++
      if (!this.tierLock && this.consecutiveSuccess >= SUCCESS_RESET_THRESHOLD && this.speedTier > 0) {
        this.tierLock = true
        this.speedTier--
        this.consecutiveSuccess = 0
        console.log(`[下载] 连续成功 ${SUCCESS_RESET_THRESHOLD} 次，升级至「${this.speed.name}」等级`)
        setTimeout(() => { this.tierLock = false }, 5000)
      }
    }
  }

  private async fetchImageWithRetry(
    url: string,
    retries: number,
  ): Promise<Buffer | null> {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await sleep(this.speed.delayMs * 2)
      try {
        const content = await this.crawler.getImageContent(url)
        if (content) {
          this.checkRateLimit(200)
          return content
        }
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('429')) this.checkRateLimit(429)
        else if (msg.includes('403')) this.checkRateLimit(403)
        else this.checkRateLimit(503)
      }
      if (attempt < retries - 1) {
        console.warn(`[下载] 图片下载失败，重试第 ${attempt + 2} 次: ${url.substring(0, 60)}`)
      }
    }
    return null
  }

  private async fetchChapterContent(url: string): Promise<string> {
    await sleep(this.speed.delayMs)
    try {
      const $ = await this.crawler.fetch(url)
      const textDiv = $('#content')
      textDiv.find('ul').each((_i, ul) => $(ul).remove())
      const html = textDiv.html() || ''
      this.checkRateLimit(200)
      return html
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('429')) {
        this.checkRateLimit(429)
        throw new Error('服务器限流（HTTP 429），已自动降低下载速度并进入冷却期，请等待片刻后重试', { cause: err })
      }
      if (msg.includes('403')) {
        this.checkRateLimit(403)
        throw new Error('访问被拒绝（HTTP 403），Cookie 可能已过期，请前往「配置」页面刷新 Cookie', { cause: err })
      }
      throw err
    }
  }

  private async downloadImagesWithConcurrency(
    urls: string[],
    onImage: (data: Buffer, ext: string, index: number) => void,
    onProgress: (completed: number, total: number) => void,
  ): Promise<void> {
    const retries = this.speed.maxRetries
    const total = urls.length
    let completed = 0

    if (this.speed.imageConcurrency === 1) {
      for (let i = 0; i < urls.length; i++) {
        const content = await this.fetchImageWithRetry(urls[i], retries)
        if (content) {
          const ext = urls[i].split('.').pop() || 'jpg'
          onImage(content, ext, i)
        }
        completed++
        onProgress(completed, total)
      }
    } else {
      const batchSize = this.speed.imageConcurrency
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (url, batchIdx) => {
            const idx = i + batchIdx
            const content = await this.fetchImageWithRetry(url, retries)
            if (content) {
              const ext = url.split('.').pop() || 'jpg'
              onImage(content, ext, idx)
            }
          })
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
    index: number | string = '',
  ): Promise<void> {
    const dirName = index !== '' ? `${index}_${volumeName}` : volumeName
    const volumePath = join(getSavePath(), 'pics', novelName, dirName)
    mkdirSync(volumePath, { recursive: true })

    // 检查已有文件，跳过已下载的图片
    const existingIndices = new Set<number>()
    if (existsSync(volumePath)) {
      for (const f of readdirSync(volumePath)) {
        const match = f.match(/^(\d+)\./)
        if (match) existingIndices.add(parseInt(match[1]) - 1)
      }
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
      (content, ext, batchIdx) => {
        const i = toFetch[batchIdx].idx
        const filePath = join(volumePath, `${i + 1}.${ext}`)
        writeFileSync(filePath, content)
      },
      (completed, total) => {
        this.emitProgress(
          existingIndices.size + completed,
          urls.length,
          `正在下载图片 (${volumeName})`,
        )
      },
    )
  }

  async downloadNovel(book: Book, volumeName?: string): Promise<void> {
    if (volumeName) {
      await this.downloadSingleVolume(book, volumeName)
    } else {
      await this.downloadFullBook(book)
    }
  }

  private async downloadSingleVolume(book: Book, volumeName: string): Promise<void> {
    const builder = new EpubBuilder()
    builder.setLanguage('zh')
    builder.setAuthor(book.basicInfo['作者'])

    const bookTitle = book.getFormattedTitle(
      (config.get('download', 'full_title') as string) || 'FULL',
    )
    builder.setTitle(`${bookTitle} ${volumeName}`)

    const volume = book.volumes[volumeName]
    if (!volume) throw new Error(`未找到卷: ${volumeName}`)

    const bookId = String(book.bookId)
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
          urls, volumeName, 0, totalChapters, images, builder, bookId,
        )
        chapters.push({
          title: '插图',
          content: imgResults.html,
          fileName: `illustrations_${volumeName}.xhtml`,
        })
      }
    }

    // 章节下载（带缓存）
    if (chapterItems.length > 0) {
      const chapterResults = await this.downloadChaptersWithCache(
        book, chapterItems, bookId, volumeName, totalChapters, completedChapters,
      )
      completedChapters = chapterResults.completed
      chapters.push(...chapterResults.chapters)
    }

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const saveDir = join(getSavePath(), 'novels', bookTitle)
    mkdirSync(saveDir, { recursive: true })
    writeFileSync(join(saveDir, `${volumeName}.epub`), epubBuffer)
    clearBookCache(bookId)
  }

  private async downloadVolumeImagesCached(
    urls: string[],
    volumeName: string,
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
      const c = loadImageCache(bookId, volumeName, i)
      if (c) cachedImgs.push({ ...c, idx: i })
    }

    // 从缓存恢复图片
    for (const img of cachedImgs) {
      const imgName = `images/${volumeName}_${img.idx + 1}.${img.ext}`
      images.push({ fileName: imgName, data: img.data, mediaType: guessMediaType(img.ext) })
      htmlParts += `<img src="${imgName}"/>`
      if (setCover) {
        const coverIndex = config.get('download', 'default_cover_index') as number
        if (coverIndex === img.idx) {
          builder.setCover(`${volumeName}_${img.idx + 1}.${img.ext}`, img.data)
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
        (data, ext, batchIdx) => {
          const idx = toFetch[batchIdx].idx
          saveImageCache(bookId, volumeName, idx, data, ext)
          const imgName = `images/${volumeName}_${idx + 1}.${ext}`
          images.push({ fileName: imgName, data, mediaType: guessMediaType(ext) })
          htmlParts += `<img src="${imgName}"/>`
          if (setCover) {
            const coverIndex = config.get('download', 'default_cover_index') as number
            if (coverIndex === idx) {
              builder.setCover(`${volumeName}_${idx + 1}.${ext}`, data)
            }
          }
        },
        (completed, totalUrls) => {
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
    book: Book,
    chapterItems: { name: string; link: string }[],
    bookId: string,
    volName: string,
    totalChapters: number,
    startCompleted: number,
  ): Promise<{ chapters: EpubChapter[]; completed: number }> {
    const results: { title: string; content: string; idx: number }[] = []
    let completed = startCompleted

    // 加载已缓存的章节
    for (let i = 0; i < chapterItems.length; i++) {
      const c = loadChapterCache(bookId, volName, i)
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
          saveChapterCache(bookId, volName, idx, { title: item.name, content: html })
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

  private async downloadFullBook(book: Book): Promise<void> {
    const builder = new EpubBuilder()
    builder.setLanguage('zh')
    builder.setAuthor(book.basicInfo['作者'])

    const bookTitle = book.getFormattedTitle(
      (config.get('download', 'full_title') as string) || 'FULL',
    )
    builder.setTitle(bookTitle)

    // 设置封面
    try {
      const coverContent = await book.getCoverContent()
      const coverUrl = book.basicInfo['cover'] || ''
      const coverFileName = coverUrl.split('/').pop() || 'cover.jpg'
      builder.setCover(coverFileName, coverContent)
    } catch {
      // 封面下载失败，继续
    }

    const bookId = String(book.bookId)
    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []
    const allVolumes = Object.entries(book.volumes)

    let totalChapters = 0
    for (const [, volume] of allVolumes) {
      totalChapters += volume.filter(item => item.name !== '插图').length
    }
    let completedChapters = 0

    for (const [volName, volume] of allVolumes) {
      let htmlParts = ''

      const illustItem = volume.find(item => item.name === '插图')
      const chapterItems = volume.filter(item => item.name !== '插图')

      // 插图下载（带缓存）
      if (illustItem) {
        this.emitProgress(completedChapters, totalChapters, `正在下载插图 (${volName})`)
        const urls = await book.getChapterImageUrls(volName)
        if (urls) {
          const imgResults = await this.downloadVolumeImagesCached(
            urls, volName, completedChapters, totalChapters, images, builder, bookId,
            false, // 整本下载不从卷插图设置封面（封面已在前面通过 book.getCoverContent() 设置）
          )
          htmlParts += imgResults.html + '<br/>'
        }
      }

      // 章节下载（带缓存）
      if (chapterItems.length > 0) {
        const result = await this.downloadChaptersWithCache(
          book, chapterItems, bookId, volName, totalChapters, completedChapters,
        )
        completedChapters = result.completed
        for (const ch of result.chapters) {
          htmlParts += `<h2>${escapeXml(ch.title)}</h2><div>${ch.content}</div><br/>`
        }
      }

      chapters.push({
        title: volName,
        content: htmlParts,
        fileName: `${volName}.xhtml`,
      })
    }

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    writeFileSync(join(getSavePath(), 'novels', `${bookTitle}.epub`), epubBuffer)

    // 下载成功，清理缓存
    clearBookCache(bookId)
  }
}

export { guessMediaType as guessType }
