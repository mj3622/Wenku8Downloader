import type { Book } from './book'
import { logger } from './logging/logger'

type BookLoader = (bookId: string) => Promise<Book>

type CacheEntry = {
  promise: Promise<Book>
  expiresAt: number
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

  get(bookId: string): Promise<Book> {
    const now = this.now()
    this.removeExpired(now)
    const cached = this.cache.get(bookId)
    if (cached) {
      logger.debug('book.cache.hit', '命中作品缓存', { bookId })
      return cached.promise
    }

    logger.info('book.cache.miss', '未命中作品缓存，开始加载', { bookId })
    const startedAt = this.now()

    const entry: CacheEntry = {
      promise: this.loader(bookId),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    this.cache.set(bookId, entry)

    entry.promise.then(
      (book) => {
        entry.expiresAt = this.now() + this.ttlMs
        logger.info('book.loaded', '作品信息加载完成', {
          bookId,
          title: book.basicInfo?.['标题'],
          volumeCount: Object.keys(book.volumes ?? {}).length,
          durationMs: Math.max(0, this.now() - startedAt),
        })
      },
      () => {
        if (this.cache.get(bookId) === entry) this.cache.delete(bookId)
      },
    )
    return entry.promise
  }

  clear(): void {
    this.cache.clear()
  }
}
