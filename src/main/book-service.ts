import type { Book } from './book'

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
      return cached.promise
    }

    const entry: CacheEntry = {
      promise: this.loader(bookId),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    this.cache.set(bookId, entry)

    entry.promise.then(
      () => {
        entry.expiresAt = this.now() + this.ttlMs
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
