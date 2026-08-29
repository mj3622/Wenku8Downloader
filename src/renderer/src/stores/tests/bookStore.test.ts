import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getBook: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import { useBookStore } from '../bookStore'
import { useToastStore } from '../toastStore'

beforeEach(() => {
  vi.clearAllMocks()
  useBookStore.setState({ book: null, loading: false, error: null })
  useToastStore.getState().clear()
})

describe('bookStore', () => {
  it('does not call the API for a missing or malformed work identifier', async () => {
    await useBookStore.getState().fetchBook('1234567890123')

    expect(mocks.getBook).not.toHaveBeenCalled()
    expect(useBookStore.getState()).toMatchObject({
      loading: false,
      error: '作品编号无效，请返回搜索页重新输入。',
    })
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '无法打开作品',
    })
  })

  it('does not expose remote details when loading a work fails', async () => {
    mocks.getBook.mockRejectedValue(
      new Error("Error invoking remote method 'book:get': Error: HTTP 403 Cookie expired"),
    )

    await useBookStore.getState().fetchBook('3057')

    expect(useBookStore.getState().error).toBe('请前往配置页重新登录，然后再试一次。')
    expect(useToastStore.getState().items[0]?.title).toBe('登录状态已失效')
  })

  it('forwards an explicit revalidation request', async () => {
    mocks.getBook.mockResolvedValue({ book_id: '3057', basic_info: {}, volumes: {} })

    await useBookStore.getState().fetchBook('3057', { revalidate: true })

    expect(mocks.getBook).toHaveBeenCalledWith('3057', { revalidate: true })
  })

  it('keeps the newest work when an older request finishes later', async () => {
    let resolveFirst!: (value: { book_id: string; basic_info: Record<string, string>; volumes: Record<string, never[]> }) => void
    let resolveSecond!: (value: { book_id: string; basic_info: Record<string, string>; volumes: Record<string, never[]> }) => void
    mocks.getBook
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve }))

    const first = useBookStore.getState().fetchBook('100')
    const second = useBookStore.getState().fetchBook('200')
    resolveSecond({ book_id: '200', basic_info: { 标题: '新作品' }, volumes: {} })
    await second
    resolveFirst({ book_id: '100', basic_info: { 标题: '旧作品' }, volumes: {} })
    await first

    expect(useBookStore.getState()).toMatchObject({
      loading: false,
      book: { book_id: '200', basic_info: { 标题: '新作品' } },
    })
  })

  it('does not restore a work after navigation clears a pending request', async () => {
    let resolveBook!: (value: { book_id: string; basic_info: Record<string, string>; volumes: Record<string, never[]> }) => void
    mocks.getBook.mockReturnValueOnce(new Promise((resolve) => { resolveBook = resolve }))

    const request = useBookStore.getState().fetchBook('3057')
    useBookStore.getState().clear()
    resolveBook({ book_id: '3057', basic_info: { 标题: '过期作品' }, volumes: {} })
    await request

    expect(useBookStore.getState()).toMatchObject({ book: null, loading: false, error: null })
  })
})
