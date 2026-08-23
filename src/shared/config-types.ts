export type TitleFormat = 'FULL' | 'IN' | 'OUT'

export interface DownloadConfig {
  fullTitle: TitleFormat
  defaultCoverIndex: number
  downloadPath: string
}

export interface LogConfig {
  retentionDays: number
  maxFileSizeMb: number
  maxTotalSizeMb: number
}

export type ConfigHealth =
  | { state: 'ok' }
  | { state: 'recovery-required'; message: string }
  | { state: 'encryption-unavailable'; message: string }
  | { state: 'read-only-newer-version'; message: string }

export interface PublicConfigSnapshot {
  download: DownloadConfig
  logging: LogConfig
  account: {
    username: string
    hasPassword: boolean
    hasCookies: boolean
  }
  health: ConfigHealth
}

export interface UpdateCredentialsInput {
  username: string
  password?: string
}

export interface ConfigApi {
  getConfig: () => Promise<PublicConfigSnapshot>
  updateDownloadConfig: (input: DownloadConfig) => Promise<PublicConfigSnapshot>
  updateLogConfig: (input: LogConfig) => Promise<PublicConfigSnapshot>
  updateCredentials: (input: UpdateCredentialsInput) => Promise<PublicConfigSnapshot>
  resetCorruptConfig: () => Promise<PublicConfigSnapshot>
}
