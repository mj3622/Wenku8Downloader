import { config } from './config-manager'
import type { WebCrawler } from './crawler'

export type CookieProgress = {
  step: 'login' | 'done'
  message: string
}

export type CookieResult = {
  loginCookies: Record<string, string>
}

export class CookieService {
  private crawler: WebCrawler

  constructor(crawler: WebCrawler) {
    this.crawler = crawler
  }

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
    const loginCfg = config.getAll().login
    const username = loginCfg?.username
    const password = loginCfg?.password

    if (!username || !password) {
      throw new Error('请先配置登录账号和密码')
    }

    await this.crawler.getCookie()

    const cfg = config.getAll()
    return {
      PHPSESSID: cfg.cookie?.PHPSESSID ?? '',
      jieqiUserInfo: cfg.cookie?.jieqiUserInfo ?? '',
      jieqiVisitInfo: cfg.cookie?.jieqiVisitInfo ?? '',
    }
  }
}
