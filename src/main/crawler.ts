import { net, session } from 'electron'
import * as cheerio from 'cheerio'
import iconv from 'iconv-lite'
import {
  COOKIE_NAMES,
  type CookieSnapshot,
  type Credentials,
} from './config/secret-types'
import type { SearchResult } from './types'
import { sleep } from './utils'
import { logger } from './logging/logger'
import { sanitizeLogText } from './logging/redaction'

type CheerioDocument = ReturnType<typeof cheerio.load>

const COMMON_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const BASE_URL = 'https://www.wenku8.net'
const REQUEST_TIMEOUT_MS = 30_000
export interface CrawlerConfig {
  getCredentialRevision(): number
  getCredentials(): Readonly<Credentials>
  getCookies(): Readonly<CookieSnapshot>
  replaceCookies(input: CookieSnapshot): void
}

class CredentialsChangedDuringLoginError extends Error {
  constructor() {
    super('登录期间账号已变更，请重新刷新 Cookie')
    this.name = 'CredentialsChangedDuringLoginError'
  }
}

function formatHttpError(status: number): string {
  if (status === 429) return '访问过于频繁（HTTP 429），服务器限制了请求频率，请稍后重试'
  if (status === 403) return '访问被拒绝（HTTP 403），Cookie 可能已过期，请尝试刷新 Cookie'
  return `HTTP ${status}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  try {
    return String(error)
  } catch {
    return 'Unknown error'
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error))
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
  constructor(
    private readonly config: CrawlerConfig,
    cookie?: Record<string, string>,
  ) {
    this.cookies = cookie ?? this.getCookieDefaults()
  }

  async syncCookies(): Promise<void> {
    this.cookies = this.getCookieDefaults()
    await this.injectCookies(true)
  }

  private getCookieDefaults(): Record<string, string> {
    const cookies = this.config.getCookies()
    return {
      PHPSESSID: cookies.PHPSESSID,
      jieqiUserInfo: cookies.jieqiUserInfo,
      jieqiVisitInfo: cookies.jieqiVisitInfo,
      cf_clearance: cookies.cf_clearance,
    }
  }

  private async rejectIfCredentialsChanged(expectedRevision: number): Promise<void> {
    if (this.config.getCredentialRevision() === expectedRevision) return
    await this.syncCookies()
    throw new CredentialsChangedDuringLoginError()
  }

  private async injectCookies(clearExisting = false): Promise<void> {
    const ses = session.defaultSession
    if (clearExisting) {
      for (const name of COOKIE_NAMES) {
        await ses.cookies.remove(BASE_URL, name)
      }
    }
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

  async fetch(url: string): Promise<CheerioDocument>
  async fetch(url: string, parse: false): Promise<Buffer>
  async fetch(url: string, parse: boolean = true): Promise<CheerioDocument | Buffer> {
    // Resolve relative URLs against base
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
    }
    const maxRetries = 3
    let lastError: Error | null = null
    let lastStatus: number | undefined
    const startedAt = performance.now()
    if (parse) {
      logger.debug('network.request.started', '开始网页请求', {
        method: 'GET',
        url: sanitizeLogText(url),
        maxAttempts: maxRetries,
      })
    }

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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        lastStatus = resp.status

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
          logger.debug('network.request.completed', '网页请求完成', {
            method: 'GET',
            url: sanitizeLogText(resp.url || url),
            status: resp.status,
            attempt: attempt + 1,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          })
          return $
        } else {
          return Buffer.from(await resp.arrayBuffer())
        }
      } catch (err) {
        lastError = normalizeError(err)
        if (attempt < maxRetries - 1) {
          logger.warn('network.request.retry', '网页请求失败，准备重试', {
            method: 'GET',
            url: sanitizeLogText(url),
            status: lastStatus,
            attempt: attempt + 1,
            maxAttempts: maxRetries,
            backoffMs: 8000,
            error: sanitizeLogText(lastError.message),
          })
          await sleep(8000)
          // Re-inject cookies on retry
          await this.injectCookies()
        }
      }
    }

    const finalError = new Error(
      `请求失败（已重试 ${maxRetries} 次）: ${lastError?.message}`,
      { cause: lastError ?? undefined },
    )
    logger.error('network.request.failed', '网页请求在重试后仍然失败', finalError, {
      method: 'GET',
      url: sanitizeLogText(url),
      status: lastStatus,
      maxAttempts: maxRetries,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    })
    throw finalError
  }

  async getCookie(): Promise<void> {
    const credentialRevision = this.config.getCredentialRevision()
    const { username, password } = this.config.getCredentials()
    const startedAt = performance.now()
    const maxRetries = 3
    logger.info('login.started', '开始刷新登录 Cookie', { maxAttempts: maxRetries })

    if (!username || !password) {
      const error = new Error('请先配置登录账号和密码')
      logger.error('login.failed', '登录 Cookie 刷新失败', error, {
        maxAttempts: maxRetries,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      })
      throw error
    }

    const loginUrl = `${BASE_URL}/login.php?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php`

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (this.config.getCredentialRevision() !== credentialRevision) {
        await this.rejectIfCredentialsChanged(credentialRevision)
      }
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        await this.rejectIfCredentialsChanged(credentialRevision)

        if (!resp.ok) {
          throw new Error(formatHttpError(resp.status))
        }

        // Extract cookies from response
        const ses = session.defaultSession
        const cookies = await ses.cookies.get({ url: BASE_URL })
        await this.rejectIfCredentialsChanged(credentialRevision)
        const cookieMap: Record<string, string> = {}
        for (const c of cookies) {
          cookieMap[c.name] = c.value
        }

        const current = this.config.getCookies()
        this.config.replaceCookies({
          PHPSESSID: cookieMap.PHPSESSID ?? current.PHPSESSID,
          jieqiUserInfo: cookieMap.jieqiUserInfo ?? current.jieqiUserInfo,
          jieqiVisitInfo: cookieMap.jieqiVisitInfo ?? current.jieqiVisitInfo,
          cf_clearance: cookieMap.cf_clearance ?? current.cf_clearance,
        })
        await this.syncCookies()
        await this.rejectIfCredentialsChanged(credentialRevision)
        logger.info('login.completed', '登录 Cookie 刷新完成', {
          attempt: attempt + 1,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        })
        return
      } catch (err) {
        if (err instanceof CredentialsChangedDuringLoginError) {
          logger.error('login.failed', '登录期间账号配置发生变化', err, {
            attempt: attempt + 1,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          })
          throw err
        }
        await this.rejectIfCredentialsChanged(credentialRevision)
        const cause = normalizeError(err)
        const message = cause.message
        if (attempt >= maxRetries - 1) {
          const finalError = new Error(`登录失败: ${message}`, { cause })
          logger.error('login.failed', '登录 Cookie 刷新失败', finalError, {
            attempt: attempt + 1,
            maxAttempts: maxRetries,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          })
          throw finalError
        }
        logger.warn('login.retry', '登录请求失败，准备重试', {
          attempt: attempt + 1,
          maxAttempts: maxRetries,
          backoffMs: 5000,
          error: sanitizeLogText(message),
        })
        await sleep(5000)
      }
    }
  }

  async getImageContent(
    url: string,
    maxRetries = 3,
    onResponseStatus?: (status: number) => void,
  ): Promise<Buffer | null> {
    url = url.replace('http://', 'https://')
    let lastError: string | null = null
    let lastCause: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await net.fetch(url, {
          method: 'GET',
          headers: {
            ...COMMON_HEADERS,
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (resp.ok) {
          const content = Buffer.from(await resp.arrayBuffer())
          onResponseStatus?.(resp.status)
          return content
        }

        onResponseStatus?.(resp.status)
        lastCause = new Error(formatHttpError(resp.status))
        lastError = lastCause.message
        const backoffMs = resp.status === 429 ? 15000 * (attempt + 1) : 2000 * (attempt + 1)
        if (attempt < maxRetries - 1) {
          logger.warn('network.image.retry', '图片请求失败，准备重试', {
            method: 'GET',
            url: sanitizeLogText(url),
            status: resp.status,
            attempt: attempt + 1,
            maxAttempts: maxRetries,
            backoffMs,
          })
          await sleep(backoffMs)
        }
      } catch (err) {
        lastCause = normalizeError(err)
        lastError = lastCause.message
        const is429 = lastError.includes('429')
        const backoffMs = is429 ? 15000 * (attempt + 1) : 2000 * (attempt + 1)
        if (attempt < maxRetries - 1) {
          logger.warn('network.image.retry', '图片请求异常，准备重试', {
            method: 'GET',
            url: sanitizeLogText(url),
            attempt: attempt + 1,
            maxAttempts: maxRetries,
            backoffMs,
            error: sanitizeLogText(lastError),
          })
          await sleep(backoffMs)
        }
      }
    }

    if (lastError) {
      const error = new Error(lastError, { cause: lastCause ?? undefined })
      logger.error('network.image.failed', '图片请求在重试后仍然失败', error, {
        method: 'GET',
        url: sanitizeLogText(url),
        maxAttempts: maxRetries,
      })
      throw error
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

  private searchMultiResult($: CheerioDocument): SearchResult[] {
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

  private searchSingleResult($: CheerioDocument): SearchResult[] {
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
        updateTime: '',
        tags: '',
        desc,
      })
    }
    return results
  }
}

