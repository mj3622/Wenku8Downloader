import JSZip from 'jszip'

export interface EpubChapter {
  title: string
  content: string   // XHTML body (without <html>/<body> wrappers)
  fileName: string  // e.g. "chapter1.xhtml"
}

export interface EpubImage {
  fileName: string  // e.g. "images/vol1_1.jpg"
  data: Buffer
  mediaType: string
}

export class EpubBuilder {
  private title = ''
  private author = ''
  private lang = 'zh'
  private coverFileName: string | null = null
  private coverData: Buffer | null = null
  private chapters: EpubChapter[] = []
  private images: EpubImage[] = []
  private idCounter = 0

  setTitle(title: string): void {
    this.title = title
  }

  setAuthor(author: string): void {
    this.author = author
  }

  setLanguage(lang: string): void {
    this.lang = lang
  }

  setCover(fileName: string, data: Buffer): void {
    this.coverFileName = fileName
    this.coverData = data

    // 封面也加入图片列表
    this.images.push({
      fileName: `images/${fileName}`,
      data,
      mediaType: guessMediaType(fileName),
    })
  }

  addChapter(chapter: EpubChapter): void {
    this.chapters.push(chapter)
  }

  addImage(image: EpubImage): void {
    this.images.push(image)
  }

  async build(): Promise<Buffer> {
    const zip = new JSZip()

    // mimetype — 必须首条、不压缩
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

    // META-INF/container.xml
    zip.file('META-INF/container.xml', this.buildContainerXml())

    // OEBPS/
    const oebps = zip.folder('OEBPS')!

    // 添加章节
    for (const ch of this.chapters) {
      oebps.file(ch.fileName, this.wrapXhtml(ch))
    }

    // 添加图片
    for (const img of this.images) {
      oebps.file(img.fileName, img.data)
    }

    // content.opf
    oebps.file('content.opf', this.buildOpf())

    // toc.ncx
    oebps.file('toc.ncx', this.buildNcx())

    // nav.xhtml
    oebps.file('nav.xhtml', this.buildNav())

    // 生成 ZIP buffer
    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    return Buffer.from(arrayBuffer)
  }

  private nextId(): string {
    this.idCounter++
    return `id${this.idCounter}`
  }

  private buildContainerXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  }

  private buildOpf(): string {
    const uid = 'wenku8-' + Date.now()
    const manifestItems: string[] = []
    const spineItems: string[] = []

    // NCX
    manifestItems.push('    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')
    // Nav
    manifestItems.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')

    // 章节
    for (const ch of this.chapters) {
      const id = this.nextId()
      manifestItems.push(`    <item id="${id}" href="${ch.fileName}" media-type="application/xhtml+xml"/>`)
      spineItems.push(`    <itemref idref="${id}"/>`)
    }

    // 图片
    for (const img of this.images) {
      const id = this.nextId()
      manifestItems.push(`    <item id="${id}" href="${img.fileName}" media-type="${img.mediaType}"/>`)
    }

    // 封面图片（在 manifest 中引用）
    let coverMeta = ''
    if (this.coverFileName) {
      // 找到封面图片对应的 id
      const coverImg = this.images.find((img) => img.fileName === `images/${this.coverFileName}`)
      if (coverImg) {
        const idx = this.images.indexOf(coverImg)
        const coverId = `id${this.chapters.length + idx + 1}`
        coverMeta = `    <meta name="cover" content="${coverId}"/>`
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">${uid}</dc:identifier>
    <dc:title>${this.escapeXml(this.title)}</dc:title>
    <dc:creator>${this.escapeXml(this.author)}</dc:creator>
    <dc:language>${this.lang}</dc:language>
${coverMeta}
  </metadata>
  <manifest>
    ${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
    ${spineItems.join('\n')}
  </spine>
</package>`
  }

  private buildNcx(): string {
    const uid = 'wenku8-ncx-' + Date.now()
    const navPoints: string[] = []

    let playOrder = 1
    for (const ch of this.chapters) {
      const id = this.nextId()
      navPoints.push(`    <navPoint id="${id}" playOrder="${playOrder++}">
      <navLabel><text>${this.escapeXml(ch.title)}</text></navLabel>
      <content src="${ch.fileName}"/>
    </navPoint>`)
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${this.escapeXml(this.title)}</text></docTitle>
  <navMap>
    ${navPoints.join('\n')}
  </navMap>
</ncx>`
  }

  private buildNav(): string {
    const items: string[] = []
    for (const ch of this.chapters) {
      items.push(`      <li><a href="${ch.fileName}">${this.escapeXml(ch.title)}</a></li>`)
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <h2>目录</h2>
    <ol>
${items.join('\n')}
    </ol>
  </nav>
</body>
</html>`
  }

  private wrapXhtml(ch: EpubChapter): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${this.escapeXml(ch.title)}</title></head>
<body>
  <h2>${this.escapeXml(ch.title)}</h2>
  ${ch.content}
</body>
</html>`
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}

function guessMediaType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/jpeg'
  }
}
