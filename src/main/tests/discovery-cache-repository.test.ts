import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryHome, RankingPage } from '../../shared/ipc-types'
import { DiscoveryCacheRepository } from '../discovery-cache-repository'
import type {
  CacheStore,
  CacheWriteGuard,
  SharedCacheAddress,
} from '../cache/cache-store'

function home(): DiscoveryHome {
  return {
    sections: [{
      key: 'daily-hot',
      title: '今日热榜',
      moreRanking: 'dayvisit',
      books: [{ id: '3057', title: '败北女角太多了！', cover: 'https://img.wenku8.com/3057.jpg', rank: 1 }],
    }],
    fetchedAt: 1_000,
    stale: false,
  }
}

function ranking(): RankingPage {
  return {
    type: 'allvisit',
    title: '总排行榜',
    page: 1,
    totalPages: 10,
    books: [{ id: '1973', title: '实力至上主义', cover: 'https://img.wenku8.com/1973.jpg', rank: 1 }],
    fetchedAt: 2_000,
    stale: false,
  }
}

function createStore(initial?: unknown) {
  let value = initial
  return {
    store: {
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
    } as unknown as Pick<
      CacheStore,
      'captureWriteGuard' | 'readSharedJson' | 'writeSharedJson'
    >,
    read: () => value,
  }
}

describe('DiscoveryCacheRepository', () => {
  it('round trips home and ranking entries through shared cache keys', async () => {
    const fake = createStore()
    const repository = new DiscoveryCacheRepository(fake.store)
    const guard = repository.captureWriteGuard()

    await expect(repository.saveHome(home(), guard)).resolves.toBe(true)
    await expect(repository.loadHome()).resolves.toEqual(home())
    expect(fake.store.writeSharedJson).toHaveBeenLastCalledWith(
      { namespace: 'discovery', sourceKey: 'home' },
      expect.objectContaining({ schemaVersion: 1 }),
      guard,
    )

    await expect(repository.saveRanking(ranking(), guard)).resolves.toBe(true)
    await expect(repository.loadRanking('allvisit', 1)).resolves.toEqual(ranking())
    expect(fake.store.writeSharedJson).toHaveBeenLastCalledWith(
      { namespace: 'discovery', sourceKey: 'ranking:allvisit:1' },
      expect.objectContaining({ schemaVersion: 1 }),
      guard,
    )
  })

  it('rejects malformed cached discovery data', async () => {
    const fake = createStore({ schemaVersion: 1, value: { ...home(), fetchedAt: 'now' } })
    const repository = new DiscoveryCacheRepository(fake.store)

    await expect(repository.loadHome()).resolves.toBeNull()
  })
})
