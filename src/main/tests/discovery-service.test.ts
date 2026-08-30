import { describe, expect, it, vi } from 'vitest'
import type {
  AnnualRankingPage,
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

function annualRanking(fetchedAt: number): AnnualRankingPage {
  return {
    year: 2026,
    categories: {
      bunko: [{ rank: 1, title: '测试文库作品', bookId: '3057' }],
      tankobon: [{ rank: 1, title: '测试单行本作品' }],
    },
    fetchedAt,
    stale: false,
  }
}

function createHarness(options: {
  now?: number
  homeCache?: DiscoveryHome | null
  rankingCache?: RankingPage | null
  annualCache?: AnnualRankingPage | null
} = {}) {
  let now = options.now ?? 10 * MINUTE
  let homeCache = options.homeCache ?? null
  let rankingCache = options.rankingCache ?? null
  let annualCache = options.annualCache ?? null
  const source = {
    fetchHome: vi.fn(async () => sections),
    fetchRanking: vi.fn(async (type: RankingType, page: number) => ({
      type, title: '总排行榜', page, totalPages: 2, books: sections[0].books,
    })),
    fetchAnnualRanking: vi.fn(async (year: number) => ({
      year,
      categories: annualRanking(0).categories,
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
    loadAnnualRanking: vi.fn(async () => annualCache),
    saveAnnualRanking: vi.fn(async (value: AnnualRankingPage) => {
      annualCache = value
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

  it('uses the interactive source only for explicit refreshes', async () => {
    const harness = createHarness({ now: 31 * MINUTE, homeCache: cachedHome(0) })
    const refreshSource = {
      fetchHome: vi.fn(async () => sections),
      fetchRanking: vi.fn(async (type: RankingType, page: number) => ({
        type, title: '总排行榜', page, totalPages: 2, books: sections[0].books,
      })),
      fetchAnnualRanking: vi.fn(async (year: number) => ({
        year,
        categories: annualRanking(0).categories,
      })),
    }
    const service = new DiscoveryService({
      source: harness.source,
      refreshSource,
      cache: harness.cache,
      now: () => 31 * MINUTE,
    })

    await service.getHome()
    await service.getRanking('allvisit', 1, { refresh: true })

    expect(harness.source.fetchHome).toHaveBeenCalledTimes(1)
    expect(refreshSource.fetchHome).not.toHaveBeenCalled()
    expect(refreshSource.fetchRanking).toHaveBeenCalledWith('allvisit', 1)
  })

  it('keeps annual rankings fresh for 24 hours and falls back for up to 30 days', async () => {
    const fresh = createHarness({ now: 24 * 60 * MINUTE, annualCache: annualRanking(0) })
    await fresh.service.getAnnualRanking(2026)
    expect(fresh.source.fetchAnnualRanking).not.toHaveBeenCalled()

    const stale = createHarness({ now: 25 * 60 * MINUTE, annualCache: annualRanking(0) })
    stale.source.fetchAnnualRanking.mockRejectedValueOnce(new Error('offline'))
    await expect(stale.service.getAnnualRanking(2026)).resolves.toMatchObject({ stale: true })

    const expired = createHarness({ now: 30 * 24 * 60 * MINUTE + 1, annualCache: annualRanking(0) })
    expired.source.fetchAnnualRanking.mockRejectedValueOnce(new Error('offline'))
    await expect(expired.service.getAnnualRanking(2026)).rejects.toThrow('offline')
  })

  it('clears process memory so a later read consults persistent cache again', async () => {
    const harness = createHarness({ now: 10 * MINUTE, homeCache: cachedHome(0) })
    await harness.service.getHome()
    harness.service.clearMemory()
    await harness.service.getHome()

    expect(harness.cache.loadHome).toHaveBeenCalledTimes(2)
  })
})
