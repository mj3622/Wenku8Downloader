import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs'
import { join } from 'path'
import type { LogConfig } from '../../shared/config-types'
import { sanitizeLogLine, serializeLogError, stringifyLogContext } from './redaction'

export type LogContext = Record<string, unknown>
export type LogSource = 'main' | 'renderer'
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
type LogStream = 'app' | 'error'

export interface LoggerLike {
  debug(event: string, message: string, context?: LogContext, source?: LogSource): void
  info(event: string, message: string, context?: LogContext, source?: LogSource): void
  warn(event: string, message: string, context?: LogContext, source?: LogSource): void
  error(
    event: string,
    message: string,
    error: unknown,
    context?: LogContext,
    source?: LogSource,
  ): void
}

export interface FileLoggerOptions {
  directory: string
  config: LogConfig
  source: LogSource
  development: boolean
  now?: () => Date
  sessionId?: string
  fallback?: (message: string, error?: unknown) => void
}

interface ManagedLogFile {
  name: string
  path: string
  date: string
  segment: number
  size: number
  modifiedAt: number
}

interface ActiveLogTarget {
  path: string
  date: string
  segment: number
  size: number
}

const MANAGED_LOG_PATTERN = /^(app|error)-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.log$/
const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function calendarDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

function localTimestamp(value: Date): string {
  return `${localDate(value)} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`
}

function singleLine(value: string): string {
  return sanitizeLogLine(value)
}

function defaultFallback(message: string, error?: unknown): void {
  try {
    const suffix = error === undefined ? '' : `: ${sanitizeLogLine(error)}`
    process.stderr.write(`[logging-fallback] ${sanitizeLogLine(message)}${suffix}\n`)
  } catch {
    // Logging failures must not affect application behavior.
  }
}

export class FileLogger implements LoggerLike {
  private config: LogConfig
  private readonly now: () => Date
  private readonly sessionId: string
  private readonly fallback: (message: string, error?: unknown) => void
  private readonly activeTargets = new Map<LogStream, ActiveLogTarget>()
  private lastWriteDate: string | null = null
  private writing = false
  private cleaning = false

  constructor(
    private readonly options: FileLoggerOptions,
  ) {
    this.config = { ...options.config }
    this.now = options.now ?? (() => new Date())
    this.sessionId = options.sessionId ?? `${process.pid}-${Date.now().toString(36)}`
    this.fallback = options.fallback ?? defaultFallback
    this.ensureDirectory()
    this.cleanup()
  }

  debug(event: string, message: string, context?: LogContext, source?: LogSource): void {
    if (this.options.development) {
      this.write('DEBUG', event, message, context, source ?? this.options.source)
    }
  }

  info(event: string, message: string, context?: LogContext, source?: LogSource): void {
    this.write('INFO', event, message, context, source ?? this.options.source)
  }

  warn(event: string, message: string, context?: LogContext, source?: LogSource): void {
    this.write('WARN', event, message, context, source ?? this.options.source)
  }

  error(
    event: string,
    message: string,
    error: unknown,
    context?: LogContext,
    source?: LogSource,
  ): void {
    try {
      this.write('ERROR', event, message, {
        ...context,
        error: serializeLogError(error),
      }, source ?? this.options.source)
    } catch (loggingError) {
      this.reportFailure('格式化错误日志失败', loggingError)
    }
  }

  configure(config: LogConfig): void {
    this.config = { ...config }
    this.cleanup()
  }

  cleanup(): void {
    if (this.cleaning) return
    this.cleaning = true
    try {
      this.ensureDirectory()
      const today = this.now()
      const todayKey = localDate(today)
      const todayDay = calendarDay(todayKey)
      for (const [stream, target] of this.activeTargets) {
        if (target.date !== todayKey) this.activeTargets.delete(stream)
      }
      const protectedPaths = new Set(
        Array.from(this.activeTargets.values(), (target) => target.path),
      )
      const initialFiles = this.listManagedFiles()
      for (const stream of ['app', 'error'] as const) {
        const latest = initialFiles
          .filter((file) => file.name.startsWith(`${stream}-${todayKey}`))
          .sort((left, right) => left.segment - right.segment)
          .at(-1)
        if (latest) protectedPaths.add(latest.path)
      }

      for (const file of initialFiles) {
        if (protectedPaths.has(file.path)) continue
        const ageDays = todayDay - calendarDay(file.date)
        if (ageDays >= this.config.retentionDays) {
          this.removeManagedFile(file)
        }
      }

      const survivors = this.listManagedFiles()
      let totalBytes = survivors.reduce((total, file) => total + file.size, 0)
      const maxTotalBytes = this.config.maxTotalSizeMb * 1024 * 1024
      const removable = survivors
        .filter((file) => !protectedPaths.has(file.path))
        .sort((left, right) =>
          left.date.localeCompare(right.date)
          || left.modifiedAt - right.modifiedAt
          || left.segment - right.segment,
        )

      for (const file of removable) {
        if (totalBytes <= maxTotalBytes) break
        if (this.removeManagedFile(file)) {
          totalBytes -= file.size
        }
      }
      if (totalBytes > maxTotalBytes) {
        this.reportFailure('受保护的活动日志已超过目录总上限')
      }
    } catch (error) {
      this.reportFailure('清理日志文件失败', error)
    } finally {
      this.cleaning = false
    }
  }

  getDirectory(): string {
    return this.options.directory
  }

  getTotalSizeBytes(): number {
    return this.listManagedFiles().reduce((total, file) => total + file.size, 0)
  }

  private write(
    level: LogLevel,
    event: string,
    message: string,
    context: LogContext | undefined,
    source: LogSource,
  ): void {
    if (this.writing) return
    this.writing = true
    try {
      const timestamp = this.now()
      const date = localDate(timestamp)
      const line = this.formatLine(timestamp, level, event, message, context, source)
      const streams: LogStream[] = level === 'ERROR' ? ['app', 'error'] : ['app']
      let shouldCleanup = this.lastWriteDate !== null && this.lastWriteDate !== date

      for (const stream of streams) {
        try {
          const selected = this.selectTarget(stream, date, Buffer.byteLength(line, 'utf8'))
          mkdirSync(this.options.directory, { recursive: true })
          appendFileSync(selected.target.path, line, 'utf8')
          selected.target.size += Buffer.byteLength(line, 'utf8')
          this.activeTargets.set(stream, selected.target)
          shouldCleanup ||= selected.rolledOver
        } catch (error) {
          this.reportFailure(`写入 ${stream} 日志失败`, error)
        }
      }
      this.lastWriteDate = date
      if (shouldCleanup) {
        this.cleanup()
      }
    } catch (error) {
      this.reportFailure('格式化日志失败', error)
    } finally {
      this.writing = false
    }
  }

  private formatLine(
    timestamp: Date,
    level: LogLevel,
    event: string,
    message: string,
    context?: LogContext,
    source: LogSource = this.options.source,
  ): string {
    const prefix = `${localTimestamp(timestamp)} [${level}] [${source}] [${this.sessionId}] [${singleLine(event)}] ${singleLine(message)}`
    return context === undefined ? `${prefix}\n` : `${prefix} ${stringifyLogContext(context)}\n`
  }

  private selectTarget(
    stream: LogStream,
    date: string,
    entryBytes: number,
  ): { target: ActiveLogTarget; rolledOver: boolean } {
    let target = this.activeTargets.get(stream)
    if (!target || target.date !== date) {
      const latest = this.listManagedFiles()
        .filter((file) => file.name.startsWith(`${stream}-${date}`))
        .sort((left, right) => left.segment - right.segment)
        .at(-1)
      target = latest
        ? {
            path: latest.path,
            date,
            segment: latest.segment,
            size: latest.size,
          }
        : {
            path: join(this.options.directory, `${stream}-${date}.log`),
            date,
            segment: 0,
            size: 0,
          }
    }

    let rolledOver = false
    if (target.size > 0 && target.size + entryBytes > this.config.maxFileSizeMb * 1024 * 1024) {
      const segment = target.segment + 1
      const suffix = `-${pad(segment, 3)}`
      target = {
        path: join(this.options.directory, `${stream}-${date}${suffix}.log`),
        date,
        segment,
        size: 0,
      }
      rolledOver = true
    }
    return { target, rolledOver }
  }

  private listManagedFiles(): ManagedLogFile[] {
    let entries
    try {
      entries = readdirSync(this.options.directory, { withFileTypes: true })
    } catch (error) {
      this.reportFailure('读取日志目录失败', error)
      return []
    }

    const files: ManagedLogFile[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = MANAGED_LOG_PATTERN.exec(entry.name)
      if (!match) continue
      const path = join(this.options.directory, entry.name)
      try {
        const metadata = statSync(path)
        files.push({
          name: entry.name,
          path,
          date: match[2],
          segment: Number(match[3] ?? 0),
          size: metadata.size,
          modifiedAt: metadata.mtimeMs,
        })
      } catch (error) {
        this.reportFailure(`读取日志文件状态失败: ${entry.name}`, error)
      }
    }
    return files
  }

  private removeManagedFile(file: ManagedLogFile): boolean {
    try {
      unlinkSync(file.path)
      return true
    } catch (error) {
      this.reportFailure(`删除日志文件失败: ${file.name}`, error)
      return false
    }
  }

  private ensureDirectory(): void {
    try {
      mkdirSync(this.options.directory, { recursive: true })
    } catch (error) {
      this.reportFailure('创建日志目录失败', error)
    }
  }

  private reportFailure(message: string, error?: unknown): void {
    try {
      this.fallback(message, error)
    } catch {
      // The final fallback is intentionally ignored.
    }
  }
}

export { MANAGED_LOG_PATTERN }
