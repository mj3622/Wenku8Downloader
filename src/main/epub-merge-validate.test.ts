import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import iconv from 'iconv-lite'
import JSZip from 'jszip'

const mocks = vi.hoisted(() => ({
  savePath: '',
  fetch: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => mocks.savePath,
  },
  net: { fetch: mocks.fetch },
  session: {
    defaultSession: {
      cookies: {
        set: vi.fn(async () => undefined),
        get: vi.fn(async () => []),
        remove: vi.fn(async () => undefined),
      },
    },
  },
}))

import { Book } from './book'
import { WebCrawler, type CrawlerConfig } from './crawler'
import { emptyCookieSnapshot } from './config/secret-types'
import { DownloadRateLimiter } from './download-rate-limiter'
import { Downloader } from './downloader'

const BOOK_URL = 'https://www.wenku8.net/book/100.htm'
const INDEX_URL = 'https://www.wenku8.net/novel/1/100/index.htm'
const ILLUSTRATION_PAGE_URL = 'https://www.wenku8.net/novel/1/100/illust.htm'
const CHAPTER_ONE_URL = 'https://www.wenku8.net/novel/1/100/1.htm'
const CHAPTER_TWO_URL = 'https://www.wenku8.net/novel/1/100/2.htm'
const COVER_URL = 'https://img.example/cover.jpg'
const ILLUSTRATION_URL = 'https://img.example/illust.png'

const BOOK_HTML = `
  <div id="content">
    <div><a href="${INDEX_URL}">小说目录</a></div>
    <table>
      <tr><td><b>测试作品</b></td></tr>
      <tr><td></td></tr>
      <tr>
        <td>文库：测试文库</td><td>作者：测试作者</td><td>状态：连载</td>
        <td>更新时间：2026-08-22</td><td>全文长度：1234</td>
      </tr>
    </table>
    <img src="${COVER_URL}"/>
    <span class="hottext">内容简介：</span><span>固定测试简介</span>
  </div>`

const INDEX_HTML = `
  <table class="css">
    <tr><td class="vcss">第一卷</td></tr>
    <tr><td>
      <a href="illust.htm">插图</a>
      <a href="1.htm">第一章</a>
      <a href="2.htm">第二章</a>
    </td></tr>
  </table>`

const HTML_FIXTURES = new Map([
  [BOOK_URL, BOOK_HTML],
  [INDEX_URL, INDEX_HTML],
  [ILLUSTRATION_PAGE_URL, `<div id="content"><img src="${ILLUSTRATION_URL}"/></div>`],
  [CHAPTER_ONE_URL, '<div id="content"><p>第一章&nbsp;正文<br>下一行</p><ul>广告</ul></div>'],
  [CHAPTER_TWO_URL, '<div id="content"><p>第二章正文 &amp; 结尾</p></div>'],
])

function response(body: Buffer, url: string) {
  return {
    ok: true,
    status: 200,
    url,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}

let root: string

describe('WebCrawler to EPUB production integration', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-epub-flow-'))
    mocks.savePath = root
    mocks.fetch.mockImplementation(async (input: string | URL) => {
      const url = String(input)
      const html = HTML_FIXTURES.get(url)
      if (html !== undefined) return response(iconv.encode(html, 'gbk'), url)
      if (url === COVER_URL) return response(Buffer.from('cover-image'), url)
      if (url === ILLUSTRATION_URL) return response(Buffer.from('illustration-image'), url)
      throw new Error(`Unexpected fixture URL: ${url}`)
    })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('parses fixtures through production modules and creates a structurally complete EPUB', async () => {
    const config: CrawlerConfig = {
      getCredentialRevision: () => 0,
      getCredentials: () => ({ username: '', password: '' }),
      getCookies: () => emptyCookieSnapshot(),
      replaceCookies: vi.fn(),
    }
    const crawler = new WebCrawler(config, {})
    const book = await Book.create('100', crawler)
    const downloader = new Downloader(
      crawler,
      {
        fullTitle: 'FULL',
        defaultCoverIndex: 0,
        downloadPath: root,
        rootPath: root,
      },
      new DownloadRateLimiter(vi.fn()),
    )

    await downloader.downloadNovel(book)

    const epub = await readFile(join(root, 'novels', '100_测试作品.epub'))
    const zip = await JSZip.loadAsync(epub)
    const xhtml = await zip.file('OEBPS/1_第一卷.xhtml')!.async('string')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string')

    expect(book.basicInfo).toMatchObject({ '标题': '测试作品', '作者': '测试作者' })
    expect(xhtml).toContain('<img src="images/1_第一卷_1.png"/>')
    expect(xhtml).toContain('<h2>第一章</h2>')
    expect(xhtml).toContain('第一章&#160;正文<br/>下一行')
    expect(xhtml).not.toContain('广告')
    expect(xhtml.indexOf('第一章')).toBeLessThan(xhtml.indexOf('第二章'))
    expect(zip.file('OEBPS/images/cover.jpg')).not.toBeNull()
    expect(zip.file('OEBPS/images/1_第一卷_1.png')).not.toBeNull()

    const manifestItems = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"[^>]*>/g)]
      .map((match) => ({ id: match[1], href: match[2] }))
    const manifestIds = manifestItems.map((item) => item.id)
    expect(new Set(manifestIds).size).toBe(manifestIds.length)
    for (const item of manifestItems) {
      expect(zip.file(`OEBPS/${item.href}`), `missing manifest resource ${item.href}`).not.toBeNull()
    }

    const spineIds = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((match) => match[1])
    expect(spineIds.length).toBeGreaterThan(0)
    expect(spineIds.every((id) => manifestIds.includes(id))).toBe(true)
    const coverId = opf.match(/<meta name="cover" content="([^"]+)"/)?.[1]
    expect(coverId).toBeDefined()
    expect(manifestIds).toContain(coverId)

    const navSources = [...ncx.matchAll(/<content src="([^"]+)"/g)].map((match) => match[1])
    expect(navSources).toContain('1_第一卷.xhtml')
    for (const source of navSources) {
      expect(zip.file(`OEBPS/${source}`), `missing navigation target ${source}`).not.toBeNull()
    }

    expect(mocks.fetch).toHaveBeenCalledWith(
      CHAPTER_ONE_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
