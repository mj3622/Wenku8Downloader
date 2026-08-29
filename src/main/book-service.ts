import type { Book, ParsedBookPage } from './book'
import type { BookCacheRepository } from './book-cache-repository'
import {
  createBookVersion,
  type BookSnapshot,
  type BookVersion,
} from './book-cache-model'
import {
  DownloadCancelledError,
  throwIfDownloadCancelled,
} from './download-cancellation'
import { logger } from './logging/logger'

export interface BookGetOptions {
  signal?: AbortSignal
  onThrottleWait?: (waitMs: number) => void
  revalidate?: boolean
}

export interface BookSource {
  fetchPage(
    bookId: string,
    signal: AbortSignal,
    onThrottleWait: (waitMs: number) => void,
  ): Promise<ParsedBookPage>
  buildFromPage(
    bookId: string,
    page: ParsedBookPage,
    version: BookVersion,
    legacyImportGenerationKey: string,
    signal: AbortSignal,
    onThrottleWait: (waitMs: number) => void,
  ): Promise<Book>
  restore(snapshot: BookSnapshot): Book
}

type BookRepository = Pick<
  BookCacheRepository,
  | 'captureWriteGuard'
  | 'loadSnapshot'
  | 'saveSnapshot'
  | 'removeOtherGenerations'
>

type BookWaiter = {
  onThrottleWait?: (waitMs: number) => void
}

type InFlightEntry = {
  promise: Promise<Book>
  controller: AbortController
  waiters: Set<BookWaiter>
  revalidate: boolean
}

interface ResolvedBook {
  book: Book
  checkedAt: number
}

export interface BookServiceOptions {
  now?: () => number
  validationGraceMs?: number
  unknownVersionTtlMs?: number
  maxResolvedBooks?: number
}

const DEFAULT_VALIDATION_GRACE_MS = 60 * 1000
const DEFAULT_UNKNOWN_VERSION_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_RESOLVED_BOOKS = 32

function waitForBook(
  entry: InFlightEntry,
  signal?: AbortSignal,
  onThrottleWait?: (waitMs: number) => void,
): Promise<Book> {
  throwIfDownloadCancelled(signal)
  const waiter = { onThrottleWait }
  entry.waiters.add(waiter)
  return new Promise<Book>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      entry.waiters.delete(waiter)
      if (entry.waiters.size === 0 && !entry.controller.signal.aborted) {
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
  private readonly inFlight = new Map<string, InFlightEntry>()
  private readonly resolved = new Map<string, ResolvedBook>()
  private memoryEpoch = 0
  private readonly now: () => number
  private readonly validationGraceMs: number
  private readonly unknownVersionTtlMs: number
  private readonly maxResolvedBooks: number

  constructor(
    private readonly source: BookSource,
    private readonly repository: BookRepository,
    options: BookServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.validationGraceMs = options.validationGraceMs ?? DEFAULT_VALIDATION_GRACE_MS
    this.unknownVersionTtlMs = options.unknownVersionTtlMs ?? DEFAULT_UNKNOWN_VERSION_TTL_MS
    const maxResolvedBooks = options.maxResolvedBooks ?? DEFAULT_MAX_RESOLVED_BOOKS
    this.maxResolvedBooks = Number.isFinite(maxResolvedBooks)
      ? Math.max(1, Math.floor(maxResolvedBooks))
      : DEFAULT_MAX_RESOLVED_BOOKS
  }

  get(bookId: string, options: BookGetOptions = {}): Promise<Book> {
    throwIfDownloadCancelled(options.signal)
    const key = bookId
    let entry = this.inFlight.get(key)
    if (entry?.controller.signal.aborted) {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key)
      entry = undefined
    }
    if (entry) {
      if (options.revalidate && !entry.revalidate) {
        const afterCurrent = (): Promise<Book> => {
          throwIfDownloadCancelled(options.signal)
          return this.get(bookId, options)
        }
        return waitForBook(entry, options.signal, options.onThrottleWait).then(
          afterCurrent,
          () => afterCurrent(),
        )
      }
      logger.debug('book.cache.hit', '复用进行中的作品加载', { bookId })
      return waitForBook(entry, options.signal, options.onThrottleWait)
    }

    const controller = new AbortController()
    const waiters = new Set<BookWaiter>()
    const startedAt = this.now()
    const memoryEpoch = this.memoryEpoch
    const promise = this.load(bookId, Boolean(options.revalidate), memoryEpoch, controller.signal, (waitMs) => {
      for (const waiter of waiters) waiter.onThrottleWait?.(waitMs)
    })
    entry = { promise, controller, waiters, revalidate: Boolean(options.revalidate) }
    this.inFlight.set(key, entry)
    logger.info('book.cache.miss', '开始加载或校验作品缓存', {
      bookId,
      revalidate: Boolean(options.revalidate),
    })
    promise.then(
      (book) => {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key)
        logger.info('book.loaded', '作品信息加载完成', {
          bookId,
          title: book.basicInfo['标题'],
          volumeCount: Object.keys(book.volumes).length,
          durationMs: Math.max(0, this.now() - startedAt),
        })
      },
      () => {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key)
      },
    )
    return waitForBook(entry, options.signal, options.onThrottleWait)
  }

  clearMemory(): void {
    this.memoryEpoch++
    this.resolved.clear()
    this.inFlight.clear()
  }

  private async load(
    bookId: string,
    revalidate: boolean,
    memoryEpoch: number,
    signal: AbortSignal,
    onThrottleWait: (waitMs: number) => void,
  ): Promise<Book> {
    let cached = this.takeResolved(bookId)
    if (!cached) {
      const snapshot = await this.repository.loadSnapshot(bookId)
      if (snapshot) cached = { checkedAt: snapshot.checkedAt, book: this.source.restore(snapshot) }
    }
    const now = this.now()
    if (cached && !revalidate) {
      const age = now - cached.checkedAt
      const reusable = age >= 0 && (cached.book.version.stable
        ? age < this.validationGraceMs
        : age < this.unknownVersionTtlMs)
      if (reusable) {
        this.remember(bookId, cached.book, cached.checkedAt, memoryEpoch)
        logger.debug('book.cache.hit', '命中已校验作品缓存', {
          bookId,
          stableVersion: cached.book.version.stable,
        })
        return cached.book
      }
    }

    const guard = this.repository.captureWriteGuard()
    const page = await this.source.fetchPage(bookId, signal, onThrottleWait)
    const candidateVersion = createBookVersion(page.versionFields, now)

    if (cached
      && !revalidate
      && cached.book.version.stable
      && candidateVersion.stable
      && cached.book.version.generationKey === candidateVersion.generationKey) {
      const cachedSnapshot = cached.book.toSnapshot(cached.checkedAt)
      const refreshedSnapshot: BookSnapshot = {
        ...cachedSnapshot,
        checkedAt: now,
        version: candidateVersion,
        basicInfo: { ...page.basicInfo },
      }
      const book = this.source.restore(refreshedSnapshot)
      await this.repository.saveSnapshot(refreshedSnapshot, guard)
      this.remember(bookId, book, refreshedSnapshot.checkedAt, memoryEpoch)
      logger.debug('book.cache.version-current', '作品版本未变化，复用目录缓存', { bookId })
      return book
    }

    const legacyImportGenerationKey = cached?.book.legacyImportGenerationKey
      ?? candidateVersion.generationKey
    const book = await this.source.buildFromPage(
      bookId,
      page,
      candidateVersion,
      legacyImportGenerationKey,
      signal,
      onThrottleWait,
    )
    const snapshot = book.toSnapshot(now)
    const saved = await this.repository.saveSnapshot(snapshot, guard)
    if (saved) {
      await this.repository.removeOtherGenerations(bookId, snapshot.version.generationKey)
    }
    this.remember(bookId, book, snapshot.checkedAt, memoryEpoch)
    return book
  }

  private takeResolved(bookId: string): ResolvedBook | undefined {
    const cached = this.resolved.get(bookId)
    if (!cached) return undefined
    this.resolved.delete(bookId)
    this.resolved.set(bookId, cached)
    return cached
  }

  private remember(bookId: string, book: Book, checkedAt: number, memoryEpoch: number): void {
    if (memoryEpoch !== this.memoryEpoch) return
    this.resolved.delete(bookId)
    this.resolved.set(bookId, { book, checkedAt })
    while (this.resolved.size > this.maxResolvedBooks) {
      const oldest = this.resolved.keys().next().value
      if (oldest === undefined) return
      this.resolved.delete(oldest)
    }
  }
}
