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
