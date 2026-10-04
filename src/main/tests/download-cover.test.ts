import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DownloadTask } from '../../shared/ipc-types'
import { BookCacheRepository } from '../book-cache-repository'
import { createBookVersion, type BookSnapshot } from '../book-cache-model'
import { CacheStore } from '../cache/cache-store'
import { GIB } from '../cache/cache-policy'
import { loadDownloadCover } from '../download-cover'

const roots: string[] = []
const fields = { updatedAt: '2026-10-04', latestChapter: '第一章', status: '连载' }
const version = createBookVersion(fields, 1_000)
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8GQAAAAASUVORK5CYII=', 'base64')

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000', bookId: '123', title: '作品',
    cover: 'https://img.example/volume.png', type: 'epub_volume', volume: '第一卷',
    status: 'completed', progress: 100, createdAt: 1_000, updatedAt: 2_000,
    completedVersion: fields, artifacts: [], ...overrides,
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-download-cover-'))
  roots.push(root)
  const store = new CacheStore(root, {
    statDisk: async () => ({ totalBytes: 100 * GIB, freeBytes: 50 * GIB }),
  })
  await store.initialize()
  const books = new BookCacheRepository(store)
  const save = (kind: 'image' | 'cover', generationKey = version.generationKey,
    data = image, extension = 'png') => store.writeBinary({
    kind, bookId: '123', generationKey, sourceKey: task().cover!,
  }, { data, extension }, store.captureGenerationWriteGuard('123', generationKey))
  return { store, books, save }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('loadDownloadCover', () => {
  it('reads the completed volume image without consulting the current book or network', async () => {
    const { store, books, save } = await setup()
    await save('image')
    const snapshot = vi.spyOn(books, 'loadSnapshot')
    const result = await loadDownloadCover(task(), store, books)
    expect(result).toBe(`data:image/png;base64,${image.toString('base64')}`)
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('also reads full-book cover cache entries', async () => {
    const { store, books, save } = await setup()
    await save('cover')
    expect(await loadDownloadCover(task({ type: 'epub_full', volume: undefined }), store, books))
      .toBe(`data:image/png;base64,${image.toString('base64')}`)
  })

  it('uses the local snapshot for active and old records without a completed version', async () => {
    const { store, books, save } = await setup()
    const snapshot: BookSnapshot = {
      schemaVersion: 2, bookId: '123', checkedAt: 1_000,
      version, legacyImportGenerationKey: version.generationKey,
      baseChapterUrl: 'https://www.wenku8.net/novel/0/123/', volumes: {},
      basicInfo: {
        标题: '作品', 作者: '作者', 出版社: '', 最新章节: '第一章', 连载状态: '连载',
        更新时间: '2026-10-04', 全文长度: null, 简介: '', cover: task().cover!,
        标签: [], 动画化: false, 热度: null,
      },
    }
    await books.saveSnapshot(snapshot, books.captureWriteGuard())
    await save('image')
    for (const status of ['completed', 'downloading'] as const) {
      expect(await loadDownloadCover(task({ completedVersion: undefined, status }), store, books))
        .toBe(`data:image/png;base64,${image.toString('base64')}`)
    }
  })

  it('does not read another version or another book', async () => {
    const { store, books, save } = await setup()
    await save('image', 'b'.repeat(64))
    expect(await loadDownloadCover(task(), store, books)).toBeNull()
    await save('image')
    expect(await loadDownloadCover(task({ bookId: '456' }), store, books)).toBeNull()
  })

  it('returns a miss for missing tasks, missing cache and unsupported URLs', async () => {
    const { store, books } = await setup()
    for (const value of [undefined, task(), task({ cover: undefined }), task({ cover: 'file:///etc/passwd' })]) {
      expect(await loadDownloadCover(value, store, books)).toBeNull()
    }
  })

  it('rejects unsupported formats and bounds the image returned over IPC', async () => {
    const { store, books, save } = await setup()
    await save('image', version.generationKey, Buffer.from('<svg/>'), 'svg')
    expect(await loadDownloadCover(task(), store, books)).toBeNull()
    await save('image', version.generationKey, Buffer.alloc(10 * 1024 * 1024 + 1))
    expect(await loadDownloadCover(task(), store, books)).toBeNull()
  })

  it('leaves unexpected cache failures to the IPC logging boundary', async () => {
    const { store, books } = await setup()
    vi.spyOn(store, 'readBinary').mockRejectedValue(new Error('cache unavailable'))
    await expect(loadDownloadCover(task(), store, books)).rejects.toThrow('cache unavailable')
  })
})
