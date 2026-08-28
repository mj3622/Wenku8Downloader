import { describe, expect, it, vi } from 'vitest'
import type { Book } from './book'

const logMocks = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn() }))

vi.mock('./logging/logger', () => ({
  logger: { debug: logMocks.debug, info: logMocks.info, warn: vi.fn(), error: vi.fn() },
}))

import { BookService } from './book-service'

function fakeBook(bookId: string): Book {
  return { bookId } as Book
}

describe('BookService', () => {
  it('deduplicates repeated and in-flight loads for the same book', async () => {
    let resolveLoad: ((book: Book) => void) | undefined
    const loader = vi.fn((_bookId: string) => new Promise<Book>((resolve) => {
      resolveLoad = resolve
    }))
    const service = new BookService(loader)

    const first = service.get('123')
    const second = service.get('123')
    resolveLoad?.(fakeBook('123'))

    await expect(first).resolves.toBe(await second)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(logMocks.debug).toHaveBeenCalledWith(
      'book.cache.hit',
      expect.any(String),
      { bookId: '123' },
    )
  })

  it('lets one waiter cancel without aborting or evicting the shared load', async () => {
    let resolveLoad!: (book: Book) => void
    let sharedSignal!: AbortSignal
    const loader = vi.fn((_bookId: string, signal: AbortSignal) => new Promise<Book>((resolve) => {
      sharedSignal = signal
      resolveLoad = resolve
    }))
    const service = new BookService(loader)
    const controller = new AbortController()

    const cancelledWaiter = service.get('123', controller.signal)
    const sharedWaiter = service.get('123')
    controller.abort()

    await expect(cancelledWaiter).rejects.toThrow('下载已取消')
    expect(sharedSignal.aborted).toBe(false)
    resolveLoad(fakeBook('123'))
    await expect(sharedWaiter).resolves.toEqual(fakeBook('123'))
    await expect(service.get('123')).resolves.toEqual(fakeBook('123'))
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('aborts and evicts an in-flight load after its last waiter cancels', async () => {
    let firstSignal!: AbortSignal
    const loader = vi.fn()
      .mockImplementationOnce((_bookId: string, signal: AbortSignal) => {
        firstSignal = signal
        return new Promise<Book>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('shared load aborted')), { once: true })
        })
      })
      .mockResolvedValueOnce(fakeBook('123'))
    const service = new BookService(loader)
    const controller = new AbortController()

    const waiter = service.get('123', controller.signal)
    controller.abort()

    await expect(waiter).rejects.toThrow('下载已取消')
    expect(firstSignal.aborted).toBe(true)
    await expect(service.get('123')).resolves.toEqual(fakeBook('123'))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not attach a new waiter to an aborted entry before its loader rejects', async () => {
    let rejectFirstLoad!: (error: Error) => void
    const loader = vi.fn()
      .mockImplementationOnce(() => new Promise<Book>((_resolve, reject) => {
        rejectFirstLoad = reject
      }))
      .mockResolvedValueOnce(fakeBook('123'))
    const service = new BookService(loader)
    const controller = new AbortController()

    const cancelledWaiter = service.get('123', controller.signal)
    controller.abort()
    await expect(cancelledWaiter).rejects.toThrow('下载已取消')

    const replacement = service.get('123')
    expect(loader).toHaveBeenCalledTimes(2)
    rejectFirstLoad(new Error('delayed abort rejection'))

    await expect(replacement).resolves.toEqual(fakeBook('123'))
    await expect(service.get('123')).resolves.toEqual(fakeBook('123'))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('broadcasts throttle waits to every active waiter', async () => {
    let resolveLoad!: (book: Book) => void
    let notifyThrottle!: (waitMs: number) => void
    const loader = vi.fn((
      _bookId: string,
      _signal: AbortSignal,
      onThrottleWait: (waitMs: number) => void,
    ) => new Promise<Book>((resolve) => {
      resolveLoad = resolve
      notifyThrottle = onThrottleWait
    }))
    const service = new BookService(loader)
    const firstProgress = vi.fn()
    const secondProgress = vi.fn()

    const first = service.get('123', undefined, firstProgress)
    const second = service.get('123', undefined, secondProgress)
    notifyThrottle(120_000)

    expect(firstProgress).toHaveBeenCalledWith(120_000)
    expect(secondProgress).toHaveBeenCalledWith(120_000)
    resolveLoad(fakeBook('123'))
    await Promise.all([first, second])
  })

  it('logs cache misses and loaded book summaries', async () => {
    const book = {
      bookId: '3057',
      basicInfo: { '标题': '测试作品' },
      volumes: { '第一卷': [] },
    } as unknown as Book
    const service = new BookService(async () => book)

    await service.get('3057')

    expect(logMocks.info).toHaveBeenCalledWith(
      'book.cache.miss',
      expect.any(String),
      { bookId: '3057' },
    )
    expect(logMocks.info).toHaveBeenCalledWith(
      'book.loaded',
      expect.any(String),
      expect.objectContaining({
        bookId: '3057',
        title: '测试作品',
        volumeCount: 1,
        durationMs: expect.any(Number),
      }),
    )
  })

  it('reloads books after the cache expires', async () => {
    let now = 1_000
    const loader = vi.fn(async (bookId: string) => fakeBook(bookId))
    const service = new BookService(loader, 100, () => now)

    await service.get('123')
    now += 101
    await service.get('123')

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('removes expired books while serving later requests', async () => {
    let now = 1_000
    const service = new BookService(async (bookId) => fakeBook(bookId), 100, () => now)

    await service.get('expired')
    now += 101
    await service.get('fresh')

    const cache = (service as unknown as { cache: Map<string, unknown> }).cache
    expect([...cache.keys()]).toEqual(['fresh'])
  })

  it('does not cache rejected loads', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(fakeBook('123'))
    const service = new BookService(loader)

    await expect(service.get('123')).rejects.toThrow('network failed')
    await expect(service.get('123')).resolves.toEqual(fakeBook('123'))
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
