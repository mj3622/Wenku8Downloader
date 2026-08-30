import { describe, expect, it, vi } from 'vitest'
import { SearchCooldownError } from '../crawler'
import { SearchService } from '../search-service'

const result = {
  id: '3057',
  title: '败北女角太多了！',
  cover: 'cover.jpg',
  author: '雨森焚火',
  status: '连载中',
  updateTime: '2026-07-19',
  wordCount: '1271K',
  isAnimated: true,
  tags: '校园 青春',
  desc: '测试简介',
}

describe('SearchService', () => {
  it('normalizes and caches the same search query in memory', async () => {
    let now = 1_000
    const source = { search: vi.fn(async () => [result]) }
    const service = new SearchService(source, { now: () => now })

    const first = await service.search('title', ' 败犬 ')
    now += 1_000
    const second = await service.search('title', '败犬')

    expect(source.search).toHaveBeenCalledTimes(1)
    expect(source.search).toHaveBeenCalledWith('败犬', 'title')
    expect(first).toEqual({
      status: 'ok',
      results: [result],
      fetchedAt: 1_000,
      cached: false,
    })
    expect(second).toEqual({
      status: 'ok',
      results: [result],
      fetchedAt: 1_000,
      cached: true,
    })
    expect(second).not.toBe(first)
    if (second.status === 'ok') expect(second.results[0]).not.toBe(result)
  })

  it('deduplicates simultaneous requests for the same query', async () => {
    let resolveSearch!: (results: typeof result[]) => void
    const source = {
      search: vi.fn(() => new Promise<typeof result[]>((resolve) => { resolveSearch = resolve })),
    }
    const service = new SearchService(source)

    const first = service.search('author', '雨森焚火')
    const second = service.search('author', '雨森焚火')
    resolveSearch([result])

    await expect(first).resolves.toMatchObject({ status: 'ok', cached: false })
    await expect(second).resolves.toMatchObject({ status: 'ok', cached: false })
    expect(source.search).toHaveBeenCalledTimes(1)
  })

  it('returns a shared cooldown without issuing more source searches', async () => {
    let now = 5_000
    const source = {
      search: vi.fn(async () => {
        throw new SearchCooldownError(12_000)
      }),
    }
    const service = new SearchService(source, { now: () => now })

    await expect(service.search('title', '测试')).resolves.toEqual({
      status: 'cooldown',
      retryAt: 17_000,
    })
    now += 2_000
    await expect(service.search('author', '作者')).resolves.toEqual({
      status: 'cooldown',
      retryAt: 17_000,
    })
    expect(source.search).toHaveBeenCalledTimes(1)
  })

  it('expires old entries and evicts the least recently used query', async () => {
    let now = 0
    const source = { search: vi.fn(async (query: string) => [{ ...result, title: query }]) }
    const service = new SearchService(source, {
      now: () => now,
      cacheTtlMs: 100,
      maxEntries: 2,
    })

    await service.search('title', 'A')
    now += 10
    await service.search('title', 'B')
    now += 10
    await service.search('title', 'A')
    now += 10
    await service.search('title', 'C')
    now += 10
    await service.search('title', 'B')
    now += 200
    await service.search('title', 'A')

    expect(source.search.mock.calls.map(([query]) => query)).toEqual(['A', 'B', 'C', 'B', 'A'])
  })

  it('does not restore a cleared cache or delete a newer in-flight request', async () => {
    const resolvers: Array<(results: typeof result[]) => void> = []
    const source = {
      search: vi.fn(() => new Promise<typeof result[]>((resolve) => { resolvers.push(resolve) })),
    }
    const service = new SearchService(source)

    const oldRequest = service.search('title', '测试')
    service.clearMemory()
    const newRequest = service.search('title', '测试')
    resolvers[0]([{ ...result, title: '旧结果' }])
    await oldRequest
    const joinedNewRequest = service.search('title', '测试')

    expect(source.search).toHaveBeenCalledTimes(2)
    resolvers[1]([{ ...result, title: '新结果' }])
    await expect(newRequest).resolves.toMatchObject({
      status: 'ok',
      results: [expect.objectContaining({ title: '新结果' })],
    })
    await expect(joinedNewRequest).resolves.toMatchObject({
      status: 'ok',
      results: [expect.objectContaining({ title: '新结果' })],
    })

    await expect(service.search('title', '测试')).resolves.toMatchObject({
      status: 'ok',
      cached: true,
      results: [expect.objectContaining({ title: '新结果' })],
    })
    expect(source.search).toHaveBeenCalledTimes(2)
  })
})
