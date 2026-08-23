import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getCookies: vi.fn(async (): Promise<Array<{ name: string; value: string }>> => []),
  setCookie: vi.fn(async () => undefined),
  removeCookie: vi.fn(async () => undefined),
  sleep: vi.fn(async (): Promise<void> => undefined),
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
vi.mock('./logging/logger', () => ({ logger: mocks.logger }))

import { WebCrawler, type CrawlerConfig } from './crawler'
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
  mocks.logger.debug.mockClear()
  mocks.logger.info.mockClear()
  mocks.logger.warn.mockClear()
  mocks.logger.error.mockClear()
})

describe('WebCrawler.fetch logging', () => {
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
    expect(serialized).toContain('searchkey=败犬')
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
    expect(mocks.sleep).toHaveBeenCalledWith(8000)
  })

  it('preserves the final request failure as the retry error cause', async () => {
    const cause = new Error('socket closed')
    mocks.fetch.mockRejectedValue(cause)
    const crawler = new WebCrawler(createConfig(), {})

    await expect(crawler.fetch('https://www.wenku8.net/book/3057.htm'))
      .rejects.toMatchObject({ cause })
  })
})

describe('WebCrawler.getImageContent response reporting', () => {
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
    expect(mocks.sleep).toHaveBeenCalledWith(15000)
  })

  it('does not report HTTP 200 when reading the response body fails', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn(async () => { throw new Error('response stream failed') }),
    })
    const statuses: number[] = []
    const crawler = new WebCrawler(createConfig(), {})

    await expect(
      crawler.getImageContent(
        'https://example.com/image.jpg',
        1,
        (status) => statuses.push(status),
      ),
    ).rejects.toThrow('response stream failed')
    expect(statuses).toEqual([])
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
})

describe('WebCrawler.getCookie credential consistency', () => {
  it('continues login retries after a non-Error rejection', async () => {
    const fixture = createMutableLoginConfig()
    mocks.fetch
      .mockRejectedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, status: 200 })
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
    expect(mocks.removeCookie).toHaveBeenCalledTimes(COOKIE_NAMES.length)
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
