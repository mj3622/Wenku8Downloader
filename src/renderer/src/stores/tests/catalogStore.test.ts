import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogPage, CatalogQuery } from '../../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({ getCatalog: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import { DEFAULT_CATALOG_QUERY, useCatalogStore } from '../catalogStore'
import { useToastStore } from '../toastStore'

function page(query: CatalogQuery, stale = false): CatalogPage {
  return {
    query,
    books: [{ id: String(query.page), title: `第 ${query.page} 页`, cover: '' }],
    page: query.page,
    totalPages: 10,
    fetchedAt: 1,
    stale,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCatalogStore.getState().clear()
  useToastStore.getState().clear()
})

describe('catalogStore', () => {
  it('resets the page when filters change and preserves filters while paging', () => {
    useCatalogStore.getState().setPage(4)
    useCatalogStore.getState().setFilters({ publisher: '10' })
    expect(useCatalogStore.getState()).toMatchObject({
      page: 1,
      query: { ...DEFAULT_CATALOG_QUERY, publisher: '10', page: 1 },
    })

    useCatalogStore.getState().setPage(3)
    expect(useCatalogStore.getState().query).toMatchObject({ publisher: '10', page: 3 })
  })

  it('ignores an older response after filters change', async () => {
    let resolveFirst!: (value: CatalogPage) => void
    let resolveSecond!: (value: CatalogPage) => void
    mocks.getCatalog
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
    const firstQuery = { ...DEFAULT_CATALOG_QUERY, publisher: '1' as const }
    const secondQuery = { ...DEFAULT_CATALOG_QUERY, publisher: '10' as const }

    const first = useCatalogStore.getState().load(firstQuery)
    const second = useCatalogStore.getState().load(secondQuery)
    resolveSecond(page(secondQuery))
    await second
    resolveFirst(page(firstQuery))
    await first

    expect(useCatalogStore.getState()).toMatchObject({
      loading: false,
      query: secondQuery,
      result: expect.objectContaining({ query: secondQuery }),
    })
  })

  it('shows stale fallback and exposes recoverable failures', async () => {
    mocks.getCatalog.mockResolvedValueOnce(page(DEFAULT_CATALOG_QUERY, true))
    await useCatalogStore.getState().load()
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning', title: '正在使用缓存',
    })

    mocks.getCatalog.mockRejectedValueOnce(new Error('offline'))
    await useCatalogStore.getState().load(undefined, true)
    expect(useCatalogStore.getState()).toMatchObject({ loading: false, error: expect.any(String) })
    expect(useToastStore.getState().items[0]).toMatchObject({ tone: 'error' })
  })

  it('does not restore results after clear during a pending request', async () => {
    let resolve!: (value: CatalogPage) => void
    mocks.getCatalog.mockReturnValueOnce(new Promise(next => { resolve = next }))
    const pending = useCatalogStore.getState().load()

    useCatalogStore.getState().clear()
    resolve(page(DEFAULT_CATALOG_QUERY))
    await pending

    expect(useCatalogStore.getState()).toMatchObject({
      result: null, loading: false, hasLoaded: false,
    })
  })
})
