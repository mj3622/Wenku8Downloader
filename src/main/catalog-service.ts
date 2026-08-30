import {
  catalogQueryKey,
  type CatalogPage,
  type CatalogQuery,
} from '../shared/ipc-types'
import type { CacheWriteGuard } from './cache/cache-store'

const FRESH_MS = 30 * 60 * 1_000
const STALE_FALLBACK_MS = 24 * 60 * 60 * 1_000

export interface CatalogSource {
  fetchPage(query: CatalogQuery): Promise<Omit<CatalogPage, 'fetchedAt' | 'stale'>>
}

export interface CatalogCache {
  captureWriteGuard(): CacheWriteGuard
  load(query: CatalogQuery): Promise<CatalogPage | null>
  save(value: CatalogPage, guard: CacheWriteGuard): Promise<boolean>
}

interface CatalogServiceOptions {
  source: CatalogSource
  cache: CatalogCache
  now?: () => number
}

function clonePage(value: CatalogPage): CatalogPage {
  return {
    ...value,
    query: { ...value.query },
    books: value.books.map(book => ({ ...book })),
  }
}

export class CatalogService {
  private readonly source: CatalogSource
  private readonly cache: CatalogCache
  private readonly now: () => number
  private readonly memory = new Map<string, CatalogPage>()
  private readonly inflight = new Map<string, Promise<CatalogPage>>()
  private epoch = 0

  constructor(options: CatalogServiceOptions) {
    this.source = options.source
    this.cache = options.cache
    this.now = options.now ?? Date.now
  }

  async getPage(
    query: CatalogQuery,
    options: { refresh?: boolean } = {},
  ): Promise<CatalogPage> {
    const requestedQuery = { ...query }
    const key = catalogQueryKey(requestedQuery)
    const epoch = this.epoch
    const cached = await this.cachedPage(key, requestedQuery, epoch)
    if (!options.refresh && this.isFresh(cached)) return clonePage(cached!)

    const existing = this.inflight.get(key)
    if (existing) return clonePage(await existing)

    const request = this.refreshPage(key, requestedQuery, cached, epoch).finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key)
    })
    this.inflight.set(key, request)
    return clonePage(await request)
  }

  clearMemory(): void {
    this.epoch++
    this.memory.clear()
    this.inflight.clear()
  }

  private async cachedPage(
    key: string,
    query: CatalogQuery,
    epoch: number,
  ): Promise<CatalogPage | null> {
    const memory = this.memory.get(key)
    if (memory) return memory
    const cached = await this.cache.load(query)
    if (cached && epoch === this.epoch) this.memory.set(key, cached)
    return cached
  }

  private isFresh(value: CatalogPage | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= FRESH_MS
  }

  private canFallback(value: CatalogPage | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= STALE_FALLBACK_MS
  }

  private async refreshPage(
    key: string,
    query: CatalogQuery,
    cached: CatalogPage | null,
    epoch: number,
  ): Promise<CatalogPage> {
    const guard = this.cache.captureWriteGuard()
    try {
      const value: CatalogPage = {
        ...await this.source.fetchPage(query),
        fetchedAt: this.now(),
        stale: false,
      }
      if (epoch === this.epoch) {
        this.memory.set(key, value)
        await this.cache.save(value, guard)
      }
      return value
    } catch (error) {
      if (!this.canFallback(cached)) throw error
      const fallback = { ...cached!, stale: true }
      if (epoch === this.epoch) this.memory.set(key, fallback)
      return fallback
    }
  }
}
