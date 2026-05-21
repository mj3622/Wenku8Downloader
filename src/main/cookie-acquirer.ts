import { BrowserWindow, session } from 'electron'

const LOGIN_URL = 'https://www.wenku8.net/login.php'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function acquireCookiesViaBrowser(
  username: string,
  password: string,
): Promise<Record<string, string>> {
  let win: BrowserWindow | null = null

  try {
    win = new BrowserWindow({
      width: 800,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    // 禁用自动化检测标志
    await win.webContents.executeJavaScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    `)

    await win.loadURL(LOGIN_URL)

    // 等待 Cloudflare 挑战通过或登录表单出现
    const formAppeared = await waitForSelector(win, '[name="username"]', 30000)
    if (!formAppeared) {
      throw new Error('等待登录表单超时，Cloudflare 验证可能未通过')
    }

    // 额外等待确保 Cloudflare 完成
    await sleep(2000)

    // 填写登录表单
    await win.webContents.executeJavaScript(`
      (function() {
        var u = document.querySelector('[name="username"]');
        var p = document.querySelector('[name="password"]');
        var c = document.querySelector('[name="usecookie"]');
        if (u) u.value = ${JSON.stringify(username)};
        if (p) p.value = ${JSON.stringify(password)};
        if (c) c.value = '315360000';
        var btn = document.querySelector('[name="submit"]') || document.querySelector('input[type="submit"]');
        if (btn) btn.click();
      })()
    `)

    // 等待导航离开登录页
    const loggedIn = await waitForUrlChange(win, 'login.php', 20000)
    if (!loggedIn) {
      // 检查是否仍在登录页（密码错误）
      const stillLogin = win.webContents.getURL().includes('login.php')
      if (stillLogin) {
        throw new Error('登录失败，请检查账号密码是否正确')
      }
    }

    // 提取 Cookie
    const cookies = await session.defaultSession.cookies.get({ url: 'https://www.wenku8.net' })
    const cookieMap: Record<string, string> = {}
    for (const c of cookies) {
      cookieMap[c.name] = c.value
    }

    return cookieMap
  } finally {
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }
}

async function waitForSelector(
  win: BrowserWindow,
  selector: string,
  timeout: number,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const found = await win.webContents.executeJavaScript(`
        document.querySelector(${JSON.stringify(selector)}) !== null
      `)
      if (found) return true
    } catch {
      // 页面可能还在加载
    }
    await sleep(500)
  }
  return false
}

async function waitForUrlChange(
  win: BrowserWindow,
  excludePattern: string,
  timeout: number,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const url = win.webContents.getURL()
      if (!url.includes(excludePattern)) return true
    } catch {
      // ignore
    }
    await sleep(500)
  }
  return false
}
