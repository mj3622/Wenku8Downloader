import type { CacheStore, CacheWriteGuard, SharedCacheAddress } from './cache/cache-store'
import type { RemoteBookshelfEntry } from './bookshelf-parser'

export interface CachedBookshelf {
  credentialRevision: number
  fetchedAt: number
  entries: RemoteBookshelfEntry[]
}

type BookshelfCacheStore = Pick<
  CacheStore,
  'captureWriteGuard' | 'readSharedJson' | 'writeSharedJson'
>

const ADDRESS: SharedCacheAddress = { namespace: 'bookshelf', sourceKey: 'current' }
const SCHEMA_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseEntry(value: unknown): RemoteBookshelfEntry | null {
  if (!isRecord(value)
    || typeof value.bookId !== 'string'
    || !/^\d{1,12}$/.test(value.bookId)
    || typeof value.title !== 'string'
    || !value.title
    || value.title.length > 500
    || typeof value.author !== 'string'
    || value.author.length > 500) return null
  for (const key of ['latestChapter', 'bookmark'] as const) {
    if (value[key] !== null && (typeof value[key] !== 'string' || value[key].length > 500)) return null
  }
  if (value.updatedAt !== null
    && (typeof value.updatedAt !== 'string' || value.updatedAt.length > 100)) return null
  return {
    bookId: value.bookId,
    title: value.title,
    author: value.author,
    latestChapter: value.latestChapter as string | null,
    bookmark: value.bookmark as string | null,
    updatedAt: value.updatedAt as string | null,
  }
}

function parseEnvelope(value: unknown): CachedBookshelf | null {
  if (!isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || !Number.isSafeInteger(value.credentialRevision)
    || (value.credentialRevision as number) < 0
    || !Number.isSafeInteger(value.fetchedAt)
    || (value.fetchedAt as number) < 0
    || !Array.isArray(value.entries)
    || value.entries.length > 600) return null
  const entries = value.entries.map(parseEntry)
  if (entries.some(entry => entry === null)) return null
  return {
    credentialRevision: value.credentialRevision as number,
    fetchedAt: value.fetchedAt as number,
    entries: entries as RemoteBookshelfEntry[],
  }
}

export class BookshelfCacheRepository {
  constructor(private readonly store: BookshelfCacheStore) {}

  captureWriteGuard(): CacheWriteGuard {
    return this.store.captureWriteGuard()
  }

  async load(credentialRevision: number): Promise<CachedBookshelf | null> {
    const cached = await this.store.readSharedJson(ADDRESS, parseEnvelope)
    return cached?.credentialRevision === credentialRevision ? cached : null
  }

  save(value: CachedBookshelf, guard: CacheWriteGuard): Promise<boolean> {
    return this.store.writeSharedJson(ADDRESS, {
      schemaVersion: SCHEMA_VERSION,
      ...value,
    }, guard)
  }
}
