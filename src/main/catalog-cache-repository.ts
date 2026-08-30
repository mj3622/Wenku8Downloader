import {
  CATALOG_ANIMATIONS,
  CATALOG_INITIALS,
  CATALOG_PUBLISHER_OPTIONS,
  CATALOG_SORTS,
  CATALOG_STATUSES,
  CATALOG_TAGS,
  catalogQueryKey,
  type CatalogAnimation,
  type CatalogInitial,
  type CatalogPage,
  type CatalogPublisher,
  type CatalogQuery,
  type CatalogSort,
  type CatalogStatus,
  type CatalogTag,
  type SearchResult,
} from '../shared/ipc-types'
import type {
  CacheStore,
  CacheWriteGuard,
  SharedCacheAddress,
} from './cache/cache-store'

const SCHEMA_VERSION = 1 as const
const PUBLISHERS = new Set<string>(CATALOG_PUBLISHER_OPTIONS.map(option => option.value))
const INITIALS = new Set<string>(CATALOG_INITIALS)
const TAGS = new Set<string>(CATALOG_TAGS)
const SORTS = new Set<string>(CATALOG_SORTS)
const STATUSES = new Set<string>(CATALOG_STATUSES)
const ANIMATIONS = new Set<string>(CATALOG_ANIMATIONS)

type CatalogCacheStore = Pick<
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

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) return null
  return value
}

function parseCover(value: unknown): string | null {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > 2_048) return null
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

function parseBook(value: unknown): SearchResult | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^\d{1,12}$/.test(value.id)
    || typeof value.title !== 'string'
    || value.title.length === 0
    || value.title.length > 500) return null
  const cover = parseCover(value.cover)
  const author = optionalString(value.author, 500)
  const publisher = optionalString(value.publisher, 500)
  const status = optionalString(value.status, 100)
  const updateTime = optionalString(value.updateTime, 100)
  const wordCount = optionalString(value.wordCount, 100)
  const tags = optionalString(value.tags, 1_000)
  const desc = optionalString(value.desc, 2_000)
  if (
    cover === null
    || author === null
    || publisher === null
    || status === null
    || updateTime === null
    || wordCount === null
    || tags === null
    || desc === null
    || (value.isAnimated !== undefined && typeof value.isAnimated !== 'boolean')
  ) return null
  return {
    id: value.id,
    title: value.title,
    cover,
    ...(author === undefined ? {} : { author }),
    ...(publisher === undefined ? {} : { publisher }),
    ...(status === undefined ? {} : { status }),
    ...(updateTime === undefined ? {} : { updateTime }),
    ...(wordCount === undefined ? {} : { wordCount }),
    ...(value.isAnimated === undefined ? {} : { isAnimated: value.isAnimated }),
    ...(tags === undefined ? {} : { tags }),
    ...(desc === undefined ? {} : { desc }),
  }
}

function parseQuery(value: unknown): CatalogQuery | null {
  if (!isRecord(value)
    || typeof value.status !== 'string'
    || !STATUSES.has(value.status)
    || typeof value.animation !== 'string'
    || !ANIMATIONS.has(value.animation)
    || typeof value.sort !== 'string'
    || !SORTS.has(value.sort)
    || !Number.isSafeInteger(value.page)
    || (value.page as number) < 1
    || (value.page as number) > 500) return null
  if (value.publisher !== undefined
    && (typeof value.publisher !== 'string' || !PUBLISHERS.has(value.publisher))) return null
  if (value.initial !== undefined
    && (typeof value.initial !== 'string' || !INITIALS.has(value.initial))) return null
  if (value.tag !== undefined
    && (typeof value.tag !== 'string' || !TAGS.has(value.tag))) return null
  return {
    ...(value.publisher === undefined ? {} : { publisher: value.publisher as CatalogPublisher }),
    ...(value.initial === undefined ? {} : { initial: value.initial as CatalogInitial }),
    ...(value.tag === undefined ? {} : { tag: value.tag as CatalogTag }),
    status: value.status as CatalogStatus,
    animation: value.animation as CatalogAnimation,
    sort: value.sort as CatalogSort,
    page: value.page as number,
  }
}

function parseEnvelope(value: unknown): CatalogPage | null {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !('value' in value)) return null
  const raw = value.value
  if (!isRecord(raw)
    || !Array.isArray(raw.books)
    || raw.books.length > 500
    || !Number.isSafeInteger(raw.page)
    || (raw.page as number) < 1
    || (raw.page as number) > 500
    || !Number.isSafeInteger(raw.totalPages)
    || (raw.totalPages as number) < (raw.page as number)
    || !Number.isSafeInteger(raw.fetchedAt)
    || (raw.fetchedAt as number) < 0) return null
  const query = parseQuery(raw.query)
  const books = raw.books.map(parseBook)
  if (!query || query.page !== raw.page || books.some(book => book === null)) return null
  return {
    query,
    books: books as SearchResult[],
    page: raw.page as number,
    totalPages: raw.totalPages as number,
    fetchedAt: raw.fetchedAt as number,
    stale: false,
  }
}

function envelope(value: CatalogPage): CacheEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    value: { ...value, stale: false },
  }
}

export class CatalogCacheRepository {
  constructor(private readonly store: CatalogCacheStore) {}

  captureWriteGuard(): CacheWriteGuard {
    return this.store.captureWriteGuard()
  }

  async load(query: CatalogQuery): Promise<CatalogPage | null> {
    const value = await this.store.readSharedJson(this.address(query), parseEnvelope)
    return value && catalogQueryKey(value.query) === catalogQueryKey(query) ? value : null
  }

  save(value: CatalogPage, guard: CacheWriteGuard): Promise<boolean> {
    return this.store.writeSharedJson(this.address(value.query), envelope(value), guard)
  }

  private address(query: CatalogQuery): SharedCacheAddress {
    return { namespace: 'catalog', sourceKey: catalogQueryKey(query) }
  }
}
