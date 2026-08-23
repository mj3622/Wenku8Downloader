import { describe, expect, it, vi } from 'vitest'

const logMocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }))

vi.mock('./logging/logger', () => ({
  logger: { debug: vi.fn(), info: logMocks.info, warn: logMocks.warn, error: vi.fn() },
}))

import { DownloadRateLimiter } from './download-rate-limiter'

describe('DownloadRateLimiter', () => {
  it('drops directly to the conservative tier after HTTP 429', () => {
    const schedule = vi.fn()
    const limiter = new DownloadRateLimiter(schedule)

    limiter.record(429)

    expect(limiter.speed.level).toBe(2)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30000)
    expect(logMocks.warn).toHaveBeenCalledWith(
      'download.rate-limit.changed',
      expect.any(String),
      expect.objectContaining({ status: 429, tier: '保守', cooldownMs: 30000 }),
    )
  })

  it('keeps degraded state for later consumers', () => {
    const limiter = new DownloadRateLimiter(vi.fn())
    limiter.record(429)

    const laterTaskSpeed = limiter.speed

    expect(laterTaskSpeed.chapterConcurrency).toBe(2)
    expect(laterTaskSpeed.imageConcurrency).toBe(1)
  })

  it('recovers one tier after enough successful requests', () => {
    let unlock: (() => void) | undefined
    const delays: number[] = []
    const limiter = new DownloadRateLimiter((callback, delayMs) => {
      unlock = callback
      delays.push(delayMs)
    })
    limiter.record(429)
    unlock?.()

    for (let i = 0; i < 10; i++) limiter.record(200)

    expect(limiter.speed.level).toBe(1)
    expect(delays).toEqual([30000, 5000])
    expect(logMocks.info).toHaveBeenCalledWith(
      'download.rate-limit.recovered',
      expect.any(String),
      expect.objectContaining({ tier: '中等', cooldownMs: 5000 }),
    )
  })

  it('uses a ten-second cooldown after HTTP 503', () => {
    const schedule = vi.fn()
    const limiter = new DownloadRateLimiter(schedule)

    limiter.record(503)

    expect(limiter.speed.level).toBe(1)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 10000)
  })

  it('does not let an older cooldown callback unlock a newer cooldown', () => {
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter((callback) => { unlocks.push(callback) })

    limiter.record(429)
    limiter.record(429)
    unlocks[0]()

    for (let i = 0; i < 10; i++) limiter.record(200)
    expect(limiter.speed.level).toBe(2)

    unlocks[1]()
    limiter.record(200)
    expect(limiter.speed.level).toBe(1)
  })

  it('refreshes the 429 cooldown at the slowest tier', () => {
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter((callback) => { unlocks.push(callback) })

    limiter.record(429)
    unlocks.shift()?.()
    limiter.record(503)
    unlocks.shift()?.()
    expect(limiter.speed.level).toBe(3)

    limiter.record(429)
    for (let i = 0; i < 10; i++) limiter.record(200)

    expect(unlocks).toHaveLength(1)
    expect(limiter.speed.level).toBe(3)

    unlocks.shift()?.()
    limiter.record(200)
    expect(limiter.speed.level).toBe(2)
  })
})
