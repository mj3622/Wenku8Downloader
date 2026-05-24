import { net, session } from 'electron'
import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import { config } from './config-manager'
import type { SearchResult } from './types'
import { sleep } from './utils'

const COMMON_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const BASE_URL = 'https://www.wenku8.net'

function formatHttpError(status: number): string {
  if (status === 429) return '访问过于频繁（HTTP 429），服务器限制了请求频率，请稍后重试'
  if (status === 403) return '访问被拒绝（HTTP 403），Cookie 可能已过期，请尝试刷新 Cookie'
  return `HTTP ${status}`
}

function encodeKey(key: string): string {
  const gbk = iconv.encode(key, 'gbk')
  let result = ''
  for (let i = 0; i < gbk.length; i++) {
    const byte = gbk[i]
    result += '%' + (byte < 16 ? '0' : '') + byte.toString(16)
  }
  return result
}

export class WebCrawler {
  private cookies: Record<string, string>
  constructor(cookie?: Record<string, string>) {
    this.cookies = cookie ?? this.getCookieDefaults()

    void this.injectCookies()
  }

  syncCookies(): void {
    this.cookies = this.getCookieDefaults()
    this.injectCookies()
  }

  private getCookieDefaults(): Record<string, string> {
    const cfg = config.getAll()
    return {
      PHPSESSID: cfg.cookie?.PHPSESSID ?? '',
      jieqiUserInfo: cfg.cookie?.jieqiUserInfo ?? '',
      jieqiVisitInfo: cfg.cookie?.jieqiVisitInfo ?? '',
      cf_clearance: cfg.cookie?.cf_clearance ?? '',
    }
  }

  private async injectCookies(): Promise<void> {
    const ses = session.defaultSession
    for (const [name, value] of Object.entries(this.cookies)) {
      if (value) {
        await ses.cookies.set({
          url: BASE_URL,
          name,
          value,
          domain: '.wenku8.net',
          path: '/',
        })
      }
    }
  }

  async fetch(url: string): Promise<cheerio.CheerioAPI>
  async fetch(url: string, parse: false): Promise<Buffer>
  async fetch(url: string, parse: boolean = true): Promise<cheerio.CheerioAPI | Buffer> {
    // Resolve relative URLs against base
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
    }
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          ...COMMON_HEADERS,
          'Referer': `${BASE_URL}/`,
        }

        const resp = await net.fetch(url, {
          method: 'GET',
          headers,
          redirect: 'follow',
        })

        if (!resp.ok) {
          throw new Error(formatHttpError(resp.status))
        }

        if (parse) {
          const buf = Buffer.from(await resp.arrayBuffer())
          // wenku8 uses GBK encoding
          const html = iconv.decode(buf, 'gbk')
          const $ = cheerio.load(html)
          // Attach final URL for redirect detection (like Python's soup.my_url)
          ;($ as unknown as Record<string, unknown>).myUrl = resp.url
          return $
        } else {
          return Buffer.from(await resp.arrayBuffer())
        }
      } catch (err) {
        lastError = err as Error
        if (attempt < maxRetries - 1) {
          await sleep(8000)
          // Re-inject cookies on retry
          await this.injectCookies()
        }
      }
    }

    throw new Error(`请求失败（已重试 3 次）: ${lastError?.message}`)
  }

  async getCookie(): Promise<void> {
    const loginCfg = config.getAll().login
    const username = loginCfg?.username
    const password = loginCfg?.password

    if (!username || !password) {
      throw new Error('请先配置登录账号和密码')
    }

    const loginUrl = `${BASE_URL}/login.php?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php`
    const maxRetries = 3

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const body = new URLSearchParams({
          username,
          password,
          usecookie: '315360000',
          action: 'login',
          submit: '',
        })

        const resp = await net.fetch(loginUrl, {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            'Referer': `${BASE_URL}/login.php`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          redirect: 'follow',
        })

        if (!resp.ok) {
          throw new Error(formatHttpError(resp.status))
        }

        // Extract cookies from response
        const ses = session.defaultSession
        const cookies = await ses.cookies.get({ url: BASE_URL })
        const cookieMap: Record<string, string> = {}
        for (const c of cookies) {
          cookieMap[c.name] = c.value
        }

        const cfg = config.getAll()
        config.set('cookie', 'PHPSESSID', cookieMap['PHPSESSID'] ?? cfg.cookie?.PHPSESSID ?? '')
        config.set('cookie', 'jieqiUserInfo', cookieMap['jieqiUserInfo'] ?? cfg.cookie?.jieqiUserInfo ?? '')
        config.set('cookie', 'jieqiVisitInfo', cookieMap['jieqiVisitInfo'] ?? cfg.cookie?.jieqiVisitInfo ?? '')
        config.set('cookie', 'cf_clearance', cookieMap['cf_clearance'] ?? cfg.cookie?.cf_clearance ?? '')
        this.syncCookies()
        return
      } catch (err) {
        if (attempt >= maxRetries - 1) {
          throw new Error(`登录失败: ${(err as Error).message}`)
        }
        await sleep(5000)
      }
    }
  }

  async getImageContent(url: string): Promise<Buffer | null> {
    url = url.replace('http://', 'https://')
    const maxRetries = 3
    let lastError: string | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await net.fetch(url, {
          method: 'GET',
          headers: {
            ...COMMON_HEADERS,
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        })

        if (resp.ok) {
          return Buffer.from(await resp.arrayBuffer())
        }

        lastError = formatHttpError(resp.status)
        const backoffMs = resp.status === 429 ? 15000 * (attempt + 1) : 2000 * (attempt + 1)
        if (attempt < maxRetries - 1) {
          await sleep(backoffMs)
        }
      } catch (err) {
        lastError = (err as Error).message
        const is429 = lastError.includes('429')
        const backoffMs = is429 ? 15000 * (attempt + 1) : 2000 * (attempt + 1)
        if (attempt < maxRetries - 1) {
          await sleep(backoffMs)
        }
      }
    }

    if (lastError) {
      throw new Error(lastError)
    }
    return null
  }

  async search(keyword: string, type: 'author' | 'title'): Promise<SearchResult[]> {
    const encoded = encodeKey(keyword)
    const searchType = type === 'author' ? 'author' : 'articlename'
    const url = `${BASE_URL}/modules/article/search.php?searchtype=${searchType}&searchkey=${encoded}`

    const $ = await this.fetch(url)

    const title = $('title').text()
    if (!title) {
      throw new Error('页面无标题，可能被拦截')
    }

    const blockMsg = $('.blockcontent').text()
    if (blockMsg.includes('两次搜索的间隔时间')) {
      throw new Error('搜索过于频繁，请等待片刻再试')
    }

    if ($('#content table.grid').length > 0) {
      return this.searchMultiResult($, keyword)
    }
    return this.searchSingleResult($, keyword)
  }

  private searchMultiResult($: cheerio.CheerioAPI, keyword: string): SearchResult[] {
    const results: SearchResult[] = []
    const td = $('#content table tr td')
    td.children('div').each((_i, div) => {
      const a = $(div).find('a').first()
      const img = a.find('img')
      const titleText = a.attr('title') || ''
      const cover = img.attr('src') || ''
      const href = a.attr('href') || ''
      const bookId = href.split('/').pop()?.split('.')[0] || ''

      const ps = $(div).find('p')
      const p1 = ps.eq(0).text()
      const statusText = ps.eq(1).text()
      const tags = ps.eq(2).text().replace('Tags:', '').trim()
      const desc = ps.eq(3).text().replace('简介:', '').trim()

      const authorPart = p1.split('/').find((s: string) => s.includes('作者:')) || ''
      const author = authorPart.replace('作者:', '').trim()
      const updatePart = p1.split('/').find((s: string) => s.includes('更新:')) || ''
      const updateTime = updatePart.replace('更新:', '').trim()

      results.push({
        title: titleText,
        cover,
        id: bookId,
        author,
        status: statusText.trim(),
        updateTime,
        tags,
        desc,
      })
    })
    return results
  }

  private searchSingleResult($: cheerio.CheerioAPI, keyword: string): SearchResult[] {
    const results: SearchResult[] = []
    const title = $('title').text()
    const pageTitle = title.split('-')[0]?.trim() || ''
    const myUrl = ($ as unknown as Record<string, string>).myUrl || ''
    const bookId = myUrl.split('/book/')[1]?.split('.')[0] || ''
    const cover = $('#content img').first().attr('src') || ''
    const infoTable = $('#content table')
    let author = ''
    let status = ''
    let desc = ''

    infoTable.find('tr').eq(2).find('td').each((i, td) => {
      const text = $(td).text().trim()
      if (text.includes('作者：')) author = text.replace('作者：', '').trim()
      if (text.includes('状态：')) status = text.replace('状态：', '').trim()
    })

    const spans = $('#content span')
    spans.each((_i, span) => {
      const t = $(span).text()
      if (t.includes('内容简介：')) {
        desc = t.replace('内容简介：', '').trim()
      }
    })

    if (bookId) {
      results.push({
        title: pageTitle,
        cover,
        id: bookId,
        author,
        status,
        tags: '',
        desc,
      })
    }
    return results
  }
}

