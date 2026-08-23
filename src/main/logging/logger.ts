import type { LogConfig } from '../../shared/config-types'
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
    throw new Error('日志器尚未初始化')
  }
  return active.getDirectory()
}
