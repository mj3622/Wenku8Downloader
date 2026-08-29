import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDiscoveryHome: vi.fn(),
  getRanking: vi.fn(),
}))

vi.mock('../../api/client', () => ({ api: mocks }))

import {
  DISCOVERY_FRESH_MS,
  type DiscoveryHome,
  type RankingPage,
} from '../../../../shared/ipc-types'
import { useDiscoveryStore } from '../discoveryStore'
import { useToastStore } from '../toastStore'

const NOW = 10 * 60 * 60 * 1000
let now = NOW

const home: DiscoveryHome = {
  sections: [{
    key: 'daily-hot',
    title: '今日热榜',
    moreRanking: 'dayvisit',
    books: [{ id: '1', title: '作品一', cover: 'https://example.com/1.jpg', rank: 1 }],
  }],
  fetchedAt: NOW,
  stale: false,
}

const ranking: RankingPage = {
  type: 'allvisit',
  title: '总排行榜',
  page: 1,
  totalPages: 3,
  books: [{ id: '1', title: '作品一', cover: 'https://example.com/1.jpg', rank: 1 }],
  fetchedAt: NOW,
  stale: false,
}

beforeEach(() => {
  now = NOW
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.clearAllMocks()
  useDiscoveryStore.getState().clear()
  useToastStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discoveryStore', () => {
  it('loads the discovery home once and reuses renderer state', async () => {
    mocks.getDiscoveryHome.mockResolvedValue(home)

    await useDiscoveryStore.getState().loadHome()
    await useDiscoveryStore.getState().loadHome()

    expect(mocks.getDiscoveryHome).toHaveBeenCalledTimes(1)
    expect(useDiscoveryStore.getState()).toMatchObject({
      home,
      homeLoading: false,
      homeRefreshing: false,
      homeError: null,
    })
  })

  it('revalidates home and ranking data after the 30-minute fresh window', async () => {
    const refreshedHome = { ...home, fetchedAt: NOW + DISCOVERY_FRESH_MS + 1 }
    const refreshedRanking = { ...ranking, fetchedAt: NOW + DISCOVERY_FRESH_MS + 1 }
    mocks.getDiscoveryHome
      .mockResolvedValueOnce(home)
      .mockResolvedValueOnce(refreshedHome)
    mocks.getRanking
      .mockResolvedValueOnce(ranking)
      .mockResolvedValueOnce(refreshedRanking)

    await useDiscoveryStore.getState().loadHome()
    await useDiscoveryStore.getState().loadRanking('allvisit', 1)
    now = NOW + DISCOVERY_FRESH_MS + 1
    await useDiscoveryStore.getState().loadHome()
    await useDiscoveryStore.getState().loadRanking('allvisit', 1)

    expect(mocks.getDiscoveryHome).toHaveBeenCalledTimes(2)
    expect(mocks.getRanking).toHaveBeenCalledTimes(2)
    expect(useDiscoveryStore.getState().home).toEqual(refreshedHome)
    expect(useDiscoveryStore.getState().rankings['allvisit:1']?.data).toEqual(refreshedRanking)
  })

  it('keeps the newest home response when a refresh finishes first', async () => {
    let resolveInitial!: (value: DiscoveryHome) => void
    mocks.getDiscoveryHome
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve }))
      .mockResolvedValueOnce({ ...home, fetchedAt: 2 })

    const initial = useDiscoveryStore.getState().loadHome()
    const refresh = useDiscoveryStore.getState().loadHome(true)
    await refresh
    resolveInitial(home)
    await initial

    expect(useDiscoveryStore.getState().home?.fetchedAt).toBe(2)
  })

  it('warns when the main process falls back to stale cached content', async () => {
    mocks.getDiscoveryHome.mockResolvedValue({ ...home, stale: true })

    await useDiscoveryStore.getState().loadHome()

    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '正在使用缓存',
    })
  })

  it('caches ranking pages separately and reports a safe error', async () => {
    mocks.getRanking.mockResolvedValueOnce(ranking)
    await useDiscoveryStore.getState().loadRanking('allvisit', 1)
    await useDiscoveryStore.getState().loadRanking('allvisit', 1)

    mocks.getRanking.mockRejectedValueOnce(new Error('private upstream error'))
    await useDiscoveryStore.getState().loadRanking('allvisit', 2)

    expect(mocks.getRanking).toHaveBeenCalledTimes(2)
    expect(useDiscoveryStore.getState().rankings['allvisit:1']?.data).toEqual(ranking)
    expect(useDiscoveryStore.getState().rankings['allvisit:2']).toMatchObject({
      data: null,
      loading: false,
      error: '暂时无法读取推荐和排行榜，请检查网络后重试。',
    })
    expect(JSON.stringify(useDiscoveryStore.getState())).not.toContain('private upstream error')
  })
})
