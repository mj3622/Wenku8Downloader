import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync } from 'fs'
import { join } from 'path'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { parse, stringify } from 'smol-toml'
import type { Wenku8Config } from './types'

function getConfigDir(): string {
  const webDataDir = process.env.WEB_DATA_DIR
  if (webDataDir) {
    return join(webDataDir, 'config')
  }

  try {
    const { app } = require('electron') as typeof import('electron')
    if (!app.isPackaged) {
      return join(process.cwd(), '.dev-user-data', 'config')
    }
    return join(app.getPath('userData'), 'config')
  } catch {
    return join(process.cwd(), '.dev-user-data', 'config')
  }
}

const CONFIG_DIR = getConfigDir()
const IS_WEB_RUNTIME = Boolean(process.env.WEB_DATA_DIR)
const CONFIG_PATH = join(CONFIG_DIR, IS_WEB_RUNTIME ? 'secrets.enc' : 'secrets.toml')

const DEFAULT_CONFIG: Wenku8Config = {
  cookie: {
    PHPSESSID: '',
    jieqiUserInfo: '',
    jieqiVisitInfo: '',
    cf_clearance: '',
    userAgent: '',
  },
  login: {
    username: '',
    password: '',
  },
  download: {
    full_title: 'FULL',
    default_cover_index: 0,
    download_path: '',
  },
  proxy: {
    enabled: false,
    url: '',
  },
}

const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

export function normalizeProxyUrl(value: string): string {
  const input = value.trim()
  if (!input) return ''
  if (input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('代理地址无效')
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('代理地址无效')
  }
  if (
    !PROXY_PROTOCOLS.has(url.protocol) ||
    !url.hostname ||
    (url.pathname && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error('仅支持 HTTP、HTTPS、SOCKS5 代理地址')
  }
  return url.toString()
}

export function redactProxyUrl(value: string): { url: string; hasCredentials: boolean } {
  if (!value) return { url: '', hasCredentials: false }
  const url = new URL(value)
  const hasCredentials = Boolean(url.username || url.password)
  url.username = ''
  url.password = ''
  return { url: url.toString(), hasCredentials }
}

class ConfigManager {
  private config: Wenku8Config

  constructor() {
    mkdirSync(CONFIG_DIR, { recursive: true })

    if (!existsSync(CONFIG_PATH)) {
      this.config = structuredClone(DEFAULT_CONFIG)
      this.writeConfig()
    } else {
      this.config = this.readConfig()
      if (!this.config || Object.keys(this.config).length === 0) {
        this.config = structuredClone(DEFAULT_CONFIG)
        this.writeConfig()
      }
    }
    this.config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...this.config,
      cookie: { ...DEFAULT_CONFIG.cookie, ...this.config.cookie },
      login: { ...DEFAULT_CONFIG.login, ...this.config.login },
      download: { ...DEFAULT_CONFIG.download, ...this.config.download },
      proxy: { ...DEFAULT_CONFIG.proxy, ...this.config.proxy },
    }
  }

  private getEncryptionKey(): Buffer {
    const secret = process.env.APP_SECRET
    if (!secret || secret.length < 32) {
      throw new Error('网页端需要设置至少 32 个字符的 APP_SECRET')
    }
    return createHash('sha256').update(secret).digest()
  }

  private readConfig(): Wenku8Config {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      if (IS_WEB_RUNTIME) {
        const payload = JSON.parse(raw) as { iv: string; tag: string; data: string }
        const decipher = createDecipheriv(
          'aes-256-gcm',
          this.getEncryptionKey(),
          Buffer.from(payload.iv, 'base64'),
        )
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(payload.data, 'base64')),
          decipher.final(),
        ]).toString('utf-8')
        return parse(decrypted) as unknown as Wenku8Config
      }
      return parse(raw) as unknown as Wenku8Config
    } catch (error) {
      if (IS_WEB_RUNTIME) throw error
      return {} as Wenku8Config
    }
  }

  private writeConfig(): void {
    const toml = stringify(this.config as unknown as Record<string, unknown>)
    const tempPath = `${CONFIG_PATH}.tmp`
    let content = toml

    if (IS_WEB_RUNTIME) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv)
      const encrypted = Buffer.concat([cipher.update(toml, 'utf-8'), cipher.final()])
      content = JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64'),
      })
    }

    writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 })
    renameSync(tempPath, CONFIG_PATH)
    if (IS_WEB_RUNTIME) chmodSync(CONFIG_PATH, 0o600)
  }

  get(section: string, key?: string): unknown {
    const sec = (this.config as unknown as Record<string, Record<string, unknown>>)[section]
    if (!sec) return null
    if (key !== undefined) return sec[key] ?? null
    return sec
  }

  set(section: string, key: string, value: unknown): void {
    const cfg = this.config as unknown as Record<string, Record<string, unknown>>
    if (!cfg[section]) cfg[section] = {}
    if (section === 'proxy' && key === 'url') {
      const proxyUrl = normalizeProxyUrl(String(value ?? ''))
      cfg.proxy.url = proxyUrl
      if (!proxyUrl) cfg.proxy.enabled = false
    } else if (section === 'proxy' && key === 'enabled') {
      const enabled = value === true || value === 'true'
      if (enabled && !cfg.proxy.url) {
        throw new Error('请先填写代理地址')
      }
      cfg.proxy.enabled = enabled
    } else if (section === 'download' && key === 'default_cover_index') {
      const index = Number(value)
      if (!Number.isInteger(index) || index < 0) {
        throw new Error('封面图片索引必须为非负整数')
      }
      cfg[section][key] = index
    } else {
      cfg[section][key] = value
    }
    this.writeConfig()
  }

  delete(section: string, key: string): void {
    const cfg = this.config as unknown as Record<string, Record<string, unknown>>
    if (cfg[section] && key in cfg[section]) {
      delete cfg[section][key]
      this.writeConfig()
    }
  }

  getAll(): Wenku8Config {
    return this.config
  }
}

export const config = new ConfigManager()
