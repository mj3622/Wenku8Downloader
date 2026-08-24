import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  searchAuthor: vi.fn(),
  searchTitle: vi.fn(),
}))

vi.mock('../../api/client', () => ({ api: mocks }))

import { useSearchStore } from '../searchStore'
import { useToastStore } from '../toastStore'

beforeEach(() => {
  vi.clearAllMocks()
  useSearchStore.setState({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
    lastQuery: null,
  })
  useToastStore.getState().clear()
})

describe('searchStore', () => {
  it('stops loading and warns when an unsupported runtime search type reaches the store', async () => {
    const search = useSearchStore.getState().search as (type: string, query: string) => Promise<void>

    await search('id', '3057')

    expect(useSearchStore.getState()).toMatchObject({ loading: false, hasSearched: false })
    expect(mocks.searchAuthor).not.toHaveBeenCalled()
    expect(mocks.searchTitle).not.toHaveBeenCalled()
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '搜索方式不可用',
    })
  })

  it('stores safe text and displays a toast when search fails', async () => {
    mocks.searchTitle.mockRejectedValue(
      new Error("Error invoking remote method 'search:title': Error: HTTP 403 Cookie expired"),
    )

    await useSearchStore.getState().search('title', '测试')

    expect(useSearchStore.getState()).toMatchObject({
      loading: false,
      error: '请前往配置页重新登录，然后再试一次。',
      hasSearched: true,
    })
    expect(JSON.stringify(useSearchStore.getState())).not.toContain('HTTP 403')
    expect(useToastStore.getState().items[0]?.title).toBe('登录状态已失效')
  })

  it('keeps the newest search result when an older request finishes later', async () => {
    let resolveFirst!: (value: { results: Array<{ id: string; title: string; cover: string }> }) => void
    let resolveSecond!: (value: { results: Array<{ id: string; title: string; cover: string }> }) => void
    mocks.searchTitle
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve }))

    const first = useSearchStore.getState().search('title', '旧查询')
    const second = useSearchStore.getState().search('title', '新查询')
    resolveSecond({ results: [{ id: '2', title: '新结果', cover: '' }] })
    await second
    resolveFirst({ results: [{ id: '1', title: '旧结果', cover: '' }] })
    await first

    expect(useSearchStore.getState()).toMatchObject({
      loading: false,
      lastQuery: '新查询',
      results: [{ id: '2', title: '新结果', cover: '' }],
    })
  })

  it('does not restore results after the user clears a pending search', async () => {
    let resolveSearch!: (value: { results: Array<{ id: string; title: string; cover: string }> }) => void
    mocks.searchTitle.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve }))

    const request = useSearchStore.getState().search('title', '即将清除')
    useSearchStore.getState().clear()
    resolveSearch({ results: [{ id: '1', title: '过期结果', cover: '' }] })
    await request

    expect(useSearchStore.getState()).toMatchObject({
      results: [],
      loading: false,
      error: null,
      hasSearched: false,
      lastQuery: null,
    })
  })
})
