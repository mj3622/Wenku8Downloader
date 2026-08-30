import { afterEach, describe, expect, it, vi } from 'vitest'

const logMocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }))

vi.mock('./logging/logger', () => ({
  logger: { debug: vi.fn(), info: logMocks.info, warn: logMocks.warn, error: vi.fn() },
}))

import { DownloadRateLimiter } from './download-rate-limiter'

describe('DownloadRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops directly to the conservative tier after HTTP 429', () => {
    const schedule = vi.fn<(callback: () => void, delayMs: number) => unknown>()
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
    const limiter = new DownloadRateLimiter(() => undefined)
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

  it('spaces document request starts instead of releasing a concurrent burst', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const limiter = new DownloadRateLimiter()
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'

    const releaseFirst = await limiter.acquire('document', url)
    let secondStarted = false
    const second = limiter.acquire('document', url).then((release) => {
      secondStarted = true
      return release
    })
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(99)
    expect(secondStarted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const releaseSecond = await second
    expect(secondStarted).toBe(true)
    releaseFirst()
    releaseSecond()
  })

  it('shares a Retry-After cooldown with all document requests for the same origin', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const limiter = new DownloadRateLimiter()
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'
    const waits: number[] = []

    const state = limiter.recordResponse('document', url, {
      status: 429,
      latencyMs: 200,
      retryAfterMs: 5_000,
    })
    let started = false
    const request = limiter.acquire('document', url, undefined, (waitMs) => waits.push(waitMs))
      .then((release) => {
        started = true
        return release
      })
    await Promise.resolve()

    expect(state.cooldownMs).toBe(5_000)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(started).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const release = await request
    expect(started).toBe(true)
    expect(waits[0]).toBe(5_000)
    release()
  })

  it('does not shorten a server Retry-After longer than the local backoff cap', () => {
    const limiter = new DownloadRateLimiter(() => undefined)
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'

    const state = limiter.recordResponse('document', url, {
      status: 429,
      latencyMs: 200,
      retryAfterMs: 120_000,
    })

    expect(state.cooldownMs).toBe(120_000)
    expect(limiter.retryDelay('document', url, {
      attempt: 1,
      status: 429,
      retryAfterMs: 120_000,
    })).toBe(120_000)
  })

  it('isolates document throttling from image CDN requests', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const limiter = new DownloadRateLimiter()
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'

    limiter.recordResponse('document', url, {
      status: 429,
      latencyMs: 200,
      retryAfterMs: 5_000,
    })

    const release = await limiter.acquire('image', 'https://pic.example/image.jpg')
    expect(release).toEqual(expect.any(Function))
    expect(vi.getTimerCount()).toBe(1)
    release()
  })

  it('cancels a request while it is waiting behind another permit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const limiter = new DownloadRateLimiter()
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'
    const controller = new AbortController()

    const releaseFirst = await limiter.acquire('document', url)
    const second = limiter.acquire('document', url)
    const cancelled = limiter.acquire('document', url, controller.signal)
    controller.abort()

    await expect(cancelled).rejects.toThrow('下载已取消')
    await vi.advanceTimersByTimeAsync(100)
    const releaseSecond = await second
    releaseFirst()
    releaseSecond()
  })

  it('enforces one origin-wide in-flight limit across document and image requests', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter({
      schedule: (callback) => { unlocks.push(callback) },
    })
    limiter.record(429)
    unlocks.shift()?.()
    limiter.record(503)
    expect(limiter.speed.level).toBe(3)

    const url = 'https://www.wenku8.net/novel/1/2/3.htm'
    const releaseFirst = await limiter.acquire('image', url)
    let secondStarted = false
    const second = limiter.acquire('document', url).then((release) => {
      secondStarted = true
      return release
    })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(secondStarted).toBe(false)

    releaseFirst()
    const releaseSecond = await second
    expect(secondStarted).toBe(true)
    releaseSecond()
  })

  it('starts an interactive waiter before an earlier background waiter', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter({
      schedule: (callback) => { unlocks.push(callback) },
    })
    limiter.record(429)
    unlocks.shift()?.()
    limiter.record(503)
    expect(limiter.speed.level).toBe(3)

    const url = 'https://www.wenku8.net/book/3057.htm'
    const releaseFirst = await limiter.acquire('document', url)
    const order: string[] = []
    const background = limiter.acquire(
      'document',
      url,
      undefined,
      undefined,
      'background',
    ).then((release) => {
      order.push('background')
      return release
    })
    const interactive = limiter.acquire(
      'document',
      url,
      undefined,
      undefined,
      'interactive',
    ).then((release) => {
      order.push('interactive')
      return release
    })

    releaseFirst()
    await vi.advanceTimersByTimeAsync(2_000)
    const releaseInteractive = await interactive
    expect(order).toEqual(['interactive'])

    releaseInteractive()
    await vi.advanceTimersByTimeAsync(2_000)
    const releaseBackground = await background
    expect(order).toEqual(['interactive', 'background'])
    releaseBackground()
  })

  it('ages a background waiter so interactive traffic cannot starve it', async () => {
    vi.useFakeTimers()
    let now = 1_000
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter({
      now: () => now,
      schedule: (callback) => { unlocks.push(callback) },
      sleep: async (delayMs) => { now += delayMs },
    })
    limiter.record(429)
    unlocks.shift()?.()
    limiter.record(503)

    const url = 'https://www.wenku8.net/book/3057.htm'
    const releaseFirst = await limiter.acquire('document', url)
    const order: string[] = []
    const background = limiter.acquire(
      'document',
      url,
      undefined,
      undefined,
      'background',
    ).then((release) => {
      order.push('background')
      return release
    })
    now += 15_000
    const interactive = limiter.acquire(
      'document',
      url,
      undefined,
      undefined,
      'interactive',
    ).then((release) => {
      order.push('interactive')
      return release
    })

    releaseFirst()
    const releaseBackground = await background
    expect(order).toEqual(['background'])

    releaseBackground()
    const releaseInteractive = await interactive
    expect(order).toEqual(['background', 'interactive'])
    releaseInteractive()
  })

  it('groups upgraded HTTP image URLs with their actual HTTPS origin', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const unlocks: Array<() => void> = []
    const limiter = new DownloadRateLimiter({
      schedule: (callback) => { unlocks.push(callback) },
    })
    limiter.record(429)
    unlocks.shift()?.()
    limiter.record(503)
    expect(limiter.speed.level).toBe(3)

    const releaseFirst = await limiter.acquire('image', 'http://pic.example/first.jpg')
    let secondStarted = false
    const second = limiter.acquire('image', 'https://pic.example/second.jpg').then((release) => {
      secondStarted = true
      return release
    })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(secondStarted).toBe(false)

    releaseFirst()
    const releaseSecond = await second
    expect(secondStarted).toBe(true)
    releaseSecond()
  })

  it('adapts delay gradually and never speeds up from an error response', () => {
    const limiter = new DownloadRateLimiter(() => undefined)
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'

    limiter.recordResponse('document', url, { status: 200, latencyMs: 300 })
    const recoveredDelay = limiter.getRequestDelay('document', url)
    limiter.recordResponse('document', url, { status: 503, latencyMs: 100 })

    expect(recoveredDelay).toBe(100)
    expect(limiter.getRequestDelay('document', url)).toBeGreaterThanOrEqual(500)
  })

  it('honors Retry-After and otherwise uses capped full-jitter backoff', () => {
    const limiter = new DownloadRateLimiter({ random: () => 0.5 })
    const url = 'https://www.wenku8.net/novel/1/2/3.htm'

    expect(limiter.retryDelay('document', url, {
      attempt: 1,
      status: 429,
      retryAfterMs: 7_000,
    })).toBe(7_000)
    expect(limiter.retryDelay('document', url, { attempt: 1, status: 503 })).toBe(500)
    expect(limiter.retryDelay('document', url, { attempt: 2, status: 503 })).toBe(1_000)
    expect(limiter.retryDelay('document', url, { attempt: 100, status: 503 })).toBe(30_000)
  })
})
