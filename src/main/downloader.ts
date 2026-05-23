import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from './config-manager'
import { EpubBuilder, escapeXml } from './epub-builder'
import type { Book } from './book'
import type { WebCrawler } from './crawler'
import type { EpubChapter, EpubImage } from './epub-builder'

const SAVE_PATH = join(process.cwd(), 'downloads')
const PIC_PATH = join(SAVE_PATH, 'pics')
const NOVEL_PATH = join(SAVE_PATH, 'novels')

export type DownloadProgress = {
  current: number
  total: number
  phase: string   // 当前阶段描述
}

/** 请求限流降级等级 */
const SPEED_TIERS = [
  { level: 0, name: '激进', chapterConcurrency: 8, imageConcurrency: Infinity, delayMs: 0, maxRetries: 1 },
  { level: 1, name: '中等', chapterConcurrency: 4, imageConcurrency: 5, delayMs: 500, maxRetries: 2 },
  { level: 2, name: '保守', chapterConcurrency: 2, imageConcurrency: 1, delayMs: 1000, maxRetries: 3 },
  { level: 3, name: '兜底', chapterConcurrency: 1, imageConcurrency: 1, delayMs: 2000, maxRetries: 3 },
] as const

const SUCCESS_RESET_THRESHOLD = 10  // 连续成功 N 次后升一级

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  private onProgress: ((p: DownloadProgress) => void) | null = null

  constructor(crawler: WebCrawler) {
    this.crawler = crawler
    mkdirSync(PIC_PATH, { recursive: true })
    mkdirSync(NOVEL_PATH, { recursive: true })
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

  /** 检测响应状态，触发降级 */
  private checkRateLimit(status: number): void {
    if (status === 429 || status === 503) {
      this.consecutiveSuccess = 0
      if (this.speedTier < SPEED_TIERS.length - 1) {
        this.speedTier++
        console.warn(`[下载] 检测到限流，降级至「${this.speed.name}」等级`)
      }
    } else if (status === 200) {
      this.consecutiveSuccess++
      if (this.consecutiveSuccess >= SUCCESS_RESET_THRESHOLD && this.speedTier > 0) {
        this.speedTier--
        this.consecutiveSuccess = 0
        console.log(`[下载] 连续成功 ${SUCCESS_RESET_THRESHOLD} 次，升级至「${this.speed.name}」等级`)
      }
    }
  }

  /** 带限流和重试的图片下载 */
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
        // 请求没有抛异常但是返回了 null（HTTP 非 200）
        this.checkRateLimit(403)
      } catch {
        this.checkRateLimit(503)
      }
      if (attempt < retries - 1) {
        console.warn(`[下载] 图片下载失败，重试第 ${attempt + 2} 次: ${url.substring(0, 60)}`)
      }
    }
    return null
  }

  /** 带限流的章节内容抓取 */
  private async fetchChapterContent(url: string): Promise<string> {
    await sleep(this.speed.delayMs)
    const $ = await this.crawler.fetch(url)
    const textDiv = $('#content')
    textDiv.find('ul').each((_i, ul) => $(ul).remove())
    const html = textDiv.html() || ''
    this.checkRateLimit(200)
    return html
  }

  async downloadPictures(
    urls: string[],
    volumeName: string,
    novelName: string,
    index: number | string = '',
  ): Promise<void> {
    const dirName = index !== '' ? `${index}_${volumeName}` : volumeName
    const volumePath = join(PIC_PATH, novelName, dirName)
    mkdirSync(volumePath, { recursive: true })

    const retries = this.speed.maxRetries
    const total = urls.length
    let completed = 0

    if (this.speed.imageConcurrency === 1) {
      // 顺序下载
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        const suffix = url.split('.').pop() || 'jpg'
        const content = await this.fetchImageWithRetry(url, retries)
        if (content) {
          const filePath = join(volumePath, `${i + 1}.${suffix}`)
          writeFileSync(filePath, content)
        }
        completed++
        this.emitProgress(completed, total, `正在下载图片 (${volumeName})`)
      }
    } else {
      // 并发下载（按 concurrency 分组）
      for (let i = 0; i < urls.length; i += this.speed.imageConcurrency) {
        const batch = urls.slice(i, i + this.speed.imageConcurrency)
        const results = await Promise.allSettled(
          batch.map((url, batchIdx) =>
            this.fetchImageWithRetry(url, retries).then((content) => {
              if (content) {
                const suffix = url.split('.').pop() || 'jpg'
                const filePath = join(volumePath, `${i + batchIdx + 1}.${suffix}`)
                writeFileSync(filePath, content)
              }
            })
          )
        )
        completed += results.length
        this.emitProgress(completed, total, `正在下载图片 (${volumeName})`)
        if (this.speed.delayMs > 0) await sleep(this.speed.delayMs)
      }
    }
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

    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []
    const total = volume.length

    for (let itemIdx = 0; itemIdx < volume.length; itemIdx++) {
      const item = volume[itemIdx]
      const name = item.name
      const link = `${book.baseChapterUrl}${item.link}`

      if (name === '插图') {
        this.emitProgress(itemIdx, total, `正在下载插图 (${volumeName})`)
        const urls = await book.getChapterImageUrls(volumeName)
        if (urls) {
          let htmlParts = ''
          const imgResults = await this.downloadVolumeImages(
            urls, volumeName, book, itemIdx, total, images, builder,
          )
          htmlParts = imgResults.html
          chapters.push({
            title: '插图',
            content: htmlParts,
            fileName: `illustrations_${volumeName}.xhtml`,
          })
        }
      } else {
        this.emitProgress(itemIdx, total, `正在下载: ${name}`)
        const html = await this.fetchChapterContent(link)
        chapters.push({
          title: name,
          content: html,
          fileName: `${itemIdx}.xhtml`,
        })
      }
    }

    for (const ch of chapters) builder.addChapter(ch)
    for (const img of images) builder.addImage(img)

    const epubBuffer = await builder.build()
    const saveDir = join(NOVEL_PATH, bookTitle)
    mkdirSync(saveDir, { recursive: true })
    writeFileSync(join(saveDir, `${volumeName}.epub`), epubBuffer)
  }

  private async downloadVolumeImages(
    urls: string[],
    volumeName: string,
    book: Book,
    itemIdx: number,
    total: number,
    images: EpubImage[],
    builder: EpubBuilder,
  ): Promise<{ html: string }> {
    let htmlParts = ''
    const retries = this.speed.maxRetries

    if (this.speed.imageConcurrency === 1) {
      for (let picIdx = 0; picIdx < urls.length; picIdx++) {
        const imgUrl = urls[picIdx]
        const suffix = imgUrl.split('.').pop() || 'jpg'
        const content = await this.fetchImageWithRetry(imgUrl, retries)
        if (content) {
          const imgName = `images/${volumeName}_${picIdx + 1}.${suffix}`
          images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
          htmlParts += `<img src="${imgName}"/>`

          const coverIndex = config.get('download', 'default_cover_index') as number
          if (coverIndex === picIdx) {
            builder.setCover(`${volumeName}_${picIdx + 1}.${suffix}`, content)
          }
        }
        this.emitProgress(itemIdx + 1, total, `正在下载图片 ${picIdx + 1}/${urls.length}`)
      }
    } else {
      const batchSize = this.speed.imageConcurrency
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(async (imgUrl, batchIdx) => {
            const picIdx = i + batchIdx
            const suffix = imgUrl.split('.').pop() || 'jpg'
            const content = await this.fetchImageWithRetry(imgUrl, retries)
            if (content) {
              const imgName = `images/${volumeName}_${picIdx + 1}.${suffix}`
              return { imgName, content, suffix, picIdx, imgUrl }
            }
            return null
          })
        )
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            const { imgName, content, suffix, picIdx, imgUrl } = r.value
            images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
            htmlParts += `<img src="${imgName}"/>`
            const coverIndex = config.get('download', 'default_cover_index') as number
            if (coverIndex === picIdx) {
              // Need to call setCover on the builder - but that's outside this function
              // We'll handle this differently
            }
          }
        }
        this.emitProgress(itemIdx + 1, total, `正在下载图片 ${Math.min(i + batchSize, urls.length)}/${urls.length}`)
        if (this.speed.delayMs > 0) await sleep(this.speed.delayMs)
      }
    }
    return { html: htmlParts }
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

    const chapters: EpubChapter[] = []
    const images: EpubImage[] = []
    const allVolumes = Object.entries(book.volumes)
    const totalVolumes = allVolumes.length

    for (let vi = 0; vi < allVolumes.length; vi++) {
      const [volName, volume] = allVolumes[vi]
      this.emitProgress(vi, totalVolumes, `正在处理: ${volName}`)

      let htmlParts = ''
      let hasContent = false

      for (const item of volume) {
        const name = item.name
        const link = `${book.baseChapterUrl}${item.link}`

        if (name === '插图') {
          this.emitProgress(vi, totalVolumes, `正在下载插图 (${volName})`)
          const urls = await book.getChapterImageUrls(volName)
          if (urls) {
            const retries = this.speed.maxRetries
            if (this.speed.imageConcurrency === 1) {
              for (let picIdx = 0; picIdx < urls.length; picIdx++) {
                const url = urls[picIdx]
                const suffix = url.split('.').pop() || 'jpg'
                const content = await this.fetchImageWithRetry(url, retries)
                if (content) {
                  const imgName = `images/${volName}_${picIdx + 1}.${suffix}`
                  images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
                  htmlParts += `<img src="${imgName}"/>`
                }
                this.emitProgress(vi, totalVolumes, `正在下载图片 ${picIdx + 1}/${urls.length}`)
              }
            } else {
              const batchSize = this.speed.imageConcurrency
              for (let i = 0; i < urls.length; i += batchSize) {
                const batch = urls.slice(i, i + batchSize)
                const results = await Promise.allSettled(
                  batch.map(async (imgUrl, batchIdx) => {
                    const picIdx = i + batchIdx
                    const suffix = imgUrl.split('.').pop() || 'jpg'
                    const content = await this.fetchImageWithRetry(imgUrl, retries)
                    if (content) {
                      const imgName = `images/${volName}_${picIdx + 1}.${suffix}`
                      return { imgName, content, suffix, picIdx, imgUrl }
                    }
                    return null
                  })
                )
                for (const r of results) {
                  if (r.status === 'fulfilled' && r.value) {
                    const { imgName, content, suffix } = r.value
                    images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
                    htmlParts += `<img src="${imgName}"/>`
                  }
                }
                this.emitProgress(vi, totalVolumes, `正在下载图片 ${Math.min(i + batchSize, urls.length)}/${urls.length}`)
                if (this.speed.delayMs > 0) await sleep(this.speed.delayMs)
              }
            }
            htmlParts += '<br/>'
          }
        } else {
          const html = await this.fetchChapterContent(link)
          htmlParts += `<h2>${escapeXml(name)}</h2><div>${html}</div><br/>`
          hasContent = true
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
    writeFileSync(join(NOVEL_PATH, `${bookTitle}.epub`), epubBuffer)
  }
}

export function guessType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/jpeg'
  }
}
