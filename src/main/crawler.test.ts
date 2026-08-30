import { afterEach, describe, expect, it, vi } from 'vitest'
import { load } from 'cheerio'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getCookies: vi.fn(async (): Promise<Array<{ name: string; value: string }>> => []),
  setCookie: vi.fn(async () => undefined),
  removeCookie: vi.fn(async () => undefined),
  sleep: vi.fn(async (): Promise<void> => undefined),
  sleepWithSignal: vi.fn(async (): Promise<void> => undefined),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
  session: {
    defaultSession: {
      cookies: {
        get: mocks.getCookies,
        set: mocks.setCookie,
        remove: mocks.removeCookie,
      },
    },
  },
}))

vi.mock('./utils', () => ({ sleep: mocks.sleep }))
vi.mock('./download-cancellation', async (importOriginal) => ({
  ...await importOriginal<typeof import('./download-cancellation')>(),
  sleepWithSignal: mocks.sleepWithSignal,
}))
vi.mock('./logging/logger', () => ({ logger: mocks.logger }))

import {
  parseRetryAfter,
  WebCrawler,
  type CrawlerConfig,
  type CrawlerNetworkSession,
} from './crawler'
import { DownloadCancelledError } from './download-cancellation'
import {
  COOKIE_NAMES,
  emptyCookieSnapshot,
  type CookieSnapshot,
  type Credentials,
} from './config/secret-types'

function createConfig(
  cookieOverrides: Partial<ReturnType<CrawlerConfig['getCookies']>> = {},
): CrawlerConfig {
  let cookies = {
    ...emptyCookieSnapshot(),
    ...cookieOverrides,
  }
  return {
    getCredentialRevision: () => 0,
    getCredentials: () => ({ username: '', password: '' }),
    getCookies: () => ({ ...cookies }),
    replaceCookies: (next) => { cookies = { ...next } },
  }
}

function createMutableLoginConfig() {
  let revision = 1
  let credentials = { username: 'old-user', password: 'old-password' }
  let cookies = emptyCookieSnapshot()
  const replaceCookies = vi.fn((next: CookieSnapshot) => {
    cookies = { ...next }
  })
  const config = {
    getCredentialRevision: () => revision,
    getCredentials: () => ({ ...credentials }),
    getCookies: () => ({ ...cookies }),
    replaceCookies,
  } satisfies CrawlerConfig

  return {
    config,
    replaceCookies,
    changeCredentials(next: Credentials, nextCookies: CookieSnapshot) {
      credentials = { ...next }
      cookies = { ...nextCookies }
      revision++
    },
  }
}

afterEach(() => {
  mocks.fetch.mockReset()
  mocks.getCookies.mockReset()
  mocks.getCookies.mockResolvedValue([])
  mocks.setCookie.mockClear()
  mocks.removeCookie.mockClear()
  mocks.sleep.mockClear()
  mocks.sleepWithSignal.mockClear()
  mocks.logger.debug.mockClear()
  mocks.logger.info.mockClear()
  mocks.logger.warn.mockClear()
  mocks.logger.error.mockClear()
})

describe('WebCrawler.fetch logging', () => {
  it('includes Wenku8 session cookies in document requests', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.wenku8.net/index.php',
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
    })
    const crawler = new WebCrawler(createConfig(), {})

    await crawler.fetch('https://www.wenku8.net/index.php')

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://www.wenku8.net/index.php',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('uses an injected Electron session for requests and cookies', async () => {
    const sessionFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://www.wenku8.net/index.php',
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
    }))
    const sessionCookies = {
      get: vi.fn(async () => []),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    }
    const networkSession = {
      fetch: sessionFetch,
      cookies: sessionCookies,
    } as unknown as CrawlerNetworkSession
    const crawler = new WebCrawler(createConfig(), {}, undefined, networkSession)

    await crawler.syncCookies()
    await crawler.fetch('https://www.wenku8.net/index.php')

    expect(sessionFetch).toHaveBeenCalledTimes(1)
    expect(sessionCookies.remove).toHaveBeenCalledTimes(COOKIE_NAMES.length)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.removeCookie).not.toHaveBeenCalled()
  })

  it('uses the default request control when a caller does not provide one', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.wenku8.net/index.php',
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
    })
    const beforeAttempt = vi.fn(async () => undefined)
    const afterAttempt = vi.fn()
    const onResponse = vi.fn()
    const controlFactory = vi.fn(() => ({ beforeAttempt, afterAttempt, onResponse }))
    const crawler = new WebCrawler(
      createConfig(),
      {},
      undefined,
      undefined,
      controlFactory,
    )

    await crawler.fetch('https://www.wenku8.net/index.php')

    expect(controlFactory).toHaveBeenCalledWith(
      'document',
      'https://www.wenku8.net/index.php',
    )
    expect(beforeAttempt).toHaveBeenCalledTimes(1)
    expect(afterAttempt).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }))
  })

  it('prefers an explicit request control over the crawler default', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.wenku8.net/index.php',
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
    })
    const controlFactory = vi.fn(() => ({ beforeAttempt: vi.fn(async () => undefined) }))
    const explicitBeforeAttempt = vi.fn(async () => undefined)
    const crawler = new WebCrawler(
      createConfig(),
      {},
      undefined,
      undefined,
      controlFactory,
    )

    await crawler.fetch('https://www.wenku8.net/index.php', true, undefined, {
      beforeAttempt: explicitBeforeAttempt,
    })

    expect(controlFactory).not.toHaveBeenCalled()
    expect(explicitBeforeAttempt).toHaveBeenCalledTimes(1)
  })

  it('uses the default request control for image requests', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('image-data')),
    })
    const beforeAttempt = vi.fn(async () => undefined)
    const afterAttempt = vi.fn()
    const controlFactory = vi.fn(() => ({ beforeAttempt, afterAttempt }))
    const crawler = new WebCrawler(
      createConfig(),
      {},
      undefined,
      undefined,
      controlFactory,
    )

    await crawler.getImageContent('http://img.wenku8.com/image/3/3057/3057s.jpg')

    expect(controlFactory).toHaveBeenCalledWith(
      'image',
      'https://img.wenku8.com/image/3/3057/3057s.jpg',
    )
    expect(beforeAttempt).toHaveBeenCalledTimes(1)
    expect(afterAttempt).toHaveBeenCalledTimes(1)
  })

  it('does not open interactive verification for ordinary document requests', async () => {
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'cf-mitigated': 'challenge' }),
    })
    const crawler = new WebCrawler(createConfig(), {}, { solve: solveChallenge })

    await expect(crawler.fetch('https://www.wenku8.net/index.php'))
      .rejects.toThrow('请前往配置页手动刷新登录状态')

    expect(solveChallenge).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sleepWithSignal).not.toHaveBeenCalled()
  })

  it('stops without a popup when a challenge follows ordinary network retries', async () => {
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'cf-mitigated': 'challenge' }),
      })
    const crawler = new WebCrawler(createConfig(), {}, { solve: solveChallenge })

    await expect(crawler.fetch('https://www.wenku8.net/index.php'))
      .rejects.toThrow('网站要求完成安全验证')

    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.sleepWithSignal).toHaveBeenCalledTimes(2)
    expect(solveChallenge).not.toHaveBeenCalled()
  })

  it('parses Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-08-29T00:00:00Z')

    expect(parseRetryAfter('7', now)).toBe(7_000)
    expect(parseRetryAfter('Sat, 29 Aug 2026 00:00:09 GMT', now)).toBe(9_000)
    expect(parseRetryAfter('invalid', now)).toBeUndefined()
  })

  it('exposes every attempt to adaptive request control and uses its retry delay', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '7' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.wenku8.net/book/3057.htm',
        headers: new Headers(),
        arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
      })
    const beforeAttempt = vi.fn(async () => undefined)
    const afterAttempt = vi.fn()
    const onResponse = vi.fn()
    const getRetryDelay = vi.fn(() => 1_234)
    const onRetry = vi.fn()
    const crawler = new WebCrawler(createConfig(), {})

    await crawler.fetch('https://www.wenku8.net/book/3057.htm', true, undefined, {
      beforeAttempt,
      afterAttempt,
      onResponse,
      getRetryDelay,
      onRetry,
    })

    expect(beforeAttempt).toHaveBeenCalledTimes(2)
    expect(afterAttempt).toHaveBeenCalledTimes(2)
    expect(onResponse).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 429,
      retryAfterMs: 7_000,
    }))
    expect(onResponse).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 200 }))
    expect(getRetryDelay).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      status: 429,
      retryAfterMs: 7_000,
    }))
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 1_234 }))
    expect(mocks.sleepWithSignal).toHaveBeenCalledWith(1_234, undefined)
  })

  it('does not report a successful document response when reading its body fails', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.wenku8.net/book/3057.htm',
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => { throw new Error('response stream failed') }),
    })
    const onResponse = vi.fn()
    const afterAttempt = vi.fn()
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.fetch(
      'https://www.wenku8.net/book/3057.htm',
      true,
      undefined,
      { beforeAttempt: async () => undefined, afterAttempt, onResponse, getRetryDelay: () => 0 },
    )).rejects.toThrow('response stream failed')

    expect(onResponse).not.toHaveBeenCalled()
    expect(afterAttempt).toHaveBeenCalledTimes(3)
  })

  it('does not retry a fetch cancelled by its caller', async () => {
    const controller = new AbortController()
    mocks.fetch.mockImplementationOnce((_url: string, init: RequestInit) => (
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    ))
    const crawler = new WebCrawler(createConfig(), {})

    const request = crawler.fetch(
      'https://www.wenku8.net/book/3057.htm',
      true,
      controller.signal,
    )
    controller.abort()

    await expect(request).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sleepWithSignal).not.toHaveBeenCalled()
  })

  it('logs retry context without headers or URL credentials', async () => {
    mocks.fetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.wenku8.net/book/3057.htm?searchkey=败犬&token=secret',
        arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
      })
    const crawler = new WebCrawler(createConfig(), {})

    await crawler.fetch(
      'https://reader:password@www.wenku8.net/book/3057.htm?searchkey=败犬&token=secret',
    )

    const context = mocks.logger.warn.mock.calls[0]?.[2]
    const serialized = JSON.stringify(context)
    expect(serialized).toContain('searchkey=[REDACTED]')
    expect(serialized).not.toContain('败犬')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('Cookie')
  })

  it('continues retrying when the network rejects with a non-Error value', async () => {
    mocks.fetch
      .mockRejectedValueOnce(undefined)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.wenku8.net/book/3057.htm',
        arrayBuffer: vi.fn(async () => Buffer.from('<html><title>ok</title></html>')),
      })
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.fetch('https://www.wenku8.net/book/3057.htm')).resolves.toBeDefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.sleepWithSignal).toHaveBeenCalledWith(8000, undefined)
  })

  it('preserves the final request failure as the retry error cause', async () => {
    const cause = new Error('socket closed')
    mocks.fetch.mockRejectedValue(cause)
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.fetch('https://www.wenku8.net/book/3057.htm'))
      .rejects.toMatchObject({ cause })
  })
})

describe('WebCrawler.search', () => {
  it('encodes title keywords as GBK for the Wenku8 search endpoint', async () => {
    const crawler = new WebCrawler(createConfig(), {})
    const fetch = vi.spyOn(crawler, 'fetch').mockResolvedValue(
      load(
        '<html><title>搜索结果</title><body><div id="content"><table class="grid"></table></div></body></html>',
      ) as unknown as Buffer,
    )

    await expect(crawler.search('败犬', 'title')).resolves.toEqual([])

    expect(fetch).toHaveBeenCalledWith(
      'https://www.wenku8.net/modules/article/search.php?searchtype=articlename&searchkey=%b0%dc%c8%ae',
    )
  })

  it('returns structured metadata from multi-result status text', async () => {
    const crawler = new WebCrawler(createConfig(), {})
    vi.spyOn(crawler, 'fetch').mockResolvedValue(
      load(`
        <html>
          <title>“败犬”搜索结果</title>
          <body>
            <div id="content">
              <table class="grid"><tr><td><div>
                <a href="/book/3057.htm" title="败北女角太多了！"><img src="cover.jpg"></a>
                <p>作者:雨森焚火/分类:小学馆</p>
                <p>更新:2026-07-19/字数:1271K/连载中/已动画化</p>
                <p>Tags:校园 青春</p>
                <p>简介:测试简介</p>
              </div></td></tr></table>
            </div>
          </body>
        </html>
      `) as unknown as Buffer,
    )

    await expect(crawler.search('败犬', 'title')).resolves.toEqual([{
      title: '败北女角太多了！',
      cover: 'cover.jpg',
      id: '3057',
      author: '雨森焚火',
      status: '连载中',
      updateTime: '2026-07-19',
      wordCount: '1271K',
      isAnimated: true,
      tags: '校园 青春',
      desc: '测试简介',
    }])
  })

  it('treats a single book page with recommendation grids as a single result', async () => {
    const crawler = new WebCrawler(createConfig(), {})
    const page = load(`
      <html>
        <title>败北女角太多了！(败犬女主太多了！) - 雨森焚火 - 小学馆 - 轻小说文库</title>
        <body>
          <div id="content">
            <img src="cover.jpg">
            <a href="https://www.wenku8.net/modules/article/addbookcase.php?bid=3057">加入书架</a>
            <table>
              <tr><td>败北女角太多了！</td></tr>
              <tr><td>作品信息</td></tr>
              <tr>
                <td>小说分类：小学馆</td>
                <td>作者：雨森焚火</td>
                <td>状态：连载中</td>
              </tr>
            </table>
            <table class="grid"><tr><td><div>
              <a href="/book/3745.htm" title="推荐作品"><img src="recommendation.jpg"></a>
              <p>作者:其他作者</p>
              <p>连载中</p>
            </div></td></tr></table>
          </div>
        </body>
      </html>
    `)
    vi.spyOn(crawler, 'fetch').mockResolvedValue(page as unknown as Buffer)

    await expect(crawler.search('败犬女主', 'title')).resolves.toEqual([{
      title: '败北女角太多了！(败犬女主太多了！)',
      cover: 'cover.jpg',
      id: '3057',
      author: '雨森焚火',
      status: '连载中',
      updateTime: '',
      wordCount: '',
      isAnimated: false,
      tags: '',
      desc: '',
    }])
  })

  it('keeps parser diagnostics internal when the search page is incomplete', async () => {
    const crawler = new WebCrawler(createConfig(), {})
    vi.spyOn(crawler, 'fetch').mockResolvedValue(
      load('<html><body></body></html>') as unknown as Buffer,
    )

    await expect(crawler.search('测试', 'title')).rejects.toMatchObject({
      message: '网站暂时无法完成搜索，请稍后重试',
      cause: expect.objectContaining({ message: '搜索页面缺少标题，可能被拦截' }),
    })
  })
})

describe('WebCrawler.getImageContent response reporting', () => {
  it('includes session cookies only for Wenku8 image requests', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: vi.fn(async () => Buffer.from('image')),
    })
    const crawler = new WebCrawler(createConfig(), {})

    await crawler.getImageContent('https://www.wenku8.net/image.jpg')
    await crawler.getImageContent('https://example.com/image.jpg')

    expect(mocks.fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(mocks.fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('does not open interactive verification for ordinary image requests', async () => {
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'cf-mitigated': 'challenge' }),
    })
    const crawler = new WebCrawler(createConfig(), {}, { solve: solveChallenge })

    await expect(crawler.getImageContent('https://www.wenku8.net/image.jpg'))
      .rejects.toThrow('请前往配置页手动刷新登录状态')

    expect(solveChallenge).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sleepWithSignal).not.toHaveBeenCalled()
  })

  it('stops image loading without a popup when a challenge follows network retries', async () => {
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'cf-mitigated': 'challenge' }),
      })
    const crawler = new WebCrawler(createConfig(), {}, { solve: solveChallenge })

    await expect(crawler.getImageContent('https://www.wenku8.net/image.jpg'))
      .rejects.toThrow('网站要求完成安全验证')

    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.sleepWithSignal).toHaveBeenCalledTimes(2)
    expect(solveChallenge).not.toHaveBeenCalled()
  })

  it('does not retry an image request cancelled by its caller', async () => {
    const controller = new AbortController()
    mocks.fetch.mockImplementationOnce((_url: string, init: RequestInit) => (
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    ))
    const crawler = new WebCrawler(createConfig(), {})

    const request = crawler.getImageContent(
      'https://example.com/image.jpg',
      3,
      undefined,
      controller.signal,
    )
    controller.abort()

    await expect(request).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sleepWithSignal).not.toHaveBeenCalled()
  })

  it('reports each HTTP status when a throttled request later succeeds', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
      })
    const statuses: number[] = []
    const crawler = new WebCrawler(createConfig(), {})

    const content = await crawler.getImageContent(
      'https://example.com/image.jpg',
      2,
      (status) => statuses.push(status),
    )

    expect(content).toEqual(Buffer.from([1, 2, 3]))
    expect(statuses).toEqual([429, 200])
    expect(mocks.sleepWithSignal).toHaveBeenCalledWith(15000, undefined)
  })

  it('does not report HTTP 200 when reading the response body fails', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn(async () => { throw new Error('response stream failed') }),
    })
    const statuses: number[] = []
    const onResponse = vi.fn()
    const afterAttempt = vi.fn()
    const crawler = new WebCrawler(createConfig(), {})

    await expect(
      crawler.getImageContent(
        'https://example.com/image.jpg',
        1,
        (status) => statuses.push(status),
        undefined,
        { beforeAttempt: async () => undefined, afterAttempt, onResponse },
      ),
    ).rejects.toThrow('response stream failed')
    expect(statuses).toEqual([])
    expect(onResponse).not.toHaveBeenCalled()
    expect(afterAttempt).toHaveBeenCalledTimes(1)
  })

  it('continues image retries after a non-Error rejection', async () => {
    mocks.fetch
      .mockRejectedValueOnce(undefined)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
      })
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.getImageContent('https://example.com/image.jpg', 2))
      .resolves.toEqual(Buffer.from([1, 2, 3]))
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves the final image failure as the retry error cause', async () => {
    const cause = new Error('image socket closed')
    mocks.fetch.mockRejectedValue(cause)
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.getImageContent('https://example.com/image.jpg', 2))
      .rejects.toMatchObject({ cause })
  })
})

describe('WebCrawler.syncCookies', () => {
  it('removes all known session cookies before injecting replacements', async () => {
    const crawler = new WebCrawler(createConfig({ PHPSESSID: 'fresh-session' }))

    await crawler.syncCookies()

    expect(mocks.removeCookie.mock.calls).toEqual([
      ['https://www.wenku8.net', 'PHPSESSID'],
      ['https://www.wenku8.net', 'jieqiUserInfo'],
      ['https://www.wenku8.net', 'jieqiVisitInfo'],
      ['https://www.wenku8.net', 'cf_clearance'],
    ])
    expect(mocks.setCookie).toHaveBeenCalledTimes(1)
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({
      name: 'PHPSESSID',
      value: 'fresh-session',
    }))
    const lastRemovalOrder = Math.max(...mocks.removeCookie.mock.invocationCallOrder)
    const firstSetOrder = Math.min(...mocks.setCookie.mock.invocationCallOrder)
    expect(lastRemovalOrder).toBeLessThan(firstSetOrder)
  })

  it('restores persisted Cloudflare clearance into a fresh in-memory session', async () => {
    const crawler = new WebCrawler(createConfig({ cf_clearance: 'persisted-clearance' }))

    await crawler.syncCookies()

    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({
      name: 'cf_clearance',
      value: 'persisted-clearance',
      secure: true,
      sameSite: 'no_restriction',
    }))
  })
})

describe('WebCrawler.getCookie credential consistency', () => {
  it('runs an interactive Cloudflare challenge during preflight, then logs in with the same session', async () => {
    const fixture = createMutableLoginConfig()
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'cf-mitigated': 'challenge' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() })
    mocks.getCookies.mockResolvedValue([
      { name: 'PHPSESSID', value: 'session' },
      { name: 'jieqiUserInfo', value: 'user-info' },
      { name: 'jieqiVisitInfo', value: 'visit-info' },
      { name: 'cf_clearance', value: 'clearance' },
    ])
    const crawler = new WebCrawler(
      fixture.config,
      {},
      { solve: solveChallenge },
    )

    await expect(crawler.getCookie(() => undefined)).resolves.toBeUndefined()

    expect(solveChallenge).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls.every(([, init]) => init.credentials === 'include')).toBe(true)
    expect(mocks.sleep).not.toHaveBeenCalled()
    expect(fixture.replaceCookies).toHaveBeenCalledWith(expect.objectContaining({
      cf_clearance: 'clearance',
    }))
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({
      name: 'cf_clearance',
      value: 'clearance',
      secure: true,
      sameSite: 'no_restriction',
    }))
  })

  it('retries login when a challenge follows the final network retry', async () => {
    const fixture = createMutableLoginConfig()
    const solveChallenge = vi.fn(async () => undefined)
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() })
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'cf-mitigated': 'challenge' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() })
    mocks.getCookies.mockResolvedValue([
      { name: 'PHPSESSID', value: 'session' },
      { name: 'jieqiUserInfo', value: 'user-info' },
      { name: 'jieqiVisitInfo', value: 'visit-info' },
      { name: 'cf_clearance', value: 'clearance' },
    ])
    const crawler = new WebCrawler(fixture.config, {}, { solve: solveChallenge })

    await expect(crawler.getCookie(() => undefined)).resolves.toBeUndefined()

    expect(mocks.fetch).toHaveBeenCalledTimes(5)
    expect(mocks.sleep).toHaveBeenCalledTimes(2)
    expect(solveChallenge).toHaveBeenCalledTimes(1)
    expect(fixture.replaceCookies).toHaveBeenCalledWith(expect.objectContaining({
      jieqiUserInfo: 'user-info',
      jieqiVisitInfo: 'visit-info',
    }))
  })

  it('rejects a 200 response that only leaves an anonymous session cookie', async () => {
    const fixture = createMutableLoginConfig()
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 })
    mocks.getCookies.mockResolvedValue([{ name: 'PHPSESSID', value: 'anonymous-session' }])
    const crawler = new WebCrawler(fixture.config, {})

    await expect(crawler.getCookie()).rejects.toThrow('未检测到有效登录状态')
    expect(fixture.replaceCookies).not.toHaveBeenCalled()
  })

  it('continues login retries after a non-Error rejection', async () => {
    const fixture = createMutableLoginConfig()
    mocks.fetch
      .mockRejectedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, status: 200 })
    mocks.getCookies.mockResolvedValue([
      { name: 'jieqiUserInfo', value: 'user-info' },
      { name: 'jieqiVisitInfo', value: 'visit-info' },
    ])
    const crawler = new WebCrawler(fixture.config, {})

    await expect(crawler.getCookie()).resolves.toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.sleep).toHaveBeenCalledWith(5000)
  })

  it('preserves the final login failure as the retry error cause', async () => {
    const cause = new Error('login socket closed')
    mocks.fetch.mockRejectedValue(cause)
    const crawler = new WebCrawler(createMutableLoginConfig().config, {})

    await expect(crawler.getCookie()).rejects.toMatchObject({ cause })
  })

  it('keeps the final HTTP status in login retry and failure logs', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 })
    const crawler = new WebCrawler(createMutableLoginConfig().config, {})

    await expect(crawler.getCookie()).rejects.toThrow('服务暂时不可用')

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'login.retry',
      '登录请求失败，准备重试',
      expect.objectContaining({ status: 503 }),
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'login.failed',
      '登录 Cookie 刷新失败',
      expect.any(Error),
      expect.objectContaining({ status: 503 }),
    )
  })

  it('rejects an old login result and restores the current Cookie snapshot', async () => {
    const fixture = createMutableLoginConfig()
    const currentCookies = {
      ...emptyCookieSnapshot(),
      PHPSESSID: 'current-session',
    }
    let releaseResponse!: (response: { ok: boolean; status: number }) => void
    mocks.fetch.mockReturnValue(new Promise<{ ok: boolean; status: number }>((resolve) => {
      releaseResponse = resolve
    }))
    mocks.getCookies.mockResolvedValue([{ name: 'PHPSESSID', value: 'old-session' }])
    const crawler = new WebCrawler(fixture.config, {})

    const loginPromise = crawler.getCookie()
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    fixture.changeCredentials(
      { username: 'new-user', password: 'new-password' },
      currentCookies,
    )
    releaseResponse({ ok: true, status: 200 })

    await expect(loginPromise).rejects.toThrow('登录期间账号已变更')
    expect(fixture.replaceCookies).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.removeCookie).toHaveBeenCalledTimes(COOKIE_NAMES.length + 3)
    expect(mocks.removeCookie.mock.calls.slice(0, 3)).toEqual([
      ['https://www.wenku8.net', 'PHPSESSID'],
      ['https://www.wenku8.net', 'jieqiUserInfo'],
      ['https://www.wenku8.net', 'jieqiVisitInfo'],
    ])
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({
      name: 'PHPSESSID',
      value: 'current-session',
    }))
  })

  it('does not retry revoked credentials after they change during backoff', async () => {
    const fixture = createMutableLoginConfig()
    const currentCookies = {
      ...emptyCookieSnapshot(),
      PHPSESSID: 'current-session',
    }
    let releaseBackoff!: () => void
    mocks.fetch.mockRejectedValue(new Error('network unavailable'))
    mocks.sleep.mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseBackoff = resolve
    }))
    const crawler = new WebCrawler(fixture.config, {})

    const loginPromise = crawler.getCookie()
    await vi.waitFor(() => expect(mocks.sleep).toHaveBeenCalledTimes(1))
    fixture.changeCredentials(
      { username: 'new-user', password: 'new-password' },
      currentCookies,
    )
    releaseBackoff()

    await expect(loginPromise).rejects.toThrow('登录期间账号已变更')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(fixture.replaceCookies).not.toHaveBeenCalled()
  })
})
