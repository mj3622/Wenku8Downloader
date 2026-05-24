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
    const content = this.htmlEntitiesToNumeric(ch.content)
    const xhtmlContent = this.fixVoidElementsForXhtml(content)
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${this.escapeXml(ch.title)}</title></head>
<body>
  <h2>${this.escapeXml(ch.title)}</h2>
  ${xhtmlContent}
</body>
</html>`
  }

  /** 将 HTML 命名实体转为 XML 兼容的数值实体（如 &nbsp; → &#160;） */
  private htmlEntitiesToNumeric(s: string): string {
    // 先保护已有的 XML 预定义实体（&amp; &lt; &gt; &quot; &apos;）
    // 用占位符替换它们，避免被后续的 & 替换误伤
    const amp = s.replace(/&amp;/g, '\x00AMP\x00')
    const lt = amp.replace(/&lt;/g, '\x00LT\x00')
    const gt = lt.replace(/&gt;/g, '\x00GT\x00')
    const quot = gt.replace(/&quot;/g, '\x00QUOT\x00')
    const apos = quot.replace(/&apos;/g, '\x00APOS\x00')

    // 将所有 &word; 模式转为 &#NNN; 数值实体
    const converted = apos.replace(/&([a-zA-Z]+);/g, (_m, name: string) => {
      const cp = HTML_ENTITY_CODEPOINTS[name]
      return cp !== undefined ? `&#${cp};` : _m
    })

    // 恢复 XML 预定义实体
    return converted
      .replace(/\x00AMP\x00/g, '&amp;')
      .replace(/\x00LT\x00/g, '&lt;')
      .replace(/\x00GT\x00/g, '&gt;')
      .replace(/\x00QUOT\x00/g, '&quot;')
      .replace(/\x00APOS\x00/g, '&apos;')
  }

  /** 将 HTML void 元素转为 XHTML 兼容的自闭合标签（如 <br> → <br/>） */
  private fixVoidElementsForXhtml(s: string): string {
    const voidElements = ['br', 'hr', 'img', 'input', 'link', 'meta', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']
    // 匹配未自闭合的 void 元素: <tagname ...>  排除已闭合的 /> 和 </tagname>
    const pattern = new RegExp(`<(${voidElements.join('|')})(\\s[^>]*)?(?<!/)>`, 'gi')
    return s.replace(pattern, '<$1$2/>')
  }

  private escapeXml(s: string): string {
    return escapeXml(s)
  }
}

/** XML 特殊字符转义 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 常见 HTML 命名实体 → Unicode 码点映射 */
const HTML_ENTITY_CODEPOINTS: Record<string, number> = {
  nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165,
  brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171,
  not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177,
  sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183,
  cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189,
  frac34: 190, iquest: 191, times: 215, divide: 247,
  quot: 34, apos: 39, lt: 60, gt: 62,
  ndash: 8211, mdash: 8212, hellip: 8230,
  lsquo: 8216, rsquo: 8217, sbquo: 8218,
  ldquo: 8220, rdquo: 8221, bdquo: 8222,
  bull: 8226, trade: 8482,
  weierp: 8472, image: 8465, real: 8476,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595,
  harr: 8596, crarr: 8629,
  spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353,
  Yuml: 376, circ: 710, tilde: 732,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204,
  zwj: 8205, lrm: 8206, rlm: 8207,
  minus: 8722, lowast: 8727, radic: 8730,
  prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744,
  cap: 8745, cup: 8746, int: 8747, there4: 8756,
  sim: 8764, cong: 8773, asymp: 8776, ne: 8800,
  equiv: 8801, le: 8804, ge: 8805,
  sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839,
  oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901,
  lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971,
  lang: 9001, rang: 9002,
  loz: 9674, amp: 38,
}

export function guessMediaType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/jpeg'
  }
}
