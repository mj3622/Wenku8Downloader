import type {
  SearchResponse,
  SearchResult,
  SearchType,
} from '../shared/ipc-types'
import { SearchCooldownError } from './crawler'

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000
const DEFAULT_MAX_ENTRIES = 100

interface SearchSource {
  search(query: string, type: SearchType): Promise<SearchResult[]>
}

interface SearchServiceOptions {
  now?: () => number
  cacheTtlMs?: number
  maxEntries?: number
}

interface SearchCacheEntry {
  fetchedAt: number
  results: SearchResult[]
}

function cloneResults(results: SearchResult[]): SearchResult[] {
  return results.map((result) => ({ ...result }))
}

function cloneResponse(response: SearchResponse): SearchResponse {
  if (response.status === 'ok') {
    return { ...response, results: cloneResults(response.results) }
  }
  return {
    ...response,
    ...(response.cachedResults === undefined
      ? {}
      : { cachedResults: cloneResults(response.cachedResults) }),
  }
}

export class SearchService {
  private readonly now: () => number
  private readonly cacheTtlMs: number
  private readonly maxEntries: number
  private readonly cache = new Map<string, SearchCacheEntry>()
  private readonly inflight = new Map<string, Promise<SearchResponse>>()
  private cooldownUntil = 0
  private epoch = 0

  constructor(
    private readonly source: SearchSource,
    options: SearchServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.cacheTtlMs = Math.max(1, Math.round(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS))
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES))
  }

  async search(type: SearchType, rawQuery: string): Promise<SearchResponse> {
    if (type !== 'author' && type !== 'title') throw new TypeError('搜索方式无效')
    const query = rawQuery.trim()
    if (!query || query.length > 100) throw new TypeError('请输入 1 到 100 个字符')

    const key = `${type}\u0000${query}`
    const cached = this.cache.get(key)
    const now = this.now()
    if (cached && now >= cached.fetchedAt && now - cached.fetchedAt <= this.cacheTtlMs) {
      this.touch(key, cached)
      return {
        status: 'ok',
        results: cloneResults(cached.results),
        fetchedAt: cached.fetchedAt,
        cached: true,
      }
    }

    if (now < this.cooldownUntil) {
      return {
        status: 'cooldown',
        retryAt: this.cooldownUntil,
        ...(cached === undefined ? {} : { cachedResults: cloneResults(cached.results) }),
      }
    }

    const existing = this.inflight.get(key)
    if (existing) return cloneResponse(await existing)

    const epoch = this.epoch
    const request = this.fetch(type, query, key, cached, epoch).finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key)
    })
    this.inflight.set(key, request)
    return cloneResponse(await request)
  }

  clearMemory(): void {
    this.epoch++
    this.cache.clear()
    this.inflight.clear()
    this.cooldownUntil = 0
  }

  private async fetch(
    type: SearchType,
    query: string,
    key: string,
    cached?: SearchCacheEntry,
    epoch = this.epoch,
  ): Promise<SearchResponse> {
    try {
      const results = cloneResults(await this.source.search(query, type))
      const entry = { fetchedAt: this.now(), results }
      if (epoch === this.epoch) {
        this.touch(key, entry)
        this.evict()
      }
      return {
        status: 'ok',
        results: cloneResults(results),
        fetchedAt: entry.fetchedAt,
        cached: false,
      }
    } catch (error) {
      if (!(error instanceof SearchCooldownError)) throw error
      const retryAt = this.now() + error.retryAfterMs
      if (epoch === this.epoch) {
        this.cooldownUntil = Math.max(this.cooldownUntil, retryAt)
      }
      return {
        status: 'cooldown',
        retryAt: epoch === this.epoch ? this.cooldownUntil : retryAt,
        ...(cached === undefined ? {} : { cachedResults: cloneResults(cached.results) }),
      }
    }
  }

  private touch(key: string, entry: SearchCacheEntry): void {
    this.cache.delete(key)
    this.cache.set(key, entry)
  }

  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined
      if (oldestKey === undefined) return
      this.cache.delete(oldestKey)
    }
  }
}
