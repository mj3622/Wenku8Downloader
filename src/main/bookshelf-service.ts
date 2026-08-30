import type {
  BookshelfEntry,
  BookshelfPage,
  DownloadSnapshot,
} from '../shared/ipc-types'
import type { CacheWriteGuard } from './cache/cache-store'
import type { CachedBookshelf } from './bookshelf-cache-repository'
import type { RemoteBookshelfEntry } from './bookshelf-parser'

const FRESH_MS = 10 * 60 * 1_000
const STALE_FALLBACK_MS = 24 * 60 * 60 * 1_000
const CREDENTIALS_CHANGED_MESSAGE = '登录状态已变更，请重新加载书架'

export interface BookshelfSource {
  fetchEntries(): Promise<RemoteBookshelfEntry[]>
}

export interface BookshelfCache {
  captureWriteGuard(): CacheWriteGuard
  load(credentialRevision: number): Promise<CachedBookshelf | null>
  save(value: CachedBookshelf, guard: CacheWriteGuard): Promise<boolean>
}

interface BookshelfServiceOptions {
  source: BookshelfSource
  refreshSource?: BookshelfSource
  cache: BookshelfCache
  getCredentialRevision: () => number
  getDownloadSnapshot: () => DownloadSnapshot
  now?: () => number
}

function cloneRemote(value: CachedBookshelf): CachedBookshelf {
  return { ...value, entries: value.entries.map(entry => ({ ...entry })) }
}

function mergeEntry(entry: RemoteBookshelfEntry, downloads: DownloadSnapshot): BookshelfEntry {
  const completed = downloads.tasks
    .filter(task => task.bookId === entry.bookId && task.status === 'completed')
  const hasFull = completed.some(task => task.type === 'epub_full')
  const hasPartial = completed.some(task => task.type === 'epub_volume' || task.type === 'images')
  return {
    ...entry,
    localState: hasFull ? 'unknown' : hasPartial ? 'partial' : 'none',
    updateAvailable: false,
  }
}

export class BookshelfService {
  private readonly source: BookshelfSource
  private readonly refreshSource: BookshelfSource
  private readonly cache: BookshelfCache
  private readonly getCredentialRevision: () => number
  private readonly getDownloadSnapshot: () => DownloadSnapshot
  private readonly now: () => number
  private readonly memory = new Map<number, CachedBookshelf>()
  private readonly inflight = new Map<number, Promise<{ value: CachedBookshelf; stale: boolean }>>()
  private epoch = 0

  constructor(options: BookshelfServiceOptions) {
    this.source = options.source
    this.refreshSource = options.refreshSource ?? options.source
    this.cache = options.cache
    this.getCredentialRevision = options.getCredentialRevision
    this.getDownloadSnapshot = options.getDownloadSnapshot
    this.now = options.now ?? Date.now
  }

  async getPage(options: { refresh?: boolean } = {}): Promise<BookshelfPage> {
    const revision = this.getCredentialRevision()
    const epoch = this.epoch
    const cached = await this.cached(revision, epoch)
    this.assertRevision(revision)
    if (!options.refresh && this.isFresh(cached)) return this.toPage(cached!, false)

    const existing = this.inflight.get(revision)
    if (existing) {
      const result = await existing
      return this.toPage(result.value, result.stale)
    }
    const source = options.refresh ? this.refreshSource : this.source
    const request = this.refresh(revision, cached, source, epoch).then(value => ({
      value,
      stale: value === cached,
    })).finally(() => {
      if (this.inflight.get(revision) === request) this.inflight.delete(revision)
    })
    this.inflight.set(revision, request)
    const result = await request
    return this.toPage(result.value, result.stale)
  }

  clearMemory(): void {
    this.epoch++
    this.memory.clear()
    this.inflight.clear()
  }

  private async cached(revision: number, epoch: number): Promise<CachedBookshelf | null> {
    const memory = this.memory.get(revision)
    if (memory) return memory
    const cached = await this.cache.load(revision)
    if (cached && epoch === this.epoch && revision === this.getCredentialRevision()) {
      this.memory.set(revision, cached)
    }
    return cached
  }

  private isFresh(value: CachedBookshelf | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= FRESH_MS
  }

  private canFallback(value: CachedBookshelf | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= STALE_FALLBACK_MS
  }

  private assertRevision(expected: number): void {
    if (expected !== this.getCredentialRevision()) throw new Error(CREDENTIALS_CHANGED_MESSAGE)
  }

  private async refresh(
    revision: number,
    cached: CachedBookshelf | null,
    source: BookshelfSource,
    epoch: number,
  ): Promise<CachedBookshelf> {
    const guard = this.cache.captureWriteGuard()
    try {
      const entries = await source.fetchEntries()
      this.assertRevision(revision)
      const value: CachedBookshelf = {
        credentialRevision: revision,
        fetchedAt: this.now(),
        entries: entries.map(entry => ({ ...entry })),
      }
      if (epoch === this.epoch) {
        this.memory.set(revision, value)
        await this.cache.save(value, guard)
      }
      return value
    } catch (error) {
      this.assertRevision(revision)
      if (!this.canFallback(cached)) throw error
      return cached!
    }
  }

  private toPage(value: CachedBookshelf, stale: boolean): BookshelfPage {
    const cloned = cloneRemote(value)
    const downloads = this.getDownloadSnapshot()
    return {
      entries: cloned.entries.map(entry => mergeEntry(entry, downloads)),
      fetchedAt: cloned.fetchedAt,
      stale,
    }
  }
}
