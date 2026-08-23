import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getCookies: vi.fn(async (): Promise<Array<{ name: string; value: string }>> => []),
  setCookie: vi.fn(async () => undefined),
  removeCookie: vi.fn(async () => undefined),
  sleep: vi.fn(async (): Promise<void> => undefined),
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
