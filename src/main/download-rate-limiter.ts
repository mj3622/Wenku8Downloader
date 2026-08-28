import {
  DownloadCancelledError,
  sleepWithSignal,
  throwIfDownloadCancelled,
} from './download-cancellation'
import type {
  CrawlerRequestControl,
  CrawlerRequestKind,
} from './crawler'
import { logger } from './logging/logger'

export const DOWNLOAD_SPEED_TIERS = [
  { level: 0, name: '激进', chapterConcurrency: 5, imageConcurrency: 4, delayMs: 100, maxRetries: 1 },
  { level: 1, name: '中等', chapterConcurrency: 3, imageConcurrency: 2, delayMs: 500, maxRetries: 2 },
  { level: 2, name: '保守', chapterConcurrency: 2, imageConcurrency: 1, delayMs: 1000, maxRetries: 3 },
  { level: 3, name: '兜底', chapterConcurrency: 1, imageConcurrency: 1, delayMs: 2000, maxRetries: 3 },
] as const

const SUCCESS_RESET_THRESHOLD = 10
const MAX_RETRY_DELAY_MS = 60_000
const MAX_REQUEST_DELAY_MS = 10_000
const MIN_RETRY_BASE_MS = 1_000

type Scheduler = (callback: () => void, delayMs: number) => unknown
type RequestSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>

export type DownloadRequestKind = CrawlerRequestKind

export interface DownloadResponseObservation {
  status: number
  latencyMs: number
  retryAfterMs?: number
}

export interface DownloadRetryObservation {
  attempt: number
  status?: number
  retryAfterMs?: number
}

export interface DownloadRateLimiterOptions {
  schedule?: Scheduler
  now?: () => number
  random?: () => number
  sleep?: RequestSleep
}

type CapacityRelease = () => void

type CapacityWaiter = {
  kind: DownloadRequestKind
  resolve(release: CapacityRelease): void
  cleanup(): void
}

type RequestSlot = {
  delayMs: number
  nextAllowedAt: number
  blockedUntil: number
  queue: Promise<void>
  inFlight: Record<DownloadRequestKind, number>
  capacityWaiters: CapacityWaiter[]
}

export interface DownloadRequestControlOptions {
  onResponseObserved?: () => void
  onThrottleWait?: (waitMs: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeRequestUrl(kind: DownloadRequestKind, url: string): string {
  if (kind !== 'image') return url
  try {
    const normalized = new URL(url)
    if (normalized.protocol === 'http:') normalized.protocol = 'https:'
    return normalized.toString()
  } catch {
    return url.replace(/^http:\/\//, 'https://')
  }
}

function requestOrigin(kind: DownloadRequestKind, url: string): string {
  try {
    return new URL(normalizeRequestUrl(kind, url)).origin
  } catch {
    return 'unknown-origin'
  }
}

async function waitForQueue(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  throwIfDownloadCancelled(signal)
  if (!signal) {
    await previous
    return
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      cleanup()
      reject(new DownloadCancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    previous.then(
      () => {
        cleanup()
        resolve()
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export class DownloadRateLimiter {
  private speedTier = 0
  private consecutiveSuccess = 0
  private tierLock = false
  private lockGeneration = 0
  private readonly slots = new Map<string, RequestSlot>()
  private readonly schedule: Scheduler
  private readonly now: () => number
  private readonly random: () => number
  private readonly sleep: RequestSleep

  constructor(optionsOrSchedule: DownloadRateLimiterOptions | Scheduler = {}) {
    const options = typeof optionsOrSchedule === 'function'
      ? { schedule: optionsOrSchedule }
      : optionsOrSchedule
    this.schedule = options.schedule ?? setTimeout
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.sleep = options.sleep ?? sleepWithSignal
  }

  get speed(): typeof DOWNLOAD_SPEED_TIERS[number] {
    return DOWNLOAD_SPEED_TIERS[this.speedTier]
  }

  private slotKey(kind: DownloadRequestKind, url: string): string {
    return requestOrigin(kind, url)
  }

  private getSlot(kind: DownloadRequestKind, url: string): RequestSlot {
    const key = this.slotKey(kind, url)
    let slot = this.slots.get(key)
    if (!slot) {
      slot = {
        delayMs: this.speed.delayMs,
        nextAllowedAt: 0,
        blockedUntil: 0,
        queue: Promise.resolve(),
        inFlight: { document: 0, image: 0 },
        capacityWaiters: [],
      }
      this.slots.set(key, slot)
    }
    return slot
  }

  private lockTier(delayMs: number): void {
    this.tierLock = true
    const generation = ++this.lockGeneration
    this.schedule(() => {
      if (this.lockGeneration === generation) this.tierLock = false
    }, delayMs)
  }

  record(status: number): void {
    const previousTier = this.speedTier
    if (status === 429) {
      this.consecutiveSuccess = 0
      if (this.speedTier < DOWNLOAD_SPEED_TIERS.length - 1) {
        this.speedTier = Math.max(this.speedTier, 2)
      }
      logger.warn('download.rate-limit.changed', '检测到服务器限流，已降低下载速度', {
        status,
        tier: this.speed.name,
        level: this.speed.level,
        cooldownMs: 30000,
      })
      this.lockTier(30000)
    } else if (status === 503) {
      this.consecutiveSuccess = 0
      if (!this.tierLock && this.speedTier < DOWNLOAD_SPEED_TIERS.length - 1) {
        this.speedTier++
        logger.warn('download.rate-limit.changed', '服务器暂时不可用，已降低下载速度', {
          status,
          tier: this.speed.name,
          level: this.speed.level,
          cooldownMs: 10000,
        })
        this.lockTier(10000)
      }
    } else if (status === 403) {
      this.consecutiveSuccess = 0
      logger.warn('download.rate-limit.authentication-warning', '访问被拒绝，Cookie 可能已过期', {
        status,
        tier: this.speed.name,
      })
    } else if (status === 200) {
      this.consecutiveSuccess++
      if (!this.tierLock && this.consecutiveSuccess >= SUCCESS_RESET_THRESHOLD && this.speedTier > 0) {
        this.speedTier--
        this.consecutiveSuccess = 0
        logger.info('download.rate-limit.recovered', '连续请求成功，已提高下载速度', {
          successfulRequests: SUCCESS_RESET_THRESHOLD,
          tier: this.speed.name,
          level: this.speed.level,
          cooldownMs: 5000,
        })
        this.lockTier(5000)
      }
    }
    if (this.speedTier !== previousTier) {
      for (const slot of this.slots.values()) this.drainCapacity(slot)
    }
  }

  private capacityLimit(kind: DownloadRequestKind): number {
    return kind === 'document'
      ? this.speed.chapterConcurrency
      : this.speed.imageConcurrency
  }

  private canStart(slot: RequestSlot, kind: DownloadRequestKind): boolean {
    const totalInFlight = slot.inFlight.document + slot.inFlight.image
    const totalLimit = Math.max(
      this.speed.chapterConcurrency,
      this.speed.imageConcurrency,
    )
    return slot.inFlight[kind] < this.capacityLimit(kind) && totalInFlight < totalLimit
  }

  private createCapacityRelease(
    slot: RequestSlot,
    kind: DownloadRequestKind,
  ): CapacityRelease {
    let released = false
    return () => {
      if (released) return
      released = true
      slot.inFlight[kind] = Math.max(0, slot.inFlight[kind] - 1)
      this.drainCapacity(slot)
    }
  }

  private drainCapacity(slot: RequestSlot): void {
    while (slot.capacityWaiters.length > 0) {
      const waiterIndex = slot.capacityWaiters.findIndex((waiter) => (
        this.canStart(slot, waiter.kind)
      ))
      if (waiterIndex < 0) return
      const [waiter] = slot.capacityWaiters.splice(waiterIndex, 1)
      waiter.cleanup()
      slot.inFlight[waiter.kind]++
      waiter.resolve(this.createCapacityRelease(slot, waiter.kind))
    }
  }

  private acquireCapacity(
    slot: RequestSlot,
    kind: DownloadRequestKind,
    signal?: AbortSignal,
  ): Promise<CapacityRelease> {
    throwIfDownloadCancelled(signal)
    if (this.canStart(slot, kind) && slot.capacityWaiters.length === 0) {
      slot.inFlight[kind]++
      return Promise.resolve(this.createCapacityRelease(slot, kind))
    }

    return new Promise<CapacityRelease>((resolve, reject) => {
      const onAbort = (): void => {
        const index = slot.capacityWaiters.indexOf(waiter)
        if (index >= 0) slot.capacityWaiters.splice(index, 1)
        waiter.cleanup()
        reject(new DownloadCancelledError())
      }
      const waiter: CapacityWaiter = {
        kind,
        resolve,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      }
      slot.capacityWaiters.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }

  async acquire(
    kind: DownloadRequestKind,
    url: string,
    signal?: AbortSignal,
    onThrottleWait?: (waitMs: number) => void,
  ): Promise<CapacityRelease> {
    const slot = this.getSlot(kind, url)
    const releaseCapacity = await this.acquireCapacity(slot, kind, signal)
    const previous = slot.queue
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    slot.queue = previous.then(() => current, () => current)

    try {
      await waitForQueue(previous, signal)
      while (true) {
        const now = this.now()
        const throttleWaitMs = Math.max(0, slot.blockedUntil - now)
        const spacingWaitMs = Math.max(0, slot.nextAllowedAt - now)
        const waitMs = Math.max(throttleWaitMs, spacingWaitMs)
        if (waitMs <= 0) break
        if (throttleWaitMs > 0 && throttleWaitMs >= spacingWaitMs) {
          onThrottleWait?.(waitMs)
        }
        await this.sleep(waitMs, signal)
      }
      slot.delayMs = Math.max(slot.delayMs, this.speed.delayMs)
      slot.nextAllowedAt = this.now() + slot.delayMs
      return releaseCapacity
    } catch (error) {
      releaseCapacity()
      throw error
    } finally {
      release()
    }
  }

  createRequestControl(
    kind: DownloadRequestKind,
    url: string,
    options: DownloadRequestControlOptions = {},
  ): CrawlerRequestControl {
    let releaseCapacity: CapacityRelease | undefined
    return {
      beforeAttempt: async (signal) => {
        releaseCapacity = await this.acquire(
          kind,
          url,
          signal,
          options.onThrottleWait,
        )
      },
      afterAttempt: () => {
        releaseCapacity?.()
        releaseCapacity = undefined
      },
      onResponse: (info) => {
        options.onResponseObserved?.()
        const state = this.recordResponse(kind, url, info)
        if (info.status === 429 && state.cooldownMs !== undefined) {
          options.onThrottleWait?.(state.cooldownMs)
        }
      },
      getRetryDelay: (info) => this.retryDelay(kind, url, info),
    }
  }

  recordResponse(
    kind: DownloadRequestKind,
    url: string,
    observation: DownloadResponseObservation,
  ): { cooldownMs?: number; nextDelayMs: number } {
    const slot = this.getSlot(kind, url)
    const latencyMs = Math.max(0, Math.round(observation.latencyMs))
    if (observation.status === 429) this.record(429)
    else if (observation.status === 503) this.record(503)
    else if (observation.status === 403) this.record(403)
    else if (observation.status === 200) this.record(200)

    // Observed response latency determines the adaptive spacing, while the current
    // speed tier remains the single floor for delay and concurrency.
    const targetConcurrency = this.capacityLimit(kind)
    const targetDelayMs = clamp(
      Math.max(this.speed.delayMs, Math.round(latencyMs / targetConcurrency)),
      this.speed.delayMs,
      MAX_REQUEST_DELAY_MS,
    )
    const successful = observation.status >= 200 && observation.status < 400
    slot.delayMs = successful
      ? clamp(
          Math.round((Math.max(slot.delayMs, this.speed.delayMs) + targetDelayMs) / 2),
          this.speed.delayMs,
          MAX_REQUEST_DELAY_MS,
        )
      : clamp(
          Math.max(slot.delayMs, targetDelayMs),
          this.speed.delayMs,
          MAX_REQUEST_DELAY_MS,
        )

    let cooldownMs: number | undefined
    if (observation.status === 429) {
      slot.delayMs = clamp(
        Math.max(slot.delayMs * 2, this.speed.delayMs),
        this.speed.delayMs,
        MAX_REQUEST_DELAY_MS,
      )
      const retryAfterMs = observation.retryAfterMs !== undefined
        && Number.isFinite(observation.retryAfterMs)
        ? Math.max(0, Math.round(observation.retryAfterMs))
        : 0
      cooldownMs = Math.max(this.speed.delayMs * 5, retryAfterMs)
      slot.blockedUntil = Math.max(slot.blockedUntil, this.now() + cooldownMs)
    } else if (observation.status === 503) {
      cooldownMs = this.speed.delayMs * 3
      slot.blockedUntil = Math.max(slot.blockedUntil, this.now() + cooldownMs)
    }

    if (cooldownMs !== undefined) {
      logger.warn('download.request.throttled', '下载请求已进入自适应等待', {
        kind,
        origin: requestOrigin(kind, url),
        status: observation.status,
        latencyMs,
        nextDelayMs: slot.delayMs,
        cooldownMs,
      })
    }
    return { ...(cooldownMs === undefined ? {} : { cooldownMs }), nextDelayMs: slot.delayMs }
  }

  getRequestDelay(_kind: DownloadRequestKind, url: string): number {
    return this.getSlot(_kind, url).delayMs
  }

  retryDelay(
    _kind: DownloadRequestKind,
    _url: string,
    observation: DownloadRetryObservation,
  ): number {
    if (observation.retryAfterMs !== undefined && Number.isFinite(observation.retryAfterMs)) {
      return Math.max(0, Math.round(observation.retryAfterMs))
    }
    const attempt = Math.max(1, Math.floor(observation.attempt))
    const exponentialCap = Math.min(
      MAX_RETRY_DELAY_MS,
      Math.max(MIN_RETRY_BASE_MS, this.speed.delayMs) * (2 ** Math.min(attempt - 1, 16)),
    )
    return Math.round(clamp(this.random(), 0, 1) * exponentialCap)
  }
}

export const sharedDownloadRateLimiter = new DownloadRateLimiter()
