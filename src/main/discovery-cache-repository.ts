import {
  RANKING_TYPES,
  type DiscoveryBook,
  type DiscoveryHome,
  type DiscoverySection,
  type RankingPage,
  type RankingType,
} from '../shared/ipc-types'
import type {
  CacheStore,
  CacheWriteGuard,
  SharedCacheAddress,
} from './cache/cache-store'

const SCHEMA_VERSION = 1 as const

type DiscoveryCacheStore = Pick<
  CacheStore,
  'captureWriteGuard' | 'readSharedJson' | 'writeSharedJson'
>

interface CacheEnvelope {
  schemaVersion: 1
  value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.hostname !== 'img.wenku8.com'
    ) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

function parseBook(value: unknown): DiscoveryBook | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^\d{1,12}$/.test(value.id)
    || typeof value.title !== 'string'
    || value.title.length === 0
    || value.title.length > 500) return null
  const cover = parseHttpUrl(value.cover)
  if (!cover) return null
  if (value.rank !== undefined && (!Number.isSafeInteger(value.rank) || (value.rank as number) < 1)) {
    return null
  }
  return {
    id: value.id,
    title: value.title,
    cover,
    ...(value.rank === undefined ? {} : { rank: value.rank as number }),
  }
}

function parseBooks(value: unknown): DiscoveryBook[] | null {
  if (!Array.isArray(value) || value.length > 500) return null
  const books = value.map(parseBook)
  return books.some(book => book === null) ? null : books as DiscoveryBook[]
}

function parseSection(value: unknown): DiscoverySection | null {
  if (!isRecord(value)
    || typeof value.key !== 'string'
    || value.key.length === 0
    || value.key.length > 100
    || typeof value.title !== 'string'
    || value.title.length === 0
    || value.title.length > 100
    || typeof value.moreRanking !== 'string'
    || !RANKING_TYPES.includes(value.moreRanking as RankingType)) return null
  const books = parseBooks(value.books)
  if (!books) return null
  return {
    key: value.key,
    title: value.title,
    moreRanking: value.moreRanking as RankingType,
    books,
  }
}

function parseFetchedAt(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
}

function unwrap(value: unknown): unknown | null {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !('value' in value)) return null
  return value.value
}

function parseHomeEnvelope(value: unknown): DiscoveryHome | null {
  const raw = unwrap(value)
  if (!isRecord(raw) || !Array.isArray(raw.sections) || raw.sections.length > 50) return null
  const fetchedAt = parseFetchedAt(raw.fetchedAt)
  const sections = raw.sections.map(parseSection)
  if (fetchedAt === null || sections.some(section => section === null)) return null
  return { sections: sections as DiscoverySection[], fetchedAt, stale: false }
}

function parseRankingEnvelope(value: unknown): RankingPage | null {
  const raw = unwrap(value)
  if (!isRecord(raw)
    || typeof raw.type !== 'string'
    || !RANKING_TYPES.includes(raw.type as RankingType)
    || typeof raw.title !== 'string'
    || raw.title.length === 0
    || raw.title.length > 100
    || !Number.isSafeInteger(raw.page)
    || (raw.page as number) < 1
    || !Number.isSafeInteger(raw.totalPages)
    || (raw.totalPages as number) < (raw.page as number)) return null
  const fetchedAt = parseFetchedAt(raw.fetchedAt)
  const books = parseBooks(raw.books)
  if (fetchedAt === null || !books) return null
  return {
    type: raw.type as RankingType,
    title: raw.title,
    page: raw.page as number,
    totalPages: raw.totalPages as number,
    books,
    fetchedAt,
    stale: false,
  }
}

function envelope(value: DiscoveryHome | RankingPage): CacheEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    value: { ...value, stale: false },
  }
}

export class DiscoveryCacheRepository {
  constructor(private readonly store: DiscoveryCacheStore) {}

  captureWriteGuard(): CacheWriteGuard {
    return this.store.captureWriteGuard()
  }

  loadHome(): Promise<DiscoveryHome | null> {
    return this.store.readSharedJson(this.address('home'), parseHomeEnvelope)
  }

  saveHome(value: DiscoveryHome, guard: CacheWriteGuard): Promise<boolean> {
    return this.store.writeSharedJson(this.address('home'), envelope(value), guard)
  }

  async loadRanking(type: RankingType, page: number): Promise<RankingPage | null> {
    const value = await this.store.readSharedJson(
      this.address(`ranking:${type}:${page}`),
      parseRankingEnvelope,
    )
    return value?.type === type && value.page === page ? value : null
  }

  saveRanking(value: RankingPage, guard: CacheWriteGuard): Promise<boolean> {
    return this.store.writeSharedJson(
      this.address(`ranking:${value.type}:${value.page}`),
      envelope(value),
      guard,
    )
  }

  private address(sourceKey: string): SharedCacheAddress {
    return { namespace: 'discovery', sourceKey }
  }
}
