import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAnnualRanking: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import { useAnnualRankingStore } from '../annualRankingStore'
import { useToastStore } from '../toastStore'

function page(overrides = {}) {
  return {
    year: 2026,
    categories: { bunko: [{ rank: 1, title: '作品甲' }], tankobon: [] },
    fetchedAt: Date.now(),
    stale: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAnnualRankingStore.getState().clear()
  useToastStore.getState().clear()
})

describe('annualRankingStore', () => {
  it('deduplicates fresh and in-flight reads for the same year', async () => {
    let resolveRequest!: (value: ReturnType<typeof page>) => void
    mocks.getAnnualRanking.mockReturnValueOnce(new Promise(resolve => {
      resolveRequest = resolve
    }))
    const first = useAnnualRankingStore.getState().load(2026)
    const second = useAnnualRankingStore.getState().load(2026)
    expect(mocks.getAnnualRanking).toHaveBeenCalledOnce()
    resolveRequest(page())
    await Promise.all([first, second])
    await useAnnualRankingStore.getState().load(2026)
    expect(mocks.getAnnualRanking).toHaveBeenCalledOnce()
  })

  it('shows stale feedback and keeps errors isolated by year', async () => {
    mocks.getAnnualRanking.mockResolvedValueOnce(page({ stale: true }))
    await useAnnualRankingStore.getState().load(2026)
    expect(useToastStore.getState().items[0]).toMatchObject({ tone: 'warning' })

    mocks.getAnnualRanking.mockRejectedValueOnce(new Error('年度榜单失败'))
    await useAnnualRankingStore.getState().load(2025, true)
    expect(useAnnualRankingStore.getState().entries[2025]).toMatchObject({
      data: null,
      loading: false,
      refreshing: false,
      error: '年度榜单失败',
    })
    expect(useAnnualRankingStore.getState().entries[2026].data).not.toBeNull()
  })

  it('ignores a response after the store is cleared', async () => {
    let resolveRequest!: (value: ReturnType<typeof page>) => void
    mocks.getAnnualRanking.mockReturnValueOnce(new Promise(resolve => {
      resolveRequest = resolve
    }))
    const request = useAnnualRankingStore.getState().load(2026)
    useAnnualRankingStore.getState().clear()
    resolveRequest(page())
    await request
    expect(useAnnualRankingStore.getState().entries).toEqual({})
  })
})
