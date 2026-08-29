import { describe, expect, it, vi } from 'vitest'
import type {
  DiscoveryHome,
  DiscoverySection,
  RankingPage,
  RankingType,
} from '../../shared/ipc-types'
import { DiscoveryService } from '../discovery-service'
import type { CacheWriteGuard } from '../cache/cache-store'

const MINUTE = 60_000

const sections: DiscoverySection[] = [{
  key: 'daily-hot',
  title: '今日热榜',
  moreRanking: 'dayvisit',
  books: [{ id: '3057', title: '败北女角太多了！', cover: 'https://img.wenku8.com/3057.jpg', rank: 1 }],
}]

function cachedHome(fetchedAt: number): DiscoveryHome {
  return { sections, fetchedAt, stale: false }
}

function ranking(fetchedAt: number): RankingPage {
  return {
    type: 'allvisit', title: '总排行榜', page: 1, totalPages: 2,
    books: sections[0].books, fetchedAt, stale: false,
  }
}

function createHarness(options: {
  now?: number
  homeCache?: DiscoveryHome | null
  rankingCache?: RankingPage | null
} = {}) {
  let now = options.now ?? 10 * MINUTE
  let homeCache = options.homeCache ?? null
  let rankingCache = options.rankingCache ?? null
  const source = {
    fetchHome: vi.fn(async () => sections),
    fetchRanking: vi.fn(async (type: RankingType, page: number) => ({
      type, title: '总排行榜', page, totalPages: 2, books: sections[0].books,
    })),
  }
  const cache = {
    captureWriteGuard: vi.fn((): CacheWriteGuard => ({ epoch: 0 })),
    loadHome: vi.fn(async () => homeCache),
    saveHome: vi.fn(async (value: DiscoveryHome) => {
      homeCache = value
      return true
    }),
    loadRanking: vi.fn(async () => rankingCache),
    saveRanking: vi.fn(async (value: RankingPage) => {
      rankingCache = value
      return true
    }),
  }
  const service = new DiscoveryService({ source, cache, now: () => now })
  return { service, source, cache, setNow: (value: number) => { now = value } }
}

describe('DiscoveryService', () => {
  it('returns fresh cache without requesting the site', async () => {
    const harness = createHarness({ now: 20 * MINUTE, homeCache: cachedHome(0) })

    await expect(harness.service.getHome()).resolves.toEqual(cachedHome(0))
    expect(harness.source.fetchHome).not.toHaveBeenCalled()
  })

  it('refreshes expired cache and persists the network result', async () => {
    const harness = createHarness({ now: 31 * MINUTE, homeCache: cachedHome(0) })

    await expect(harness.service.getHome()).resolves.toMatchObject({ fetchedAt: 31 * MINUTE, stale: false })
    expect(harness.source.fetchHome).toHaveBeenCalledTimes(1)
    expect(harness.cache.saveHome).toHaveBeenCalledTimes(1)
  })

  it('falls back to cache younger than 24 hours when refresh fails', async () => {
    const harness = createHarness({ now: 60 * MINUTE, homeCache: cachedHome(0) })
    harness.source.fetchHome.mockRejectedValueOnce(new Error('offline'))

    await expect(harness.service.getHome()).resolves.toEqual({
      ...cachedHome(0),
      stale: true,
    })
  })

  it('rejects when network fails and cached data is older than 24 hours', async () => {
    const harness = createHarness({ now: 24 * 60 * MINUTE + 1, homeCache: cachedHome(0) })
    harness.source.fetchHome.mockRejectedValueOnce(new Error('offline'))

    await expect(harness.service.getHome()).rejects.toThrow('offline')
  })

  it('forces refresh and merges concurrent requests for the same ranking page', async () => {
    const harness = createHarness({ now: 10 * MINUTE, rankingCache: ranking(9 * MINUTE) })
    let resolveRequest!: (value: Awaited<ReturnType<typeof harness.source.fetchRanking>>) => void
    harness.source.fetchRanking.mockImplementationOnce(() => new Promise(resolve => {
      resolveRequest = resolve
    }))

    const first = harness.service.getRanking('allvisit', 1, { refresh: true })
    const second = harness.service.getRanking('allvisit', 1, { refresh: true })
    await vi.waitFor(() => expect(harness.source.fetchRanking).toHaveBeenCalledTimes(1))
    resolveRequest({
      type: 'allvisit', title: '总排行榜', page: 1, totalPages: 2, books: sections[0].books,
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ fetchedAt: 10 * MINUTE, stale: false }),
      expect.objectContaining({ fetchedAt: 10 * MINUTE, stale: false }),
    ])
    expect(harness.source.fetchRanking).toHaveBeenCalledTimes(1)
  })

  it('clears process memory so a later read consults persistent cache again', async () => {
    const harness = createHarness({ now: 10 * MINUTE, homeCache: cachedHome(0) })
    await harness.service.getHome()
    harness.service.clearMemory()
    await harness.service.getHome()

    expect(harness.cache.loadHome).toHaveBeenCalledTimes(2)
  })
})
