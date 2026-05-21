import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from './config-manager'
import { crawler } from './crawler'
import { EpubBuilder } from './epub-builder'
import type { Book } from './book'
import type { EpubChapter, EpubImage } from './epub-builder'

const SAVE_PATH = join(process.cwd(), 'downloads')
const PIC_PATH = join(SAVE_PATH, 'pics')
const NOVEL_PATH = join(SAVE_PATH, 'novels')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Downloader {
  constructor() {
    mkdirSync(PIC_PATH, { recursive: true })
    mkdirSync(NOVEL_PATH, { recursive: true })
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

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const suffix = url.split('.').pop() || 'jpg'
      const content = await crawler.getImageContent(url)
      if (content) {
        const filePath = join(volumePath, `${i + 1}.${suffix}`)
        writeFileSync(filePath, content)
      }
      await sleep(200)
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

    for (let itemIdx = 0; itemIdx < volume.length; itemIdx++) {
      const item = volume[itemIdx]
      const name = item.name
      const link = `${book.baseChapterUrl}${item.link}`

      if (name === '插图') {
        const urls = await book.getChapterImageUrls(volumeName)
        if (urls) {
          let htmlParts = ''
          for (let picIdx = 0; picIdx < urls.length; picIdx++) {
            const url = urls[urls.length - 1 - picIdx] // 倒序，与 Python 版一致? 不，按原始顺序
            const actualUrl = urls[picIdx]
            const suffix = actualUrl.split('.').pop() || 'jpg'
            const content = await crawler.getImageContent(actualUrl)
            if (content) {
              const imgName = `images/${volumeName}_${picIdx + 1}.${suffix}`
              images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
              htmlParts += `<img src="${imgName}"/>`

              // 设置封面
              const coverIndex = config.get('download', 'default_cover_index') as number
              if (coverIndex === picIdx) {
                builder.setCover(`${volumeName}_${picIdx + 1}.${suffix}`, content)
              }
              await sleep(200)
            }
          }
          chapters.push({
            title: '插图',
            content: htmlParts,
            fileName: `illustrations_${volumeName}.xhtml`,
          })
        }
      } else {
        const $ = await crawler.fetch(link)
        const textDiv = $('#content')
        textDiv.find('ul').each((_i, ul) => {
          $(ul).remove()
        })
        chapters.push({
          title: name,
          content: textDiv.html() || '',
          fileName: `${itemIdx}.xhtml`,
        })
      }
    }

    // 添加章节和图片到 builder
    for (const ch of chapters) {
      builder.addChapter(ch)
    }
    for (const img of images) {
      builder.addImage(img)
    }

    const epubBuffer = await builder.build()
    const saveDir = join(NOVEL_PATH, bookTitle)
    mkdirSync(saveDir, { recursive: true })
    writeFileSync(join(saveDir, `${volumeName}.epub`), epubBuffer)
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

    for (const [volName, volume] of Object.entries(book.volumes)) {
      let htmlParts = `<img src="images/${volName}_1.jpg"/>` // 卷首图占位

      for (const item of volume) {
        const name = item.name
        const link = `${book.baseChapterUrl}${item.link}`

        if (name === '插图') {
          const urls = await book.getChapterImageUrls(volName)
          if (urls) {
            for (let picIdx = 0; picIdx < urls.length; picIdx++) {
              const url = urls[picIdx]
              const suffix = url.split('.').pop() || 'jpg'
              const content = await crawler.getImageContent(url)
              if (content) {
                const imgName = `images/${volName}_${picIdx + 1}.${suffix}`
                images.push({ fileName: imgName, data: content, mediaType: guessType(suffix) })
                htmlParts += `<img src="${imgName}"/>`
                await sleep(200)
              }
            }
            htmlParts += '<br/>'
          }
        } else {
          const $ = await crawler.fetch(link)
          const textDiv = $('#content')
          textDiv.find('ul').each((_i, ul) => {
            $(ul).remove()
          })
          htmlParts += `<h2>${name}</h2><body>${textDiv.html() || ''}</body><br/>`
        }
      }

      chapters.push({
        title: volName,
        content: htmlParts,
        fileName: `${volName}.xhtml`,
      })
    }

    for (const ch of chapters) {
      builder.addChapter(ch)
    }
    for (const img of images) {
      builder.addImage(img)
    }

    const epubBuffer = await builder.build()
    writeFileSync(join(NOVEL_PATH, `${bookTitle}.epub`), epubBuffer)
  }
}

function guessType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/jpeg'
  }
}
