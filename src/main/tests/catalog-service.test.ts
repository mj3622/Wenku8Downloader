import { describe, expect, it, vi } from 'vitest'
import type { CatalogPage, CatalogQuery } from '../../shared/ipc-types'
import {
  CatalogService,
  catalogQueryKey,
  type CatalogCache,
  type CatalogSource,
} from '../catalog-service'
import type { CacheWriteGuard } from '../cache/cache-store'

function query(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    status: 'all',
    animation: 'all',
    sort: 'lastupdate',
    page: 1,
    ...overrides,
  }
}

function page(catalogQuery: CatalogQuery, fetchedAt = 1_000): CatalogPage {
  return {
    query: { ...catalogQuery },
    books: [{ id: '3057', title: '败北女角太多了！', cover: 'https://img.wenku8.com/3057.jpg' }],
    page: catalogQuery.page,
    totalPages: 10,
    fetchedAt,
    stale: false,
  }
}

function setup(options: { now?: number; cached?: CatalogPage | null } = {}) {
  let cached = options.cached ?? null
  const source: CatalogSource = {
    fetchPage: vi.fn(async catalogQuery => ({
      ...page(catalogQuery, 0),
      query: { ...catalogQuery },
      fetchedAt: undefined as never,
      stale: undefined as never,
    })),
  }
  const cache: CatalogCache = {
    captureWriteGuard: vi.fn((): CacheWriteGuard => ({ epoch: 0 })),
    load: vi.fn(async () => cached),
    save: vi.fn(async value => {
      cached = value
      return true
    }),
  }
  const service = new CatalogService({
    source,
    cache,
    now: () => options.now ?? 10_000,
  })
  return { service, source, cache, readCache: () => cached }
}

describe('CatalogService', () => {
  it('returns fresh cache entries without a network request and clones results', async () => {
    const catalogQuery = query({ publisher: '10' })
    const cached = page(catalogQuery, 9_000)
    const { service, source } = setup({ cached })

    const first = await service.getPage(catalogQuery)
    first.books[0].title = 'changed'
    const second = await service.getPage(catalogQuery)

    expect(second.books[0].title).toBe('败北女角太多了！')
    expect(source.fetchPage).not.toHaveBeenCalled()
  })

  it('deduplicates inflight requests and lets refresh reuse the active request', async () => {
    let resolve!: (value: Omit<CatalogPage, 'fetchedAt' | 'stale'>) => void
    const pending = new Promise<Omit<CatalogPage, 'fetchedAt' | 'stale'>>(next => { resolve = next })
    const { service, source } = setup()
    vi.mocked(source.fetchPage).mockReturnValue(pending)
    const catalogQuery = query({ tag: '校园' })

    const first = service.getPage(catalogQuery)
    const second = service.getPage({ ...catalogQuery }, { refresh: true })
    await vi.waitFor(() => expect(source.fetchPage).toHaveBeenCalledTimes(1))
    resolve({
      query: catalogQuery,
      books: [],
      page: 1,
      totalPages: 1,
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ fetchedAt: 10_000 }),
      expect.objectContaining({ fetchedAt: 10_000 }),
    ])
  })

  it('refreshes stale entries and falls back to cache for up to 24 hours', async () => {
    const catalogQuery = query()
    const cached = page(catalogQuery, 10_000 - 60 * 60 * 1_000)
    const { service, source } = setup({ cached, now: 10_000 })
    vi.mocked(source.fetchPage).mockRejectedValue(new Error('offline'))

    await expect(service.getPage(catalogQuery)).resolves.toEqual({ ...cached, stale: true })
  })

  it('rejects stale fallback after 24 hours', async () => {
    const catalogQuery = query()
    const cached = page(catalogQuery, 1_000)
    const { service, source } = setup({ cached, now: 24 * 60 * 60 * 1_000 + 1_001 })
    vi.mocked(source.fetchPage).mockRejectedValue(new Error('offline'))

    await expect(service.getPage(catalogQuery)).rejects.toThrow('offline')
  })

  it('manual refresh bypasses a fresh cache entry', async () => {
    const catalogQuery = query()
    const { service, source } = setup({ cached: page(catalogQuery, 9_000) })

    await service.getPage(catalogQuery, { refresh: true })

    expect(source.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does not restore memory or disk cache from a request cleared while inflight', async () => {
    let resolve!: (value: Omit<CatalogPage, 'fetchedAt' | 'stale'>) => void
    const pending = new Promise<Omit<CatalogPage, 'fetchedAt' | 'stale'>>(next => { resolve = next })
    const { service, source, cache } = setup()
    vi.mocked(source.fetchPage).mockReturnValue(pending)
    const catalogQuery = query()

    const oldRequest = service.getPage(catalogQuery)
    await vi.waitFor(() => expect(source.fetchPage).toHaveBeenCalledTimes(1))
    service.clearMemory()
    resolve({ query: catalogQuery, books: [], page: 1, totalPages: 1 })
    await oldRequest

    expect(cache.save).not.toHaveBeenCalled()
    await service.getPage(catalogQuery)
    expect(source.fetchPage).toHaveBeenCalledTimes(2)
  })

  it('serializes query keys independently of object property order', () => {
    const first = query({ publisher: '10', initial: 'A', page: 3 })
    const second = {
      page: 3,
      sort: 'lastupdate',
      animation: 'all',
      status: 'all',
      initial: 'A',
      publisher: '10',
    } as CatalogQuery

    expect(catalogQueryKey(first)).toBe(catalogQueryKey(second))
  })
})
