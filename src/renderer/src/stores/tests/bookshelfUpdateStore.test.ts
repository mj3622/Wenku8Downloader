import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookshelfPage } from '../../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getBookshelf: vi.fn(),
}))

vi.mock('../../api/client', () => ({ api: mocks }))

import { useBookshelfUpdateStore } from '../bookshelfUpdateStore'
import { useToastStore } from '../toastStore'

const PAGE: BookshelfPage = {
  entries: [{
    bookId: '101',
    title: '星海图书馆',
    author: '林间笔记',
    latestChapter: '第十二章',
    bookmark: null,
    updatedAt: '2026-08-30',
    localState: 'update',
    updateAvailable: true,
  }],
  fetchedAt: 1,
  stale: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  useBookshelfUpdateStore.getState().clear()
  useToastStore.getState().clear()
  mocks.getConfig.mockResolvedValue({ account: { hasCookies: true } })
  mocks.getBookshelf.mockResolvedValue(PAGE)
})

describe('bookshelfUpdateStore', () => {
  it('silently skips remote checks when there is no authenticated session', async () => {
    useBookshelfUpdateStore.getState().syncPage(PAGE)
    mocks.getConfig.mockResolvedValue({ account: { hasCookies: false } })

    await useBookshelfUpdateStore.getState().check()

    expect(mocks.getBookshelf).not.toHaveBeenCalled()
    expect(useBookshelfUpdateStore.getState()).toMatchObject({
      updateCount: 0,
      checking: false,
    })
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('counts updates and announces each remote version only once per session', async () => {
    await useBookshelfUpdateStore.getState().check()
    await useBookshelfUpdateStore.getState().check()

    expect(useBookshelfUpdateStore.getState().updateCount).toBe(1)
    expect(mocks.getBookshelf).toHaveBeenCalledTimes(2)
    expect(useToastStore.getState().items).toEqual([
      expect.objectContaining({
        tone: 'info',
        title: '书架发现更新',
        action: { label: '查看书架', href: '#/bookshelf' },
      }),
    ])
  })

  it('keeps a stale update indicator without announcing cached content', async () => {
    mocks.getBookshelf.mockResolvedValue({ ...PAGE, stale: true })

    await useBookshelfUpdateStore.getState().check()

    expect(useBookshelfUpdateStore.getState().updateCount).toBe(1)
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('keeps the last known indicator when an automatic check fails', async () => {
    useBookshelfUpdateStore.getState().syncPage(PAGE)
    mocks.getConfig.mockRejectedValue(new Error('offline'))

    await useBookshelfUpdateStore.getState().check()

    expect(useBookshelfUpdateStore.getState()).toMatchObject({
      updateCount: 1,
      checking: false,
    })
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('ignores an in-flight result after login state clears the indicator', async () => {
    let resolveConfig!: (value: { account: { hasCookies: boolean } }) => void
    mocks.getConfig.mockReturnValue(new Promise(resolve => { resolveConfig = resolve }))
    const check = useBookshelfUpdateStore.getState().check()
    useBookshelfUpdateStore.getState().clear()
    resolveConfig({ account: { hasCookies: true } })

    await check

    expect(mocks.getBookshelf).not.toHaveBeenCalled()
    expect(useBookshelfUpdateStore.getState()).toMatchObject({
      updateCount: 0,
      checking: false,
    })
  })
})
