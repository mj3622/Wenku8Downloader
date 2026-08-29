import type { LogConfig } from '../../shared/config-types'
import type { LogStats } from '../../shared/ipc-types'
import { FileLogger, type FileLoggerOptions, type LoggerLike } from './file-logger'

let active: FileLogger | null = null

export const logger: LoggerLike = {
  debug: (...args) => active?.debug(...args),
  info: (...args) => active?.info(...args),
  warn: (...args) => active?.warn(...args),
  error: (...args) => active?.error(...args),
}

export function initializeLogger(options: FileLoggerOptions): FileLogger {
  active = new FileLogger(options)
  return active
}

export function configureLogger(config: LogConfig): void {
  active?.configure(config)
}

export function getLogDirectory(): string {
  if (!active) {
    throw new Error('日志目录暂时不可用，请重启应用后再试')
  }
  return active.getDirectory()
}

export function getLogStats(): LogStats {
  if (!active) {
    throw new Error('日志信息暂时不可用，请重启应用后再试')
  }
  return { totalSizeBytes: active.getTotalSizeBytes() }
}
