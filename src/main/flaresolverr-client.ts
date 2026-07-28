import { randomUUID } from 'crypto'
import type { Wenku8Config } from './types'

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_TIMEOUT_MS = 120_000

type FlareSolverrCookie = {
  name?: unknown
  value?: unknown
  domain?: unknown
}

type FlareSolverrResponse = {
  status?: unknown
  session?: unknown
  solution?: {
    cookies?: unknown
    userAgent?: unknown
    response?: unknown
    url?: unknown
  }
}

export type FlareSolverrResult = {
  cookies: Record<string, string>
  userAgent: string
}

export type FlareSolverrPageResult = FlareSolverrResult & {
  html: string
  url: string
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('代理凭据格式无效')
  }
}

export function toFlareSolverrProxy(proxy: Wenku8Config['proxy']): Record<string, string> | undefined {
  if (!proxy.enabled || !proxy.url) return undefined

  const parsed = new URL(proxy.url)
  const username = parsed.username ? decodeCredential(parsed.username) : ''
  const password = parsed.password ? decodeCredential(parsed.password) : ''
  const protocol = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol
  const result: Record<string, string> = {
    url: `${protocol}//${parsed.host}`,
  }
  if (username || password) {
    result.username = username
    result.password = password
  }
  return result
}

function validateTargetUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'wenku8.net' && !url.hostname.endsWith('.wenku8.net'))
  ) {
    throw new Error('FlareSolverr 仅允许访问轻小说文库')
  }
  return url.toString()
}

function validateProxyBridgeUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error('代理共享地址无效')
  }
  return `${url.protocol}//${url.host}`
}

export class FlareSolverrClient {
  private endpoint: string | null
  private pageSession: string | null = null
  private pageSessionProxy = ''
  private pageSessionRequests = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(endpoint = process.env.FLARESOLVERR_URL ?? '') {
    this.endpoint = endpoint ? this.validateEndpoint(endpoint) : null
  }

  get available(): boolean {
    return this.endpoint !== null
  }

  solveLogin(
    loginUrl: string,
    postData: string,
    proxy: Wenku8Config['proxy'],
    proxyBridgeUrl?: string,
  ): Promise<FlareSolverrResult> {
    return this.enqueue(async () => {
      if (!this.endpoint) throw new Error('FlareSolverr 服务未配置')
      const targetUrl = validateTargetUrl(loginUrl)
      const solverProxy = this.getSolverProxy(proxy, proxyBridgeUrl)
      await this.destroyPageSession()
      const session = await this.ensurePageSession(solverProxy)
      try {
        await this.call({
          cmd: 'request.get',
          url: new URL('/login.php', targetUrl).toString(),
          session,
          maxTimeout: MAX_TIMEOUT_MS,
          returnOnlyCookies: true,
        })
        const payload = await this.call({
          cmd: 'request.post',
          url: targetUrl,
          postData,
          session,
          maxTimeout: MAX_TIMEOUT_MS,
          returnOnlyCookies: true,
        })
        return this.parseSolution(payload)
      } catch (error) {
        await this.destroyPageSession()
        throw error
      }
    })
  }

  getPage(
    targetUrl: string,
    cookies: Record<string, string>,
    proxy: Wenku8Config['proxy'],
    proxyBridgeUrl?: string,
  ): Promise<FlareSolverrPageResult> {
    return this.enqueue(async () => {
      if (!this.endpoint) throw new Error('FlareSolverr 服务未配置')
      const url = validateTargetUrl(targetUrl)
      const solverProxy = this.getSolverProxy(proxy, proxyBridgeUrl)
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await this.getPageWithSession(
            url,
            cookies,
            await this.ensurePageSession(solverProxy),
          )
          this.pageSessionRequests++
          return result
        } catch (error) {
          lastError = error
          await this.destroyPageSession()
          if (attempt < 2 && process.env.NODE_ENV !== 'test') {
            await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)))
          }
        }
      }
      throw lastError
    })
  }

  dispose(): Promise<void> {
    return this.enqueue(() => this.destroyPageSession())
  }

  private async getPageWithSession(
    url: string,
    cookies: Record<string, string>,
    sessionId: string,
  ): Promise<FlareSolverrPageResult> {
    const payload = await this.call({
      cmd: 'request.get',
      url,
      cookies: Object.entries(cookies)
        .filter(([name, value]) => /^[A-Za-z0-9_.-]{1,128}$/.test(name) && value.length <= 8192)
        .map(([name, value]) => ({
          name,
          value,
          domain: '.wenku8.net',
          path: '/',
        })),
      session: sessionId,
      maxTimeout: MAX_TIMEOUT_MS,
      disableMedia: true,
    })
    const session = this.parseSolution(payload)
    if (
      typeof payload.solution?.response !== 'string' ||
      typeof payload.solution.url !== 'string' ||
      payload.solution.response.length > MAX_RESPONSE_BYTES
    ) {
      throw new Error('FlareSolverr 未返回有效页面')
    }
    return {
      ...session,
      html: payload.solution.response,
      url: validateTargetUrl(payload.solution.url),
    }
  }

  private getSolverProxy(
    proxy: Wenku8Config['proxy'],
    proxyBridgeUrl?: string,
  ): Record<string, string> | undefined {
    return proxyBridgeUrl
      ? { url: validateProxyBridgeUrl(proxyBridgeUrl) }
      : toFlareSolverrProxy(proxy)
  }

  private async ensurePageSession(proxy: Record<string, string> | undefined): Promise<string> {
    const proxyKey = JSON.stringify(proxy ?? {})
    if (
      this.pageSession &&
      this.pageSessionProxy === proxyKey &&
      this.pageSessionRequests < 8
    ) {
      return this.pageSession
    }
    await this.destroyPageSession()
    const session = `wenku8-${randomUUID()}`
    await this.call({ cmd: 'sessions.create', session, proxy })
    this.pageSession = session
    this.pageSessionProxy = proxyKey
    this.pageSessionRequests = 0
    return session
  }

  private async destroyPageSession(): Promise<void> {
    const session = this.pageSession
    this.pageSession = null
    this.pageSessionProxy = ''
    this.pageSessionRequests = 0
    if (session) {
      await this.call({ cmd: 'sessions.destroy', session }).catch(() => undefined)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async call(body: Record<string, unknown>): Promise<FlareSolverrResponse> {
    let response: Response
    try {
      response = await globalThis.fetch(this.endpoint as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MAX_TIMEOUT_MS + 10_000),
      })
    } catch {
      throw new Error('FlareSolverr 服务连接失败')
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error('FlareSolverr 返回数据过大')
    }
    const raw = await response.text()
    if (raw.length > MAX_RESPONSE_BYTES) {
      throw new Error('FlareSolverr 返回数据过大')
    }
    if (!response.ok) {
      throw new Error('FlareSolverr 未能通过 Cloudflare 验证')
    }

    let payload: FlareSolverrResponse
    try {
      payload = JSON.parse(raw) as FlareSolverrResponse
    } catch {
      throw new Error('FlareSolverr 返回数据无效')
    }
    if (payload.status !== 'ok' || !payload.solution) {
      if (payload.status === 'ok' && !('url' in body)) return payload
      throw new Error('FlareSolverr 未能通过 Cloudflare 验证')
    }
    return payload
  }

  private parseSolution(payload: FlareSolverrResponse): FlareSolverrResult {
    const cookies: Record<string, string> = {}
    if (Array.isArray(payload.solution?.cookies)) {
      for (const item of payload.solution.cookies.slice(0, 100) as FlareSolverrCookie[]) {
        if (
          typeof item.name === 'string' &&
          /^[A-Za-z0-9_.-]{1,128}$/.test(item.name) &&
          typeof item.value === 'string' &&
          item.value.length <= 8192 &&
          (item.domain === undefined ||
            (typeof item.domain === 'string' &&
              (item.domain === 'wenku8.net' || item.domain.endsWith('.wenku8.net'))))
        ) {
          cookies[item.name] = item.value
        }
      }
    }

    const userAgent = payload.solution?.userAgent
    if (
      typeof userAgent !== 'string' ||
      !userAgent ||
      userAgent.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(userAgent)
    ) {
      throw new Error('FlareSolverr 未返回有效浏览器标识')
    }
    return { cookies, userAgent }
  }

  private validateEndpoint(value: string): string {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('FlareSolverr 服务地址无效')
    }
    return url.toString()
  }
}

export const flareSolverrClient = new FlareSolverrClient()
