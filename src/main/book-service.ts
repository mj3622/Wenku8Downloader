import type { Book } from './book'
import {
  DownloadCancelledError,
  throwIfDownloadCancelled,
} from './download-cancellation'
import { logger } from './logging/logger'

type BookLoader = (
  bookId: string,
  signal: AbortSignal,
  onThrottleWait: (waitMs: number) => void,
) => Promise<Book>

type BookWaiter = {
  onThrottleWait?: (waitMs: number) => void
}

type CacheEntry = {
  promise: Promise<Book>
  expiresAt: number
  controller: AbortController
  pending: boolean
  waiters: Set<BookWaiter>
}

function waitForBook(
  entry: CacheEntry,
  signal?: AbortSignal,
  onThrottleWait?: (waitMs: number) => void,
): Promise<Book> {
  throwIfDownloadCancelled(signal)
  const waiter = entry.pending ? { onThrottleWait } : undefined
  if (waiter) entry.waiters.add(waiter)
  return new Promise<Book>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (!waiter) return
      entry.waiters.delete(waiter)
      if (entry.pending && entry.waiters.size === 0 && !entry.controller.signal.aborted) {
        entry.controller.abort()
      }
    }
    const onAbort = (): void => {
      cleanup()
      reject(new DownloadCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    entry.promise.then(
      (book) => {
        cleanup()
        resolve(book)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export class BookService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly loader: BookLoader,
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private removeExpired(now: number): void {
    for (const [bookId, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(bookId)
    }
  }

  get(
    bookId: string,
    signal?: AbortSignal,
    onThrottleWait?: (waitMs: number) => void,
  ): Promise<Book> {
    throwIfDownloadCancelled(signal)
    const now = this.now()
    this.removeExpired(now)
    let cached = this.cache.get(bookId)
    if (cached?.pending && cached.controller.signal.aborted) {
      if (this.cache.get(bookId) === cached) this.cache.delete(bookId)
      cached = undefined
    }
    if (cached) {
      logger.debug('book.cache.hit', '命中作品缓存', { bookId })
      return waitForBook(cached, signal, onThrottleWait)
    }

    logger.info('book.cache.miss', '未命中作品缓存，开始加载', { bookId })
    const startedAt = this.now()

    const controller = new AbortController()
    const waiters = new Set<BookWaiter>()
    const promise = this.loader(bookId, controller.signal, (waitMs) => {
      for (const waiter of waiters) waiter.onThrottleWait?.(waitMs)
    })
    const entry: CacheEntry = {
      promise,
      expiresAt: Number.POSITIVE_INFINITY,
      controller,
      pending: true,
      waiters,
    }
    this.cache.set(bookId, entry)

    entry.promise.then(
      (book) => {
        entry.pending = false
        entry.expiresAt = this.now() + this.ttlMs
        logger.info('book.loaded', '作品信息加载完成', {
          bookId,
          title: book.basicInfo?.['标题'],
          volumeCount: Object.keys(book.volumes ?? {}).length,
          durationMs: Math.max(0, this.now() - startedAt),
        })
      },
      () => {
        entry.pending = false
        if (this.cache.get(bookId) === entry) this.cache.delete(bookId)
      },
    )
    return waitForBook(entry, signal, onThrottleWait)
  }

  clear(): void {
    this.cache.clear()
  }
}
