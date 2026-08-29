import type {
  DiscoveryHome,
  DiscoverySection,
  RankingPage,
  RankingType,
} from '../shared/ipc-types'
import { isDiscoveryFresh } from '../shared/ipc-types'
import type { CacheWriteGuard } from './cache/cache-store'

const STALE_FALLBACK_MS = 24 * 60 * 60 * 1000

export interface DiscoverySource {
  fetchHome(): Promise<DiscoverySection[]>
  fetchRanking(
    type: RankingType,
    page: number,
  ): Promise<Omit<RankingPage, 'fetchedAt' | 'stale'>>
}

export interface DiscoveryCache {
  captureWriteGuard(): CacheWriteGuard
  loadHome(): Promise<DiscoveryHome | null>
  saveHome(value: DiscoveryHome, guard: CacheWriteGuard): Promise<boolean>
  loadRanking(type: RankingType, page: number): Promise<RankingPage | null>
  saveRanking(value: RankingPage, guard: CacheWriteGuard): Promise<boolean>
}

interface DiscoveryServiceOptions {
  source: DiscoverySource
  cache: DiscoveryCache
  now?: () => number
}

function cloneHome(value: DiscoveryHome): DiscoveryHome {
  return {
    ...value,
    sections: value.sections.map(section => ({
      ...section,
      books: section.books.map(book => ({ ...book })),
    })),
  }
}

function cloneRanking(value: RankingPage): RankingPage {
  return { ...value, books: value.books.map(book => ({ ...book })) }
}

export class DiscoveryService {
  private readonly source: DiscoverySource
  private readonly cache: DiscoveryCache
  private readonly now: () => number
  private readonly memory = new Map<string, DiscoveryHome | RankingPage>()
  private readonly inflight = new Map<string, Promise<DiscoveryHome | RankingPage>>()

  constructor(options: DiscoveryServiceOptions) {
    this.source = options.source
    this.cache = options.cache
    this.now = options.now ?? Date.now
  }

  async getHome(options: { refresh?: boolean } = {}): Promise<DiscoveryHome> {
    const key = 'home'
    const cached = await this.cachedHome(key)
    if (!options.refresh && this.isFresh(cached)) return cloneHome(cached!)
    const existing = this.inflight.get(key)
    if (existing) return cloneHome(await existing as DiscoveryHome)

    const request = this.refreshHome(cached).finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return cloneHome(await request)
  }

  async getRanking(
    type: RankingType,
    page: number,
    options: { refresh?: boolean } = {},
  ): Promise<RankingPage> {
    const key = `ranking:${type}:${page}`
    const cached = await this.cachedRanking(key, type, page)
    if (!options.refresh && this.isFresh(cached)) return cloneRanking(cached!)
    const existing = this.inflight.get(key)
    if (existing) return cloneRanking(await existing as RankingPage)

    const request = this.refreshRanking(type, page, cached)
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return cloneRanking(await request)
  }

  clearMemory(): void {
    this.memory.clear()
  }

  private async cachedHome(key: string): Promise<DiscoveryHome | null> {
    const memory = this.memory.get(key) as DiscoveryHome | undefined
    if (memory) return memory
    const cached = await this.cache.loadHome()
    if (cached) this.memory.set(key, cached)
    return cached
  }

  private async cachedRanking(
    key: string,
    type: RankingType,
    page: number,
  ): Promise<RankingPage | null> {
    const memory = this.memory.get(key) as RankingPage | undefined
    if (memory) return memory
    const cached = await this.cache.loadRanking(type, page)
    if (cached) this.memory.set(key, cached)
    return cached
  }

  private isFresh(value: DiscoveryHome | RankingPage | null): boolean {
    return value !== null && isDiscoveryFresh(value.fetchedAt, this.now())
  }

  private canFallback(value: DiscoveryHome | RankingPage | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= STALE_FALLBACK_MS
  }

  private async refreshHome(cached: DiscoveryHome | null): Promise<DiscoveryHome> {
    const guard = this.cache.captureWriteGuard()
    try {
      const value: DiscoveryHome = {
        sections: await this.source.fetchHome(),
        fetchedAt: this.now(),
        stale: false,
      }
      this.memory.set('home', value)
      await this.cache.saveHome(value, guard)
      return value
    } catch (error) {
      if (!this.canFallback(cached)) throw error
      const fallback = { ...cached!, stale: true }
      this.memory.set('home', fallback)
      return fallback
    }
  }

  private async refreshRanking(
    type: RankingType,
    page: number,
    cached: RankingPage | null,
  ): Promise<RankingPage> {
    const key = `ranking:${type}:${page}`
    const guard = this.cache.captureWriteGuard()
    try {
      const value: RankingPage = {
        ...await this.source.fetchRanking(type, page),
        fetchedAt: this.now(),
        stale: false,
      }
      this.memory.set(key, value)
      await this.cache.saveRanking(value, guard)
      return value
    } catch (error) {
      if (!this.canFallback(cached)) throw error
      const fallback = { ...cached!, stale: true }
      this.memory.set(key, fallback)
      return fallback
    }
  }
}
