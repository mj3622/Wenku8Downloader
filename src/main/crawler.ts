import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import { config } from './config-manager'
import type { SearchResult } from './types'
import { sleep } from './utils'
import { proxyRuntime } from './proxy-runtime'
import { flareSolverrClient } from './flaresolverr-client'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const COMMON_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
}

const BASE_URL = 'https://www.wenku8.net'
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

function isElectronRuntime(): boolean {
  return Boolean(process.versions.electron)
}

function runtimeFetch(url: string, init: RequestInit): Promise<Response> {
  return proxyRuntime.fetch(url, init)
}

function assertAllowedUrl(input: string): string {
  const url = new URL(input, BASE_URL)
  const allowedHost =
    url.hostname === 'wenku8.net' ||
    url.hostname.endsWith('.wenku8.net') ||
    url.hostname === 'img.wenku8.com' ||
    url.hostname === 'pic.777743.xyz'
  if (url.protocol !== 'https:' || !allowedHost) {
    throw new Error('拒绝访问非轻小说文库地址')
  }
  return url.toString()
}

export function normalizeWenku8ImageUrl(input: string): string {
  return assertAllowedUrl(input.replace(/^http:\/\//i, 'https://'))
}

export function filterWenku8ImageUrls(inputs: string[]): string[] {
  const urls: string[] = []
  for (const input of inputs) {
    try {
      urls.push(normalizeWenku8ImageUrl(input))
    } catch {
      // Ignore unrelated advertising and tracking images.
    }
  }
  return urls
}

export type ImageResource = {
  content: Buffer
  contentType: string
}

async function allowedFetch(url: string, init: RequestInit): Promise<Response> {
  let currentUrl = assertAllowedUrl(url)
  for (let redirectCount = 0; redirectCount < 6; redirectCount++) {
    const response = await runtimeFetch(currentUrl, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) return response
    currentUrl = assertAllowedUrl(new URL(location, currentUrl).toString())
  }
  throw new Error('轻小说文库重定向次数过多')
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (withSetCookie.getSetCookie) return withSetCookie.getSetCookie()
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

function parseSetCookies(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const header of getSetCookieHeaders(headers)) {
    const [pair] = header.split(';', 1)
    const separator = pair.indexOf('=')
    if (separator > 0) {
      cookies[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim()
    }
  }
  return cookies
}

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
  private userAgent: string
  private preferSolver: boolean

  constructor(cookie?: Record<string, string>) {
    this.cookies = cookie ?? this.getCookieDefaults()
    this.userAgent = config.getAll().cookie?.userAgent || DEFAULT_USER_AGENT
    this.preferSolver = flareSolverrClient.available && Boolean(config.getAll().cookie?.cf_clearance)

    void this.injectCookies()
  }

  syncCookies(): void {
    this.cookies = this.getCookieDefaults()
    this.userAgent = config.getAll().cookie?.userAgent || DEFAULT_USER_AGENT
    void this.injectCookies()
  }

  private getCommonHeaders(): Record<string, string> {
    return {
      ...COMMON_HEADERS,
      'User-Agent': this.userAgent,
    }
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
    if (!isElectronRuntime()) return
    const ses = await proxyRuntime.getElectronSession()
    if (!ses) return
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
    url = assertAllowedUrl(url)
    const maxRetries = 3
    let lastError: Error | null = null
    let solverAttempted = false
    if (!isElectronRuntime() && this.preferSolver && flareSolverrClient.available) {
      solverAttempted = true
      try {
        return await this.fetchWithSolver(url, parse)
      } catch (error) {
        lastError = error as Error
      }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          ...this.getCommonHeaders(),
          'Referer': `${BASE_URL}/`,
        }
        if (!isElectronRuntime()) {
          headers.Cookie = Object.entries(this.cookies)
            .filter(([, value]) => Boolean(value))
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }

        const resp = await allowedFetch(url, {
          method: 'GET',
          headers,
        })

        if (!resp.ok) {
          throw new Error(formatHttpError(resp.status))
        }

        if (parse) {
          const buf = Buffer.from(await resp.arrayBuffer())
          // wenku8 uses GBK encoding
          const html = iconv.decode(buf, 'gbk')
          const $ = cheerio.load(html) as unknown as cheerio.CheerioAPI
          // Attach final URL for redirect detection (like Python's soup.my_url)
          ;($ as unknown as Record<string, unknown>).myUrl = resp.url
          return $
        } else {
          return Buffer.from(await resp.arrayBuffer())
        }
      } catch (err) {
        lastError = err as Error
        if (
          !isElectronRuntime() &&
          !solverAttempted &&
          flareSolverrClient.available &&
          lastError.message.includes('HTTP 403')
        ) {
          solverAttempted = true
          try {
            return await this.fetchWithSolver(url, parse)
          } catch (solverError) {
            lastError = solverError as Error
          }
        }
        if (attempt < maxRetries - 1) {
          await sleep(8000)
          // Re-inject cookies on retry
          await this.injectCookies()
        }
      }
    }

    throw new Error(`请求失败（已重试 3 次）: ${lastError?.message}`)
  }

  private async fetchWithSolver(
    url: string,
    parse: boolean,
  ): Promise<cheerio.CheerioAPI | Buffer> {
    const solved = await flareSolverrClient.getPage(
      url,
      this.cookies,
      config.getAll().proxy,
      await proxyRuntime.getSharedProxyUrl(),
    )
    this.preferSolver = true
    this.saveSolverSession(solved.cookies, solved.userAgent)
    if (!parse) return iconv.encode(solved.html, 'gbk')
    const $ = cheerio.load(solved.html) as unknown as cheerio.CheerioAPI
    ;($ as unknown as Record<string, unknown>).myUrl = solved.url
    return $
  }

  async getCookie(): Promise<void> {
    const loginCfg = config.getAll().login
    const username = loginCfg?.username
    const password = loginCfg?.password

    if (!username || !password) {
      throw new Error('请先配置登录账号和密码')
    }

    const loginUrl = `${BASE_URL}/login.php?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php`
    const body = new URLSearchParams({
      username,
      password,
      usecookie: '315360000',
      action: 'login',
      submit: '',
    })
    const maxRetries = 3

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (isElectronRuntime()) {
          const ses = await proxyRuntime.getElectronSession()
          await ses?.cookies.remove(BASE_URL, 'jieqiUserInfo')
          await ses?.cookies.remove(BASE_URL, 'jieqiVisitInfo')
        }

        const resp = await runtimeFetch(loginUrl, {
          method: 'POST',
          headers: {
            ...this.getCommonHeaders(),
            'Referer': `${BASE_URL}/login.php`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          redirect: isElectronRuntime() ? 'follow' : 'manual',
        })

        if (!resp.ok && !(!isElectronRuntime() && resp.status >= 300 && resp.status < 400)) {
          throw new Error(formatHttpError(resp.status))
        }

        const cookieMap: Record<string, string> = {}
        if (isElectronRuntime()) {
          const ses = await proxyRuntime.getElectronSession()
          const cookies = await ses?.cookies.get({ url: BASE_URL }) ?? []
          for (const cookie of cookies) {
            cookieMap[cookie.name] = cookie.value
          }
        } else {
          Object.assign(cookieMap, parseSetCookies(resp.headers))
        }

        this.saveLoginCookies(cookieMap)
        return
      } catch (err) {
        const error = err as Error
        if (
          attempt === 0 &&
          flareSolverrClient.available &&
          error.message.includes('HTTP 403')
        ) {
          try {
            const solved = await flareSolverrClient.solveLogin(
              loginUrl,
              body.toString(),
              config.getAll().proxy,
              await proxyRuntime.getSharedProxyUrl(),
            )
            this.saveLoginCookies(solved.cookies, solved.userAgent)
            return
          } catch (solverError) {
            throw new Error(`登录失败: ${(solverError as Error).message}`)
          }
        }
        if (attempt >= maxRetries - 1) {
          throw new Error(`登录失败: ${(err as Error).message}`)
        }
        await sleep(5000)
      }
    }
  }

  private saveLoginCookies(cookieMap: Record<string, string>, userAgent?: string): void {
    if (!cookieMap.jieqiUserInfo && !cookieMap.jieqiVisitInfo) {
      throw new Error('用户名或密码错误，未获取到登录 Cookie')
    }

    if (flareSolverrClient.available) this.preferSolver = true
    this.saveSolverSession(cookieMap, userAgent)
  }

  private saveSolverSession(cookieMap: Record<string, string>, userAgent?: string): void {
    const cfg = config.getAll()
    config.set('cookie', 'PHPSESSID', cookieMap.PHPSESSID ?? cfg.cookie?.PHPSESSID ?? '')
    config.set('cookie', 'jieqiUserInfo', cookieMap.jieqiUserInfo ?? cfg.cookie?.jieqiUserInfo ?? '')
    config.set('cookie', 'jieqiVisitInfo', cookieMap.jieqiVisitInfo ?? cfg.cookie?.jieqiVisitInfo ?? '')
    config.set('cookie', 'cf_clearance', cookieMap.cf_clearance ?? cfg.cookie?.cf_clearance ?? '')
    if (userAgent) config.set('cookie', 'userAgent', userAgent)
    this.syncCookies()
  }

  async getImageContent(url: string): Promise<Buffer | null> {
    return (await this.getImageResource(url))?.content ?? null
  }

  async getImageResource(url: string): Promise<ImageResource | null> {
    url = normalizeWenku8ImageUrl(url)
    const maxRetries = 3
    let lastError: string | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          ...this.getCommonHeaders(),
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        }
        if (!isElectronRuntime()) {
          headers.Cookie = Object.entries(this.cookies)
            .filter(([, value]) => Boolean(value))
            .map(([name, value]) => `${name}=${value}`)
            .join('; ')
        }

        const resp = await allowedFetch(url, {
          method: 'GET',
          headers,
        })

        if (resp.ok) {
          const contentType = resp.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
          const contentLength = Number(resp.headers.get('content-length') ?? '0')
          if (!contentType?.startsWith('image/')) {
            throw new Error('图片服务器返回了无效内容')
          }
          if (contentLength > MAX_IMAGE_BYTES) {
            throw new Error('图片文件过大')
          }
          const content = Buffer.from(await resp.arrayBuffer())
          if (content.length > MAX_IMAGE_BYTES) {
            throw new Error('图片文件过大')
          }
          return { content, contentType }
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
      return this.searchMultiResult($)
    }
    return this.searchSingleResult($)
  }

  private searchMultiResult($: cheerio.CheerioAPI): SearchResult[] {
    const results: SearchResult[] = []
    const td = $('#content table tr td')
    td.children('div').each((_i, div) => {
      const a = $(div).find('a').first()
      const img = a.find('img')
      const titleText = a.attr('title') || ''
      const rawCover = img.attr('src') || ''
      const cover = rawCover ? normalizeWenku8ImageUrl(rawCover) : ''
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

  private searchSingleResult($: cheerio.CheerioAPI): SearchResult[] {
    const results: SearchResult[] = []
    const title = $('title').text()
    const pageTitle = title.split('-')[0]?.trim() || ''
    const myUrl = ($ as unknown as Record<string, string>).myUrl || ''
    const bookId = myUrl.split('/book/')[1]?.split('.')[0] || ''
    const rawCover = $('#content img').first().attr('src') || ''
    const cover = rawCover ? normalizeWenku8ImageUrl(rawCover) : ''
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
        updateTime: '',
        tags: '',
        desc,
      })
    }
    return results
  }
}

