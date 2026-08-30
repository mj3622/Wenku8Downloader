import { describe, expect, it, vi } from 'vitest'
import type { DownloadSnapshot } from '../../shared/ipc-types'
import type { CachedBookshelf } from '../bookshelf-cache-repository'
import {
  BookshelfService,
  type BookshelfCache,
  type BookshelfSource,
} from '../bookshelf-service'

const ENTRY = {
  bookId: '101',
  title: '星海图书馆',
  author: '林间笔记',
  latestChapter: '第十二章',
  bookmark: null,
  updatedAt: '26-08-20',
}

function downloads(tasks: DownloadSnapshot['tasks'] = []): DownloadSnapshot {
  return { revision: 0, tasks, legacyImportCompleted: true }
}

function setup(options: {
  now?: number
  revision?: number
  cached?: CachedBookshelf | null
  source?: BookshelfSource
  refreshSource?: BookshelfSource
  snapshot?: DownloadSnapshot
} = {}) {
  let now = options.now ?? 1_000_000
  let revision = options.revision ?? 1
  const cache: BookshelfCache = {
    captureWriteGuard: vi.fn(() => ({ epoch: 0 })),
    load: vi.fn(async requested => (
      options.cached && options.cached.credentialRevision === requested
        ? structuredClone(options.cached)
        : null
    )),
    save: vi.fn(async () => true),
  }
  const source = options.source ?? { fetchEntries: vi.fn(async () => [ENTRY]) }
  const service = new BookshelfService({
    source,
    refreshSource: options.refreshSource,
    cache,
    getCredentialRevision: () => revision,
    getDownloadSnapshot: () => options.snapshot ?? downloads(),
    now: () => now,
  })
  return {
    service,
    source,
    cache,
    setNow: (value: number) => { now = value },
    setRevision: (value: number) => { revision = value },
  }
}

describe('BookshelfService', () => {
  it('fetches, caches and clones a fresh readonly bookshelf', async () => {
    const { service, source, cache } = setup()

    const first = await service.getPage()
    first.entries[0].title = '已修改'
    const second = await service.getPage()

    expect(first.fetchedAt).toBe(1_000_000)
    expect(second.entries[0].title).toBe('星海图书馆')
    expect(second.stale).toBe(false)
    expect(source.fetchEntries).toHaveBeenCalledTimes(1)
    expect(cache.save).toHaveBeenCalledWith(expect.objectContaining({
      credentialRevision: 1,
      entries: [ENTRY],
    }), { epoch: 0 })
  })

  it('bypasses a fresh cache on manual refresh and uses the refresh source', async () => {
    const cached = { credentialRevision: 1, fetchedAt: 999_999, entries: [ENTRY] }
    const source = { fetchEntries: vi.fn(async () => []) }
    const refreshSource = { fetchEntries: vi.fn(async () => [ENTRY]) }
    const { service } = setup({ cached, source, refreshSource })

    await expect(service.getPage({ refresh: true })).resolves.toMatchObject({ stale: false })
    expect(source.fetchEntries).not.toHaveBeenCalled()
    expect(refreshSource.fetchEntries).toHaveBeenCalledTimes(1)
  })

  it('falls back to the same-revision cache for at most 24 hours', async () => {
    const now = 30 * 60 * 60 * 1_000
    const cached = {
      credentialRevision: 1,
      fetchedAt: now - 23 * 60 * 60 * 1_000,
      entries: [ENTRY],
    }
    const failure = { fetchEntries: vi.fn(async () => { throw new Error('offline') }) }
    const { service } = setup({ now, cached, source: failure })

    await expect(service.getPage()).resolves.toMatchObject({ stale: true, entries: [ENTRY] })

    const expired = setup({
      now,
      cached: { ...cached, fetchedAt: now - 25 * 60 * 60 * 1_000 },
      source: failure,
    })
    await expect(expired.service.getPage()).rejects.toThrow('offline')
  })

  it('never reuses or writes a bookshelf after the credential revision changes', async () => {
    let resolveEntries!: (value: typeof ENTRY[]) => void
    const source = {
      fetchEntries: vi.fn(() => new Promise<typeof ENTRY[]>(resolve => { resolveEntries = resolve })),
    }
    const cached = { credentialRevision: 1, fetchedAt: 1, entries: [ENTRY] }
    const { service, cache, setRevision } = setup({ cached, source })
    const request = service.getPage({ refresh: true })
    await vi.waitFor(() => expect(source.fetchEntries).toHaveBeenCalledTimes(1))
    setRevision(2)
    resolveEntries([ENTRY])

    await expect(request).rejects.toThrow('登录状态已变更')
    expect(cache.save).not.toHaveBeenCalled()
    source.fetchEntries.mockResolvedValueOnce([ENTRY])
    await expect(service.getPage()).resolves.toMatchObject({ stale: false })
    expect(cache.load).toHaveBeenLastCalledWith(2)
  })

  it('marks partial downloads without claiming that the full book is current', async () => {
    const snapshot = downloads([{
      id: 'task-1', bookId: '101', title: '星海图书馆', type: 'epub_volume', volume: '第一卷',
      status: 'completed', progress: 100, createdAt: 1, updatedAt: 2, artifacts: [],
    }])
    const { service } = setup({ snapshot })

    await expect(service.getPage()).resolves.toMatchObject({
      entries: [expect.objectContaining({ localState: 'partial', updateAvailable: false })],
    })
  })
})
