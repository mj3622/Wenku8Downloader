import { BrowserWindow, session, type Cookie, type Session } from 'electron'
import { WENKU_BASE_URL } from './wenku-network'

const BASE_URL = WENKU_BASE_URL
const CHALLENGE_URL = `${BASE_URL}/index.php`
const DEFAULT_TIMEOUT_MS = 90 * 1000
const COOKIE_SETTLE_DELAY_MS = 100
const CHALLENGE_FALLBACK_RELOAD_MS = 15_000

type CookieChangedListener = (
  event: unknown,
  cookie: Pick<Cookie, 'name' | 'value' | 'domain' | 'path' | 'secure'>,
  cause: string,
  removed: boolean,
) => void

interface CookieStore {
  get(filter: { name: string }): Promise<Array<Pick<Cookie, 'name' | 'value' | 'domain' | 'path'>>>
  on(event: 'changed', listener: CookieChangedListener): unknown
  removeListener(event: 'changed', listener: CookieChangedListener): unknown
}

interface NavigationEvent {
  url: string
  preventDefault(): void
}

interface ChallengeWindow {
  webContents: {
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    executeJavaScript(code: string): Promise<unknown>
    on(event: 'will-navigate', listener: (event: NavigationEvent) => void): unknown
    on(event: 'did-finish-load', listener: () => void): unknown
    removeListener(event: 'did-finish-load', listener: () => void): unknown
  }
  loadURL(url: string): Promise<void>
  close(): void
  isDestroyed(): boolean
  on(event: 'closed', listener: () => void): unknown
  removeListener(event: 'closed', listener: () => void): unknown
}

interface ChallengeOptions {
  networkSession?: Session
  cookies: CookieStore
  createWindow: (networkSession?: Session) => ChallengeWindow
  timeoutMs: number
}

export interface CloudflareChallengeSolver {
  solve(): Promise<void>
}

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:'
      && (url.hostname === 'wenku8.net' || url.hostname === 'www.wenku8.net')
  } catch {
    return false
  }
}

function createVerificationWindow(networkSession?: Session): BrowserWindow {
  const parent = BrowserWindow.getFocusedWindow()
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: '完成 Wenku8 安全验证',
    ...(parent ? { parent } : {}),
    webPreferences: {
      ...(networkSession ? { session: networkSession } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault()
  })
  return window
}

export class ElectronCloudflareChallengeSolver implements CloudflareChallengeSolver {
  private readonly options: ChallengeOptions
  private inFlight?: Promise<void>

  constructor(options?: Partial<ChallengeOptions>) {
    const networkSession = options?.networkSession
    this.options = {
      networkSession,
      cookies: options?.cookies ?? (networkSession ?? session.defaultSession).cookies,
      createWindow: options?.createWindow ?? createVerificationWindow,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }
  }

  solve(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const solving = this.solveOnce().finally(() => {
      if (this.inFlight === solving) this.inFlight = undefined
    })
    this.inFlight = solving
    return solving
  }

  private async solveOnce(): Promise<void> {
    const verificationWindow = this.options.createWindow(this.options.networkSession)

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let validating = false
      let validationRequested = false
      let cookieCheckTimer: ReturnType<typeof setTimeout> | undefined
      let fallbackReloadTimer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        clearTimeout(timeout)
        if (cookieCheckTimer) clearTimeout(cookieCheckTimer)
        if (fallbackReloadTimer) clearTimeout(fallbackReloadTimer)
        this.options.cookies.removeListener('changed', handleCookieChanged)
        verificationWindow.webContents.removeListener('did-finish-load', handleDidFinishLoad)
        verificationWindow.removeListener('closed', handleClosed)
      }
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (!verificationWindow.isDestroyed()) verificationWindow.close()
        if (error) reject(error)
        else resolve()
      }
      const hasUsableClearance = async (): Promise<boolean> => {
        const cookies = await this.options.cookies.get({ name: 'cf_clearance' })
        return cookies.some((candidate) => {
          const candidateDomain = candidate.domain?.replace(/^\./, '')
          const candidatePath = candidate.path || '/'
          return candidate.name === 'cf_clearance'
            && Boolean(candidate.value)
            && new URL(CHALLENGE_URL).pathname.startsWith(candidatePath)
            && (candidateDomain === 'wenku8.net' || candidateDomain === 'www.wenku8.net')
        })
      }
      const validateHomepage = async (): Promise<void> => {
        if (validating) {
          validationRequested = true
          return
        }
        validating = true
        validationRequested = false
        try {
          if (!await hasUsableClearance()) return
          const isHomepage = await verificationWindow.webContents.executeJavaScript(
            "Boolean(document.querySelector('.block .blocktitle'))",
          )
          if (isHomepage === true) {
            finish()
            return
          }
          if (!fallbackReloadTimer) {
            fallbackReloadTimer = setTimeout(() => {
              fallbackReloadTimer = undefined
              void verificationWindow.loadURL(CHALLENGE_URL).catch(() => undefined)
            }, CHALLENGE_FALLBACK_RELOAD_MS)
          }
        } catch {
          // Keep the verification window open so Cloudflare can retry the challenge.
        } finally {
          validating = false
          if (validationRequested && !settled) void validateHomepage()
        }
      }
      const handleDidFinishLoad = () => {
        void validateHomepage()
      }
      const handleCookieChanged: CookieChangedListener = (_event, cookie, _cause, removed) => {
        if (cookie.name !== 'cf_clearance') return
        if (removed || !cookie.value) return
        const domain = cookie.domain?.replace(/^\./, '')
        if (domain !== 'wenku8.net' && domain !== 'www.wenku8.net') return
        if (cookieCheckTimer) clearTimeout(cookieCheckTimer)
        cookieCheckTimer = setTimeout(() => {
          cookieCheckTimer = undefined
          void validateHomepage()
        }, COOKIE_SETTLE_DELAY_MS)
      }
      const handleClosed = () => finish(new Error('安全验证未完成，请重新刷新登录状态'))
      const timeout = setTimeout(() => {
        finish(new Error('网站安全验证暂时无法完成，请更换网络线路或稍后重试'))
      }, this.options.timeoutMs)

      this.options.cookies.on('changed', handleCookieChanged)
      verificationWindow.webContents.on('did-finish-load', handleDidFinishLoad)
      verificationWindow.on('closed', handleClosed)
      void verificationWindow.loadURL(CHALLENGE_URL).catch(() => {
        finish(new Error('无法打开安全验证页面，请检查网络后重试'))
      })
    })
  }
}
