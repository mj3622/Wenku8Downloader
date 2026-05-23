import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { parse, stringify } from 'smol-toml'
import type { Wenku8Config } from './types'

function getConfigDir(): string {
  try {
    return join(app.getPath('userData'), 'config')
  } catch {
    return join(process.cwd(), 'config')
  }
}

const CONFIG_DIR = getConfigDir()
const CONFIG_PATH = join(CONFIG_DIR, 'secrets.toml')

const DEFAULT_CONFIG: Wenku8Config = {
  cookie: {
    PHPSESSID: '',
    jieqiUserInfo: '',
    jieqiVisitInfo: '',
    cf_clearance: '',
  },
  login: {
    username: '',
    password: '',
  },
  download: {
    full_title: 'FULL',
    default_cover_index: 0,
  },
}

class ConfigManager {
  private config: Wenku8Config

  constructor() {
    // 确保配置目录存在
    mkdirSync(CONFIG_DIR, { recursive: true })

    if (!existsSync(CONFIG_PATH)) {
      // 尝试从默认位置复制（开发: cwd/config, 生产: resourcesPath/config）
      const defaultDirs = [join(process.cwd(), 'config')]
      try {
        if (app.isPackaged) {
          defaultDirs.unshift(join(process.resourcesPath, 'config'))
        }
      } catch {
        // app 未就绪时忽略
      }

      const examplePath = CONFIG_PATH + '.example'
      let seeded = false

      // 优先从示例文件复制
      for (const dir of defaultDirs) {
        const src = join(dir, 'secrets.toml.example')
        if (existsSync(src)) {
          copyFileSync(src, examplePath)
          seeded = true
          break
        }
      }

      if (existsSync(examplePath)) {
        copyFileSync(examplePath, CONFIG_PATH)
      } else if (!seeded) {
        // 无示例文件时创建默认配置
        writeFileSync(
          CONFIG_PATH,
          stringify(DEFAULT_CONFIG as unknown as Record<string, unknown>),
          'utf-8',
        )
      }
    }

    this.config = this.readToml()
    if (!this.config || Object.keys(this.config).length === 0) {
      this.config = { ...DEFAULT_CONFIG }
      this.writeToml()
    }
  }

  private readToml(): Wenku8Config {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      return parse(raw) as unknown as Wenku8Config
    } catch {
      return {} as Wenku8Config
    }
  }

  private writeToml(): void {
    writeFileSync(CONFIG_PATH, stringify(this.config as unknown as Record<string, unknown>), 'utf-8')
  }

  get(section: string, key?: string): unknown {
    const sec = (this.config as Record<string, Record<string, unknown>>)[section]
    if (!sec) return null
    if (key !== undefined) return sec[key] ?? null
    return sec
  }

  set(section: string, key: string, value: unknown): void {
    const cfg = this.config as Record<string, Record<string, unknown>>
    if (!cfg[section]) cfg[section] = {}
    cfg[section][key] = value
    this.writeToml()
  }

  delete(section: string, key: string): void {
    const cfg = this.config as Record<string, Record<string, unknown>>
    if (cfg[section] && key in cfg[section]) {
      delete cfg[section][key]
      this.writeToml()
    }
  }

  getAll(): Wenku8Config {
    return this.config
  }
}

export const config = new ConfigManager()
