import { describe, expect, it, vi } from 'vitest'
import {
  catalogQueryKey,
  type CatalogPage,
  type CatalogQuery,
} from '../../shared/ipc-types'
import { CatalogCacheRepository } from '../catalog-cache-repository'
import type {
  CacheStore,
  CacheWriteGuard,
  SharedCacheAddress,
} from '../cache/cache-store'

const catalogQuery: CatalogQuery = {
  publisher: '10',
  initial: 'A',
  status: 'completed',
  animation: 'all',
  sort: 'lastupdate',
  page: 2,
}

function page(): CatalogPage {
  return {
    query: catalogQuery,
    books: [{
      id: '3057',
      title: '败北女角太多了！',
      cover: 'https://img.wenku8.com/3057.jpg',
      author: '雨森焚火',
      publisher: '小学馆',
      status: '连载中',
      updateTime: '2026-07-19',
      wordCount: '1271K',
      isAnimated: true,
      tags: '校园 青春',
      desc: '简介',
    }],
    page: 2,
    totalPages: 10,
    fetchedAt: 2_000,
    stale: false,
  }
}

function createStore(initial?: unknown) {
  let value = initial
  const store = {
    captureWriteGuard: vi.fn((): CacheWriteGuard => ({ epoch: 0 })),
    readSharedJson: vi.fn(async <T>(
      _address: SharedCacheAddress,
      parse: (input: unknown) => T | null,
    ) => parse(value)),
    writeSharedJson: vi.fn(async (
      _address: SharedCacheAddress,
      next: unknown,
    ) => {
      value = next
      return true
    }),
  } as unknown as Pick<CacheStore, 'captureWriteGuard' | 'readSharedJson' | 'writeSharedJson'>
  return { store, read: () => value }
}

describe('CatalogCacheRepository', () => {
  it('round trips catalog pages through a stable shared-cache key', async () => {
    const fake = createStore()
    const repository = new CatalogCacheRepository(fake.store)
    const guard = repository.captureWriteGuard()

    await expect(repository.save(page(), guard)).resolves.toBe(true)
    await expect(repository.load({ ...catalogQuery })).resolves.toEqual(page())
    expect(fake.store.writeSharedJson).toHaveBeenCalledWith(
      { namespace: 'catalog', sourceKey: catalogQueryKey(catalogQuery) },
      expect.objectContaining({ schemaVersion: 1 }),
      guard,
    )
  })

  it('rejects malformed, mismatched, and unsafe cached values', async () => {
    const malformed = { schemaVersion: 1, value: { ...page(), fetchedAt: 'now' } }
    const repository = new CatalogCacheRepository(createStore(malformed).store)
    await expect(repository.load(catalogQuery)).resolves.toBeNull()

    const wrongQuery = {
      schemaVersion: 1,
      value: { ...page(), query: { ...catalogQuery, page: 3 }, page: 3 },
    }
    await expect(new CatalogCacheRepository(createStore(wrongQuery).store).load(catalogQuery))
      .resolves.toBeNull()

    const unsafeCover = {
      schemaVersion: 1,
      value: {
        ...page(),
        books: [{ ...page().books[0], cover: 'https://evil.example/cover.jpg' }],
      },
    }
    await expect(new CatalogCacheRepository(createStore(unsafeCover).store).load(catalogQuery))
      .resolves.toBeNull()
  })
})
