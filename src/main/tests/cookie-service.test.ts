// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { CookieService } from '../cookie-service'

function createConfig(overrides: Partial<{
  username: string
  password: string
  cookies: { PHPSESSID: string; jieqiUserInfo: string; jieqiVisitInfo: string; cf_clearance: string }
}> = {}) {
  const {
    username = 'tester',
    password = 'hidden',
    cookies = {
      PHPSESSID: '',
      jieqiUserInfo: '',
      jieqiVisitInfo: '',
      cf_clearance: '',
    },
  } = overrides
  return {
    getCredentials: vi.fn(() => ({ username, password })),
    getCookies: vi.fn(() => cookies),
  } as const
}

describe('CookieService', () => {
  it('rejects when login succeeds but no authenticated cookies are saved', async () => {
    const crawler = {
      getCookie: vi.fn(async () => undefined),
    }
    const config = createConfig({
      cookies: {
        PHPSESSID: 'anonymous-session',
        jieqiUserInfo: '',
        jieqiVisitInfo: '',
        cf_clearance: '',
      },
    })
    const service = new CookieService(crawler, config)

    await expect(service.acquire()).rejects.toThrow('登录后未检测到有效登录状态')
    expect(crawler.getCookie).toHaveBeenCalledTimes(1)
  })

  it('returns authenticated cookies with progress on success', async () => {
    const crawler = {
      getCookie: vi.fn(async () => undefined),
    }
    const config = createConfig({
      cookies: {
        PHPSESSID: 'sess',
        jieqiUserInfo: 'user-info',
        jieqiVisitInfo: 'visit-info',
        cf_clearance: '',
      },
    })
    const progress: string[] = []
    const service = new CookieService(crawler, config)

    const result = await service.acquire((event) => {
      progress.push(event.message)
    })

    expect(result).toEqual({
      loginCookies: {
        PHPSESSID: 'sess',
        jieqiUserInfo: 'user-info',
        jieqiVisitInfo: 'visit-info',
      },
    })
    expect(progress).toEqual(['正在登录...', '登录成功', '登录成功，登录状态已更新'])
  })
})
