import type {
  AnnualRankingPage,
  DiscoveryHome,
  DiscoverySection,
  RankingPage,
  RankingType,
} from '../shared/ipc-types'
import { isAnnualRankingFresh, isDiscoveryFresh } from '../shared/ipc-types'
import type { CacheWriteGuard } from './cache/cache-store'

const STALE_FALLBACK_MS = 24 * 60 * 60 * 1000
const ANNUAL_STALE_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000

export interface DiscoverySource {
  fetchHome(): Promise<DiscoverySection[]>
  fetchRanking(
    type: RankingType,
    page: number,
  ): Promise<Omit<RankingPage, 'fetchedAt' | 'stale'>>
  fetchAnnualRanking(year: number): Promise<Omit<AnnualRankingPage, 'fetchedAt' | 'stale'>>
}

export interface DiscoveryCache {
  captureWriteGuard(): CacheWriteGuard
  loadHome(): Promise<DiscoveryHome | null>
  saveHome(value: DiscoveryHome, guard: CacheWriteGuard): Promise<boolean>
  loadRanking(type: RankingType, page: number): Promise<RankingPage | null>
  saveRanking(value: RankingPage, guard: CacheWriteGuard): Promise<boolean>
  loadAnnualRanking(year: number): Promise<AnnualRankingPage | null>
  saveAnnualRanking(value: AnnualRankingPage, guard: CacheWriteGuard): Promise<boolean>
}

interface DiscoveryServiceOptions {
  source: DiscoverySource
  refreshSource?: DiscoverySource
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

function cloneAnnualRanking(value: AnnualRankingPage): AnnualRankingPage {
  return {
    ...value,
    categories: {
      bunko: value.categories.bunko.map(book => ({ ...book })),
      tankobon: value.categories.tankobon.map(book => ({ ...book })),
    },
  }
}

export class DiscoveryService {
  private readonly source: DiscoverySource
  private readonly refreshSource: DiscoverySource
  private readonly cache: DiscoveryCache
  private readonly now: () => number
  private readonly memory = new Map<string, DiscoveryHome | RankingPage | AnnualRankingPage>()
  private readonly inflight = new Map<
    string,
    Promise<DiscoveryHome | RankingPage | AnnualRankingPage>
  >()

  constructor(options: DiscoveryServiceOptions) {
    this.source = options.source
    this.refreshSource = options.refreshSource ?? options.source
    this.cache = options.cache
    this.now = options.now ?? Date.now
  }

  async getHome(options: { refresh?: boolean } = {}): Promise<DiscoveryHome> {
    const key = 'home'
    const cached = await this.cachedHome(key)
    if (!options.refresh && this.isFresh(cached)) return cloneHome(cached!)
    const existing = this.inflight.get(key)
    if (existing) return cloneHome(await existing as DiscoveryHome)

    const source = options.refresh ? this.refreshSource : this.source
    const request = this.refreshHome(cached, source).finally(() => this.inflight.delete(key))
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

    const source = options.refresh ? this.refreshSource : this.source
    const request = this.refreshRanking(type, page, cached, source)
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return cloneRanking(await request)
  }

  async getAnnualRanking(
    year: number,
    options: { refresh?: boolean } = {},
  ): Promise<AnnualRankingPage> {
    const key = `annual:${year}`
    const cached = await this.cachedAnnualRanking(key, year)
    if (!options.refresh && this.isAnnualFresh(cached)) return cloneAnnualRanking(cached!)
    const existing = this.inflight.get(key)
    if (existing) return cloneAnnualRanking(await existing as AnnualRankingPage)

    const source = options.refresh ? this.refreshSource : this.source
    const request = this.refreshAnnualRanking(year, cached, source)
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return cloneAnnualRanking(await request)
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

  private async cachedAnnualRanking(
    key: string,
    year: number,
  ): Promise<AnnualRankingPage | null> {
    const memory = this.memory.get(key) as AnnualRankingPage | undefined
    if (memory) return memory
    const cached = await this.cache.loadAnnualRanking(year)
    if (cached) this.memory.set(key, cached)
    return cached
  }

  private isFresh(value: DiscoveryHome | RankingPage | null): boolean {
    return value !== null && isDiscoveryFresh(value.fetchedAt, this.now())
  }

  private canFallback(value: DiscoveryHome | RankingPage | null): boolean {
    return value !== null && Math.max(0, this.now() - value.fetchedAt) <= STALE_FALLBACK_MS
  }

  private isAnnualFresh(value: AnnualRankingPage | null): boolean {
    return value !== null && isAnnualRankingFresh(value.fetchedAt, this.now())
  }

  private canFallbackAnnual(value: AnnualRankingPage | null): boolean {
    return value !== null
      && Math.max(0, this.now() - value.fetchedAt) <= ANNUAL_STALE_FALLBACK_MS
  }

  private async refreshHome(
    cached: DiscoveryHome | null,
    source: DiscoverySource,
  ): Promise<DiscoveryHome> {
    const guard = this.cache.captureWriteGuard()
    try {
      const value: DiscoveryHome = {
        sections: await source.fetchHome(),
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
    source: DiscoverySource,
  ): Promise<RankingPage> {
    const key = `ranking:${type}:${page}`
    const guard = this.cache.captureWriteGuard()
    try {
      const value: RankingPage = {
        ...await source.fetchRanking(type, page),
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

  private async refreshAnnualRanking(
    year: number,
    cached: AnnualRankingPage | null,
    source: DiscoverySource,
  ): Promise<AnnualRankingPage> {
    const key = `annual:${year}`
    const guard = this.cache.captureWriteGuard()
    try {
      const value: AnnualRankingPage = {
        ...await source.fetchAnnualRanking(year),
        fetchedAt: this.now(),
        stale: false,
      }
      this.memory.set(key, value)
      await this.cache.saveAnnualRanking(value, guard)
      return value
    } catch (error) {
      if (!this.canFallbackAnnual(cached)) throw error
      const fallback = { ...cached!, stale: true }
      this.memory.set(key, fallback)
      return fallback
    }
  }
}
