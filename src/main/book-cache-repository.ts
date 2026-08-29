import { imageExtensionFromUrl } from './path-safety'
import { parseBookSnapshot, type BookSnapshot } from './book-cache-model'
import { normalizeCacheUrl } from './cache/cache-key'
import {
  CacheStore,
  type CacheWriteGuard,
} from './cache/cache-store'

export interface BookResourceCache {
  captureResourceWriteGuard(bookId: string, generationKey: string): CacheWriteGuard
  loadIllustration(
    bookId: string,
    generationKey: string,
    pageUrl: string,
  ): Promise<string[] | null | undefined>
  saveIllustration(
    bookId: string,
    generationKey: string,
    pageUrl: string,
    urls: string[] | null,
    guard: CacheWriteGuard,
  ): Promise<boolean>
  loadCover(bookId: string, generationKey: string, coverUrl: string): Promise<Buffer | null>
  saveCover(
    bookId: string,
    generationKey: string,
    coverUrl: string,
    data: Buffer,
    guard: CacheWriteGuard,
  ): Promise<boolean>
}

function parseIllustration(value: unknown): { urls: string[] | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const urls = (value as Record<string, unknown>).urls
  if (urls === null) return { urls: null }
  if (!Array.isArray(urls) || urls.some(url => normalizeCacheUrl(String(url)) === null)) return null
  return { urls: urls.map(String) }
}

export class BookCacheRepository implements BookResourceCache {
  constructor(private readonly store: CacheStore) {}

  captureWriteGuard(): CacheWriteGuard {
    return this.store.captureWriteGuard()
  }

  captureResourceWriteGuard(bookId: string, generationKey: string): CacheWriteGuard {
    return this.store.captureGenerationWriteGuard(bookId, generationKey)
  }

  async loadSnapshot(bookId: string): Promise<BookSnapshot | null> {
    const snapshot = await this.store.readJson(
      { kind: 'snapshot', bookId, sourceKey: 'current' },
      parseBookSnapshot,
    )
    return snapshot?.bookId === bookId ? snapshot : null
  }

  saveSnapshot(snapshot: BookSnapshot, guard: CacheWriteGuard): Promise<boolean> {
    return this.store.writeJson(
      { kind: 'snapshot', bookId: snapshot.bookId, sourceKey: 'current' },
      snapshot,
      guard,
    )
  }

  async loadIllustration(
    bookId: string,
    generationKey: string,
    pageUrl: string,
  ): Promise<string[] | null | undefined> {
    const normalized = normalizeCacheUrl(pageUrl)
    if (!normalized) return undefined
    const cached = await this.store.readJson(
      { kind: 'illustration', bookId, generationKey, sourceKey: normalized },
      parseIllustration,
    )
    if (!cached) return undefined
    return cached.urls ? [...cached.urls] : null
  }

  saveIllustration(
    bookId: string,
    generationKey: string,
    pageUrl: string,
    urls: string[] | null,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const normalizedPage = normalizeCacheUrl(pageUrl)
    if (!normalizedPage) return Promise.resolve(false)
    let normalizedUrls: string[] | null = null
    if (urls !== null) {
      normalizedUrls = []
      for (const url of urls) {
        const normalized = normalizeCacheUrl(url, normalizedPage)
        if (!normalized) return Promise.resolve(false)
        normalizedUrls.push(normalized)
      }
    }
    return this.store.writeJson(
      {
        kind: 'illustration',
        bookId,
        generationKey,
        sourceKey: normalizedPage,
      },
      { urls: normalizedUrls },
      guard,
    )
  }

  loadCover(
    bookId: string,
    generationKey: string,
    coverUrl: string,
  ): Promise<Buffer | null> {
    const normalized = normalizeCacheUrl(coverUrl)
    if (!normalized) return Promise.resolve(null)
    return this.store.readBinary({
      kind: 'cover',
      bookId,
      generationKey,
      sourceKey: normalized,
    }).then(value => value?.data ?? null)
  }

  saveCover(
    bookId: string,
    generationKey: string,
    coverUrl: string,
    data: Buffer,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const normalized = normalizeCacheUrl(coverUrl)
    if (!normalized || data.byteLength === 0) return Promise.resolve(false)
    return this.store.writeBinary({
      kind: 'cover',
      bookId,
      generationKey,
      sourceKey: normalized,
    }, {
      data,
      extension: imageExtensionFromUrl(normalized),
    }, guard)
  }

  removeOtherGenerations(bookId: string, keepGenerationKey: string): Promise<void> {
    return this.store.removeOtherGenerations(bookId, keepGenerationKey)
  }

  clearSnapshots(): Promise<void> {
    return this.store.clearSnapshots()
  }
}
