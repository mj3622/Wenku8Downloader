import type { WebCrawler } from './crawler'
import type { BasicInfo, Chapter } from './types'

export class Book {
  readonly bookId: string
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
    'cover': null,
  }

  private crawler: WebCrawler

  private constructor(bookId: string, crawler: WebCrawler) {
    this.bookId = bookId
    this.crawler = crawler
  }

  static async create(bookId: string, crawler: WebCrawler): Promise<Book> {
    const book = new Book(bookId, crawler)

    // 顺序与 Python 一致：章节 → 图片映射 → 基本信息
    const [baseUrl, volumes] = await book.fetchChapters()
    book.baseChapterUrl = baseUrl
    book.volumes = volumes
    book.pictureUrls = book.buildPictureUrlMap()
    book.basicInfo = await book.fetchBasicInfo()

    return book
  }

  private async fetchChapters(): Promise<[string, Record<string, Chapter[]>]> {
    const bookUrl = `https://www.wenku8.net/book/${this.bookId}.htm`
    const $ = await this.crawler.fetch(bookUrl)

    // 找到 "小说目录" 链接
    let chapterIndexUrl = ''
    $('#content div a').each((_i, el) => {
      const link = $(el)
      if (link.text().includes('小说目录') && link.attr('href')) {
        chapterIndexUrl = link.attr('href')!
        return false
      }
    })

    if (!chapterIndexUrl) {
      throw new Error('未找到小说目录链接')
    }

    const index$ = await this.crawler.fetch(chapterIndexUrl)
    const baseUrl = chapterIndexUrl.replace(/index\.htm$/, '')

    const volumes: Record<string, Chapter[]> = {}
    let currentVolume = ''

    index$('table.css tr').each((_i, tr) => {
      const vcss = index$(tr).find('td.vcss')
      if (vcss.length > 0) {
        currentVolume = vcss.text().trim()
        volumes[currentVolume] = []
      } else {
        const links = index$(tr).find('a')
        links.each((_j, a) => {
          const name = index$(a).text().trim()
          const link = index$(a).attr('href')
          if (currentVolume && name && link) {
            volumes[currentVolume].push({ name, link })
          }
        })
      }
    })

    return [baseUrl, volumes]
  }

  private buildPictureUrlMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [volName, chapters] of Object.entries(this.volumes)) {
      for (const ch of chapters) {
        if (ch.name === '插图') {
          map[volName] = ch.link
          break
        }
      }
    }
    return map
  }

  private async fetchBasicInfo(): Promise<BasicInfo> {
    const bookUrl = `https://www.wenku8.net/book/${this.bookId}.htm`
    const $ = await this.crawler.fetch(bookUrl)

    const contentDiv = $('#content')
    const table = contentDiv.find('table').first()
    const title = table.find('b').first().text().trim()

    const cells: string[] = []
    table.find('tr').eq(2).find('td').each((_i, td) => {
      cells.push($(td).text().trim())
    })

    const category = cells[0]?.split('：')[1] || ''
    const author = cells[1]?.split('：')[1] || ''
    const status = cells[2]?.split('：')[1] || ''
    const updateTime = cells[3]?.split('：')[1] || null
    const length = cells[4]?.split('：')[1] || null

    // 最新章节
    let latestChapter: string | null = null
    $('#content span.hottext').each((_i, el) => {
      const t = $(el).text()
      if (t.includes('最新章节') || t.includes('最近章节')) {
        const chapterSpan = $(el).nextAll('span').first()
        const link = chapterSpan.find('a')
        if (link.length > 0) {
          latestChapter = link.text().trim()
        }
        return false
      }
    })

    // 简介
    let description = ''
    $('#content span.hottext').each((_i, el) => {
      const t = $(el).text()
      if (t.includes('内容简介')) {
        const descSpan = $(el).nextAll('span').first()
        if (descSpan.length > 0) {
          description = descSpan.text().trim()
        }
        return false
      }
    })

    // 封面
    const imgs = contentDiv.find('img')
    const cover = imgs.length > 0 ? imgs.eq(0).attr('src') || null : null

    return {
      '标题': title,
      '作者': author,
      '出版社': category,
      '最新章节': latestChapter,
      '连载状态': status,
      '更新时间': updateTime,
      '全文长度': length,
      '简介': description,
      'cover': cover,
    }
  }

  async getChapterImageUrls(volumeName?: string): Promise<string[] | null> {
    if (!volumeName) return null
    const pictureUrl = this.pictureUrls[volumeName]
    if (!pictureUrl) return null

    const url = `${this.baseChapterUrl}${pictureUrl}`
    const $ = await this.crawler.fetch(url)
    const urls: string[] = []

    $('img').each((_i, img) => {
      const src = $(img).attr('src')
      if (src) urls.push(src)
    })

    return urls.length > 0 ? urls : null
  }

  async getCoverContent(): Promise<Buffer> {
    const coverUrl = this.basicInfo['cover']
    if (!coverUrl) throw new Error('无封面图片')
    const content = await this.crawler.getImageContent(coverUrl)
    if (!content) throw new Error('封面下载失败')
    return content
  }

  getFormattedTitle(format: 'FULL' | 'OUT' | 'IN'): string {
    const title = this.basicInfo['标题']
    if (format === 'FULL') return title

    const match = title.match(/^(.*?)\((.*?)\)$/)
    if (!match) return title

    if (format === 'OUT') return match[1].trim()
    return match[2].trim()
  }
}
