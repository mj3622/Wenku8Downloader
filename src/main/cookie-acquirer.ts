import { app } from 'electron'

const BASE_URL = 'https://www.wenku8.net'

// 尝试查找系统 Chrome 路径
function findChromePath(): string | null {
  // macOS
  const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const { existsSync } = require('fs')
  if (existsSync(macPath)) return macPath

  // Windows
  const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const winPathX86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  if (existsSync(winPath)) return winPath
  if (existsSync(winPathX86)) return winPathX86

  // Linux
  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  for (const p of linuxPaths) {
    if (existsSync(p)) return p
  }

  return null
}

/**
 * 使用 puppeteer-extra + stealth 插件，通过系统 Chrome 在 headless 模式下
 * 访问 wenku8，静默完成 Cloudflare Turnstile 挑战，获取 cf_clearance。
 *
 * @param timeout 超时时间（毫秒），默认 60000
 * @returns cf_clearance cookie 值，失败返回 null
 */
export async function acquireCfClearance(timeout: number = 15000): Promise<string | null> {
  const chromePath = findChromePath()
  if (!chromePath) {
    throw new Error('未找到系统 Chrome 浏览器')
  }

  let browser: any = null
  try {
    const puppeteer = require('puppeteer-extra')
    const StealthPlugin = require('puppeteer-extra-plugin-stealth')
    puppeteer.use(StealthPlugin())

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--user-data-dir=${app.getPath('userData')}/puppeteer-profile`,
      ],
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    )

    // 访问任意 Cloudflare 保护的页面触发挑战
    await page.goto(BASE_URL, {
      waitUntil: 'networkidle0',
      timeout,
    })

    // 提取 cf_clearance
    const cookies = await page.cookies()
    const cf = cookies.find((c: any) => c.name === 'cf_clearance')
    return cf?.value ?? null
  } catch (err) {
    throw new Error(`获取 cf_clearance 失败: ${(err as Error).message}`)
  } finally {
    if (browser) await browser.close()
  }
}
