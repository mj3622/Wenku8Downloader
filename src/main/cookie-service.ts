import type { CrawlerConfig, WebCrawler } from './crawler'

export type CookieProgress = {
  step: 'login' | 'done'
  message: string
}

export type CookieResult = {
  loginCookies: Record<string, string>
}

export class CookieService {
  constructor(
    private readonly crawler: Pick<WebCrawler, 'getCookie'>,
    private readonly config: Pick<CrawlerConfig, 'getCredentials' | 'getCookies'>,
  ) {}

  /**
   * 通过 net.fetch POST 登录轻小说文库
   * 已验证该接口不会被 Cloudflare 拦截
   */
  async acquire(onProgress?: (p: CookieProgress) => void): Promise<CookieResult> {
    onProgress?.({ step: 'login', message: '正在登录...' })
    const loginCookies = await this.login()
    onProgress?.({ step: 'login', message: '登录成功' })
    onProgress?.({ step: 'done', message: '登录成功，已获取 Cookie' })
    return { loginCookies }
  }

  private async login(): Promise<Record<string, string>> {
    const { username, password } = this.config.getCredentials()

    if (!username || !password) {
      throw new Error('请先配置登录账号和密码')
    }

    await this.crawler.getCookie()

    const cookies = this.config.getCookies()
    return {
      PHPSESSID: cookies.PHPSESSID,
      jieqiUserInfo: cookies.jieqiUserInfo,
      jieqiVisitInfo: cookies.jieqiVisitInfo,
    }
  }
}
