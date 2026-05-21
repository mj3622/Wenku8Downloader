import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { join } from 'path'
import { parse, stringify } from 'smol-toml'
import type { Wenku8Config } from './types'

const CONFIG_DIR = join(process.cwd(), 'config')
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
  proxy: {
    http: '',
    https: '',
  },
  download: {
    full_title: 'FULL',
    default_cover_index: 0,
  },
}

class ConfigManager {
  private config: Wenku8Config

  constructor() {
    if (!existsSync(CONFIG_PATH)) {
      const examplePath = CONFIG_PATH + '.example'
      if (existsSync(examplePath)) {
        copyFileSync(examplePath, CONFIG_PATH)
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
