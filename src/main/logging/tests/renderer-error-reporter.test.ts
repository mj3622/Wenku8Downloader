import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoggerLike } from '../file-logger'
import { RendererErrorReporter } from '../renderer-error-reporter'

describe('RendererErrorReporter', () => {
  let clock: number
  let logger: LoggerLike
  let error: ReturnType<typeof vi.fn<LoggerLike['error']>>
  let warn: ReturnType<typeof vi.fn<LoggerLike['warn']>>

  beforeEach(() => {
    clock = 1_000
    error = vi.fn<LoggerLike['error']>()
    warn = vi.fn<LoggerLike['warn']>()
    logger = {
      debug: vi.fn<LoggerLike['debug']>(),
      info: vi.fn<LoggerLike['info']>(),
      warn,
      error,
    }
  })

  it('logs first occurrences and summarizes duplicates after the window', () => {
    const reporter = new RendererErrorReporter({ logger, now: () => clock })
    const report = { kind: 'error' as const, message: 'render failed', source: 'file:///app.js' }

    reporter.report(7, report)
    reporter.report(7, report)
    expect(error).toHaveBeenCalledTimes(1)

    clock += 60_001
    reporter.report(7, report)
    expect(warn).toHaveBeenCalledWith(
      'renderer.error-repeated',
      expect.any(String),
      expect.objectContaining({ senderId: 7, count: 1 }),
    )
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('limits each sender to 20 accepted reports per minute', () => {
    const reporter = new RendererErrorReporter({ logger, now: () => clock })
    for (let index = 0; index < 21; index += 1) {
      reporter.report(4, { kind: 'error', message: `failure-${index}` })
    }

    expect(error).toHaveBeenCalledTimes(20)
    expect(warn).toHaveBeenCalledWith(
      'renderer.error-rate-limited',
      expect.any(String),
      { senderId: 4, limit: 20 },
    )
  })

  it('rate limits invalid reports from the same sender', () => {
    const reporter = new RendererErrorReporter({ logger, now: () => clock })
    for (let index = 0; index < 21; index += 1) {
      reporter.report(4, { kind: 'error', message: '', attempt: index })
    }

    expect(warn.mock.calls.filter(([event]) => event === 'renderer.error-rejected'))
      .toHaveLength(20)
    expect(warn).toHaveBeenCalledWith(
      'renderer.error-rate-limited',
      expect.any(String),
      { senderId: 4, limit: 20 },
    )
  })

  it('marks accepted reports as renderer-source entries', () => {
    const reporter = new RendererErrorReporter({ logger, now: () => clock })

    reporter.report(7, { kind: 'error', message: 'render failed' })

    expect(error).toHaveBeenCalledWith(
      'renderer.error',
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ senderId: 7 }),
      'renderer',
    )
  })

  it('rejects invalid reports without logging their payload', () => {
    const reporter = new RendererErrorReporter({ logger, now: () => clock })
    reporter.report(9, { kind: 'error', message: '', password: 'must-not-leak' })

    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'renderer.error-rejected',
      expect.any(String),
      { senderId: 9 },
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('must-not-leak')
  })
})
