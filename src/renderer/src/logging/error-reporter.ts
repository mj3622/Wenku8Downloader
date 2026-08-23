import type { RendererErrorReport } from '../../../shared/ipc-types'

const MAX_MESSAGE = 8 * 1024
const MAX_STACK = 32 * 1024
const MAX_SOURCE = 4 * 1024

function bounded(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function safeReport(
  report: (value: RendererErrorReport) => void,
  value: RendererErrorReport,
): void {
  try {
    report(value)
  } catch {
    // Error reporting must not create another renderer failure.
  }
}

export function installRendererErrorReporter(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  report: (value: RendererErrorReport) => void,
): () => void {
  const onError = (rawEvent: Event): void => {
    try {
      const event = rawEvent as ErrorEvent
      const message = bounded(event.message || 'Unknown renderer error', MAX_MESSAGE)
        ?? 'Unknown renderer error'
      safeReport(report, {
        kind: 'error',
        message,
        stack: bounded(event.error instanceof Error ? event.error.stack : undefined, MAX_STACK),
        source: bounded(event.filename || undefined, MAX_SOURCE),
        line: event.lineno || undefined,
        column: event.colno || undefined,
      })
    } catch {
      safeReport(report, {
        kind: 'error',
        message: 'Unknown renderer error',
      })
    }
  }
  const onRejection = (rawEvent: Event): void => {
    try {
      const reason = (rawEvent as Event & { reason?: unknown }).reason
      const rawMessage = reason instanceof Error ? reason.message : String(reason ?? 'Unknown rejection')
      safeReport(report, {
        kind: 'unhandled-rejection',
        message: bounded(rawMessage, MAX_MESSAGE) ?? 'Unknown rejection',
        stack: bounded(reason instanceof Error ? reason.stack : undefined, MAX_STACK),
      })
    } catch {
      safeReport(report, {
        kind: 'unhandled-rejection',
        message: 'Unknown rejection',
        stack: undefined,
      })
    }
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
