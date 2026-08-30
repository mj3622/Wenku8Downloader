import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getBookshelf: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import { useBookshelfStore } from '../bookshelfStore'
import { useToastStore } from '../toastStore'

const PAGE = {
  entries: [],
  fetchedAt: 100,
  stale: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  useBookshelfStore.getState().clear()
  useToastStore.getState().clear()
})

describe('bookshelfStore', () => {
  it('loads and refreshes the bookshelf through the bounded API', async () => {
    mocks.getBookshelf.mockResolvedValue(PAGE)

    await useBookshelfStore.getState().load(true)

    expect(mocks.getBookshelf).toHaveBeenCalledWith(true)
    expect(useBookshelfStore.getState()).toMatchObject({ page: PAGE, loading: false, error: null })
  })

  it('ignores a completed request after the page is cleared', async () => {
    let resolve!: (value: typeof PAGE) => void
    mocks.getBookshelf.mockReturnValue(new Promise<typeof PAGE>(done => { resolve = done }))
    const request = useBookshelfStore.getState().load()
    useBookshelfStore.getState().clear()
    resolve(PAGE)
    await request

    expect(useBookshelfStore.getState()).toMatchObject({ page: null, loading: false, error: null })
  })

  it('keeps existing content while reporting a refresh failure', async () => {
    mocks.getBookshelf.mockResolvedValueOnce(PAGE)
    await useBookshelfStore.getState().load()
    mocks.getBookshelf.mockRejectedValueOnce(new Error('offline'))

    await useBookshelfStore.getState().load(true)

    expect(useBookshelfStore.getState().page).toEqual(PAGE)
    expect(useBookshelfStore.getState().error).toBeTruthy()
    expect(useToastStore.getState().items).toHaveLength(1)
  })
})
