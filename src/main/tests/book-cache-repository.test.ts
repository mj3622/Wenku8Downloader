import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as cheerio from 'cheerio'
import { BookCacheRepository } from '../book-cache-repository'
import { createBookVersion, type BookSnapshot } from '../book-cache-model'
import { Book } from '../book'
import type { WebCrawler } from '../crawler'
import { GIB } from '../cache/cache-policy'
import { CacheStore } from '../cache/cache-store'

const roots: string[] = []
const KEY = 'a'.repeat(64)

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-book-repository-'))
  roots.push(root)
  const store = new CacheStore(root, {
    statDisk: async () => ({ totalBytes: 100 * GIB, freeBytes: 50 * GIB }),
  })
  await store.initialize()
  return { cache: new BookCacheRepository(store), store }
}

function snapshot(): BookSnapshot {
  const version = createBookVersion({
    updatedAt: '2026-08-29', latestChapter: '第一章', status: '连载',
  }, 1_000)
  return {
    schemaVersion: 1,
    bookId: '123',
    checkedAt: 1_000,
    version,
    legacyImportGenerationKey: version.generationKey,
    baseChapterUrl: 'https://www.wenku8.net/novel/1/2/',
    volumes: { 第一卷: [{ name: '第一章', link: '1.htm' }] },
    basicInfo: {
      '标题': '作品', '作者': '作者', '出版社': '文库', '最新章节': '第一章',
      '连载状态': '连载', '更新时间': '2026-08-29', '全文长度': '1',
      '简介': '简介', 'cover': 'https://img.example/cover.jpg',
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('BookCacheRepository', () => {
  it('persists and validates snapshots', async () => {
    const { cache } = await repository()
    const value = snapshot()
    await expect(cache.saveSnapshot(value, cache.captureWriteGuard())).resolves.toBe(true)
    await expect(cache.loadSnapshot('123')).resolves.toEqual(value)
  })

  it('uses a normalized URL as the illustration identity', async () => {
    const { cache } = await repository()
    await cache.saveIllustration(
      '123',
      KEY,
      'HTTPS://EXAMPLE.COM:443/a/../b.htm#fragment',
      ['https://img.example/1.jpg'],
      cache.captureResourceWriteGuard('123', KEY),
    )
    await expect(cache.loadIllustration('123', KEY, 'https://example.com/b.htm'))
      .resolves.toEqual(['https://img.example/1.jpg'])
  })

  it('distinguishes a cached empty illustration page from a miss', async () => {
    const { cache } = await repository()
    await expect(cache.loadIllustration('123', KEY, 'https://example.com/empty.htm'))
      .resolves.toBeUndefined()
    await cache.saveIllustration(
      '123', KEY, 'https://example.com/empty.htm', null,
      cache.captureResourceWriteGuard('123', KEY),
    )
    await expect(cache.loadIllustration('123', KEY, 'https://example.com/empty.htm'))
      .resolves.toBeNull()
  })

  it('does not persist invalid URLs or zero-byte covers', async () => {
    const { cache } = await repository()
    await expect(cache.saveCover(
      '123', KEY, 'javascript:alert(1)', Buffer.from('x'),
      cache.captureResourceWriteGuard('123', KEY),
    )).resolves.toBe(false)
    await expect(cache.saveCover(
      '123', KEY, 'https://img.example/cover.jpg', Buffer.alloc(0),
      cache.captureResourceWriteGuard('123', KEY),
    )).resolves.toBe(false)
  })

  it('rejects a structurally valid snapshot stored under another book ID', async () => {
    const { cache, store } = await repository()
    const misplaced = { ...snapshot(), bookId: '456' }
    await store.writeJson(
      { kind: 'snapshot', bookId: '123', sourceKey: 'current' },
      misplaced,
      store.captureWriteGuard(),
    )

    await expect(cache.loadSnapshot('123')).resolves.toBeNull()
  })

  it('does not recreate a retired generation when an illustration request finishes late', async () => {
    const { cache } = await repository()
    const value = snapshot()
    value.volumes = { 第一卷: [{ name: '插图', link: 'illustrations.htm' }] }
    let resolvePage!: (value: ReturnType<typeof cheerio.load>) => void
    const fetch = vi.fn(() => new Promise(resolve => {
      resolvePage = resolve
    }))
    const book = Book.fromSnapshot(value, { fetch } as unknown as WebCrawler, undefined, cache)
    const request = book.getChapterImageUrls('第一卷')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const nextVersion = createBookVersion({
      updatedAt: '2026-09-01', latestChapter: '第二章', status: '连载',
    }, 2_000)

    await cache.removeOtherGenerations('123', nextVersion.generationKey)
    resolvePage(cheerio.load('<img src="https://img.example/late.jpg">'))

    await expect(request).resolves.toEqual(['https://img.example/late.jpg'])
    await expect(cache.loadIllustration(
      '123',
      value.version.generationKey,
      'https://www.wenku8.net/novel/1/2/illustrations.htm',
    )).resolves.toBeUndefined()
  })
})
