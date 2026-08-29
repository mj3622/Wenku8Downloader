import type { RendererErrorReport } from '../../shared/ipc-types'
import { validateRendererErrorReport } from '../ipc-validation'
import type { LoggerLike } from './file-logger'
import { sanitizeLogText } from './redaction'

const REPORTS_PER_MINUTE = 20
const WINDOW_MS = 60_000
const MAX_FINGERPRINTS_PER_SENDER = 100

interface DuplicateState {
  firstAt: number
  repeated: number
}

interface SenderState {
  reports: number[]
  duplicates: Map<string, DuplicateState>
  rateLimitLogged: boolean
  lastSeen: number
}

export interface RendererErrorReporterOptions {
  logger: LoggerLike
  now?: () => number
}

export class RendererErrorReporter {
  private readonly now: () => number
  private readonly senders = new Map<number, SenderState>()

  constructor(private readonly options: RendererErrorReporterOptions) {
    this.now = options.now ?? Date.now
  }

  report(senderId: number, input: unknown): void {
    const now = this.now()
    this.pruneInactiveSenders(now)
    const state = this.getSenderState(senderId, now)
    state.lastSeen = now
    state.reports = state.reports.filter((timestamp) => now - timestamp < WINDOW_MS)
    if (state.reports.length >= REPORTS_PER_MINUTE) {
      if (!state.rateLimitLogged) {
        state.rateLimitLogged = true
        this.options.logger.warn(
          'renderer.error-rate-limited',
          '渲染进程错误报告已触发限流',
          { senderId, limit: REPORTS_PER_MINUTE },
        )
      }
      return
    }
    if (state.reports.length === 0) {
      state.rateLimitLogged = false
    }
    state.reports.push(now)

    let report: RendererErrorReport
    try {
      report = validateRendererErrorReport(input)
    } catch {
      this.options.logger.warn(
        'renderer.error-rejected',
        '拒绝了无效的渲染进程错误报告',
        { senderId },
      )
      return
    }

    const fingerprint = JSON.stringify([
      report.kind,
      sanitizeLogText(report.message),
      sanitizeLogText(report.stack ?? ''),
      sanitizeLogText(report.source ?? ''),
    ])
    const previous = state.duplicates.get(fingerprint)
    if (previous && now - previous.firstAt < WINDOW_MS) {
      previous.repeated += 1
      return
    }
    if (previous?.repeated) {
      this.options.logger.warn(
        'renderer.error-repeated',
        '渲染进程错误在去重窗口内重复出现',
        { senderId, count: previous.repeated },
      )
    }

    if (!previous && state.duplicates.size >= MAX_FINGERPRINTS_PER_SENDER) {
      const oldest = state.duplicates.keys().next().value
      if (oldest !== undefined) state.duplicates.delete(oldest)
    }
    state.duplicates.set(fingerprint, { firstAt: now, repeated: 0 })
    const error = new Error(report.message)
    error.name = report.kind === 'error' ? 'RendererError' : 'RendererUnhandledRejection'
    if (report.stack) error.stack = report.stack
    this.options.logger.error('renderer.error', '渲染进程上报未处理错误', error, {
      senderId,
      kind: report.kind,
      source: report.source,
      line: report.line,
      column: report.column,
    }, 'renderer')
  }

  private getSenderState(senderId: number, now: number): SenderState {
    const existing = this.senders.get(senderId)
    if (existing) return existing
    const created: SenderState = {
      reports: [],
      duplicates: new Map(),
      rateLimitLogged: false,
      lastSeen: now,
    }
    this.senders.set(senderId, created)
    return created
  }

  private pruneInactiveSenders(now: number): void {
    for (const [senderId, state] of this.senders) {
      if (now - state.lastSeen >= WINDOW_MS * 2) {
        this.senders.delete(senderId)
      }
    }
  }
}
