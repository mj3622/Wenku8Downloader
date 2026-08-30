import { mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '../../book-cache-model'
import { createBookVersion, parseBookSnapshot } from '../../book-cache-model'
import { GIB, UNUSED_MAX_AGE_MS } from '../cache-policy'
import {
  CacheStore,
  type CacheAddress,
  type SharedCacheAddress,
} from '../cache-store'
import { hashCacheKey } from '../cache-key'

const roots: string[] = []
const OLD_VERSION = createBookVersion({
  updatedAt: '2026-08-29', latestChapter: '第一章', status: '连载',
}, 1_000)
const NEW_VERSION = createBookVersion({
  updatedAt: '2026-09-01', latestChapter: '第二章', status: '连载',
}, 2_000)
const OLD_KEY = OLD_VERSION.generationKey
const NEW_KEY = NEW_VERSION.generationKey
const chapter = { title: '第一章', content: '<p>正文</p>' }

function parseChapter(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return typeof data.title === 'string' && typeof data.content === 'string'
    ? { title: data.title, content: data.content }
    : null
}

function snapshot(generationKey = OLD_KEY): BookSnapshot {
  const version = generationKey === NEW_KEY ? NEW_VERSION : OLD_VERSION
  return {
    schemaVersion: 2,
    bookId: '123',
    checkedAt: 1_000,
    version,
    legacyImportGenerationKey: OLD_KEY,
    baseChapterUrl: 'https://www.wenku8.net/novel/1/2/',
    volumes: { 第一卷: [{ name: '第一章', link: '1.htm' }] },
    basicInfo: {
      '标题': '书', '作者': '作者', '出版社': '文库',
      '最新章节': version.fields.latestChapter,
      '连载状态': version.fields.status,
      '更新时间': version.fields.updatedAt,
      '全文长度': '1',
      '简介': '简介', 'cover': null,
      '标签': [], '动画化': false, '热度': null,
    },
  }
}

function snapshotAddress(): CacheAddress {
  return { kind: 'snapshot', bookId: '123', sourceKey: 'current' }
}

function chapterAddress(
  key = OLD_KEY,
  sourceKey = 'https://www.wenku8.net/novel/1/2/1.htm',
): CacheAddress {
  return {
    kind: 'chapter', bookId: '123', generationKey: key,
    sourceKey,
  }
}

function imageAddress(): CacheAddress {
  return {
    kind: 'image',
    bookId: '123',
    generationKey: OLD_KEY,
    sourceKey: 'https://img.example/shared.jpg',
  }
}

function discoveryAddress(sourceKey = 'ranking:allvisit:1'): SharedCacheAddress {
  return { namespace: 'discovery', sourceKey }
}

async function createStore(options: {
  freeBytes?: number
  now?: () => number
  statDisk?: () => Promise<{ totalBytes: number; freeBytes: number }>
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-cache-store-'))
  roots.push(root)
  const store = new CacheStore(root, {
    now: options.now,
    statDisk: options.statDisk ?? (async () => ({
      totalBytes: 100 * GIB,
      freeBytes: options.freeBytes ?? 50 * GIB,
    })),
  })
  await store.initialize()
  return { root, store }
}

function resourceGuard(store: CacheStore, generationKey = OLD_KEY) {
  return store.captureGenerationWriteGuard('123', generationKey)
}

beforeEach(() => roots.splice(0))
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('CacheStore', () => {
  it('writes and reads JSON without exposing source keys in paths', async () => {
    const { root, store } = await createStore()
    await expect(store.writeJson(chapterAddress(), chapter, resourceGuard(store)))
      .resolves.toBe(true)
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
    const serializedPaths = JSON.stringify(await import('fs/promises').then(fs => fs.readdir(root, { recursive: true })))
    expect(serializedPaths).not.toContain('wenku8.net')
  })

  it('writes shared JSON with hashed keys and clears it only during a full clear', async () => {
    const { root, store } = await createStore()
    const address = discoveryAddress()
    await expect(store.writeSharedJson(address, { value: 'cached' }, store.captureWriteGuard()))
      .resolves.toBe(true)
    await expect(store.readSharedJson(address, value => value as { value: string }))
      .resolves.toEqual({ value: 'cached' })
    const paths = JSON.stringify(await import('fs/promises').then(fs => fs.readdir(root, { recursive: true })))
    expect(paths).not.toContain(address.sourceKey)

    await store.clearSnapshots()
    await expect(store.readSharedJson(address, value => value as { value: string }))
      .resolves.toEqual({ value: 'cached' })

    await store.clear()
    await expect(store.readSharedJson(address, value => value as { value: string }))
      .resolves.toBeNull()
  })

  it('removes corrupt and unused shared JSON entries', async () => {
    const now = UNUSED_MAX_AGE_MS + 10_000
    const { root, store } = await createStore({ now: () => now })
    const corrupt = discoveryAddress('corrupt')
    const stale = discoveryAddress('stale')
    await store.writeSharedJson(corrupt, { ok: true }, store.captureWriteGuard())
    await store.writeSharedJson(stale, { ok: true }, store.captureWriteGuard())
    const corruptPath = join(root, 'shared', 'discovery', `${hashCacheKey(corrupt.sourceKey)}.json`)
    const stalePath = join(root, 'shared', 'discovery', `${hashCacheKey(stale.sourceKey)}.json`)
    await writeFile(corruptPath, '{broken')
    await utimes(stalePath, new Date(1), new Date(1))

    await expect(store.readSharedJson(corrupt, value => value)).resolves.toBeNull()
    await store.prune('scheduled')
    await expect(store.readSharedJson(stale, value => value)).resolves.toBeNull()
  })

  it('rejects resource addresses without a generation and zero-byte binaries', async () => {
    const { store } = await createStore()
    await expect(store.writeJson({
      kind: 'chapter', bookId: '123', sourceKey: 'https://example/1',
    }, chapter, store.captureWriteGuard())).resolves.toBe(false)
    await expect(store.writeBinary({
      kind: 'image', bookId: '123', generationKey: OLD_KEY, sourceKey: 'https://img/1.jpg',
    }, { data: Buffer.alloc(0), extension: 'jpg' }, store.captureWriteGuard())).resolves.toBe(false)
  })

  it('rejects a non-active write guard after clear', async () => {
    const { store } = await createStore()
    const guard = store.captureWriteGuard()
    await store.clear()
    await expect(store.writeJson(snapshotAddress(), snapshot(), guard)).resolves.toBe(false)
    await expect(store.readJson(snapshotAddress(), parseBookSnapshot)).resolves.toBeNull()
  })

  it('defers clearing a leased generation until release', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await expect(store.clear()).resolves.toEqual({ deferred: true })
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
    await lease.release()
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('defers an active generation even before its first cache write', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)

    await expect(store.clear()).resolves.toEqual({ deferred: true })
    await expect(store.writeJson(
      chapterAddress(),
      chapter,
      store.captureWriteGuard(lease),
    )).resolves.toBe(true)
    await lease.release()

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('keeps deferred deletion until a replacement lease is also released', async () => {
    const { store } = await createStore()
    const firstLease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(firstLease))
    await store.clear()

    const replacementLeasePromise = store.acquireGeneration('123', OLD_KEY)
    const firstRelease = firstLease.release()
    const replacementLease = await replacementLeasePromise
    await firstRelease

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
    await replacementLease.release()
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('deletes a task generation that becomes known only after clear', async () => {
    const { store } = await createStore()
    const taskGuard = store.captureWriteGuard()
    await store.clear()
    const lease = await store.acquireGeneration('123', OLD_KEY, taskGuard)

    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await lease.release()

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('clears snapshots without deleting assets and invalidates old guards', async () => {
    const { store } = await createStore()
    const snapshotGuard = store.captureWriteGuard()
    const chapterGuard = resourceGuard(store)
    await store.writeJson(snapshotAddress(), snapshot(), snapshotGuard)
    await store.writeJson(chapterAddress(), chapter, chapterGuard)
    await store.clearSnapshots()
    await expect(store.readJson(snapshotAddress(), parseBookSnapshot)).resolves.toBeNull()
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
    await expect(store.writeJson(snapshotAddress(), snapshot(), snapshotGuard)).resolves.toBe(false)
  })

  it('keeps a leased obsolete generation until its lease is released', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await store.writeJson(chapterAddress(NEW_KEY), chapter, resourceGuard(store, NEW_KEY))
    await store.removeOtherGenerations('123', NEW_KEY)
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
    await expect(store.readJson(chapterAddress(NEW_KEY), parseChapter)).resolves.toEqual(chapter)
    await lease.release()
    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('marks an active obsolete generation before it creates a directory', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)

    await store.removeOtherGenerations('123', NEW_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await lease.release()

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('deletes an obsolete generation leased only after the version changes', async () => {
    const { store } = await createStore()
    await store.removeOtherGenerations('123', NEW_KEY)

    const lease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await lease.release()

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('does not let a non-leased stale request recreate a retired generation', async () => {
    const { store } = await createStore()
    const staleGuard = resourceGuard(store, OLD_KEY)
    await store.writeJson(snapshotAddress(), snapshot(NEW_KEY), store.captureWriteGuard())

    await store.removeOtherGenerations('123', NEW_KEY)

    await expect(store.writeJson(chapterAddress(OLD_KEY), chapter, staleGuard)).resolves.toBe(false)
    await expect(store.writeJson(
      chapterAddress(OLD_KEY),
      chapter,
      resourceGuard(store, OLD_KEY),
    )).resolves.toBe(false)
  })

  it('rejects a stale generation first seen after the current version changes', async () => {
    const { store } = await createStore()

    await store.removeOtherGenerations('123', NEW_KEY)

    await expect(store.writeJson(
      chapterAddress(OLD_KEY),
      chapter,
      resourceGuard(store, OLD_KEY),
    )).resolves.toBe(false)
  })

  it('cancels obsolete deferred deletion when that generation becomes current again', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))

    await store.removeOtherGenerations('123', NEW_KEY)
    await store.removeOtherGenerations('123', OLD_KEY)
    await lease.release()

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
  })

  it('serializes generation restoration ahead of a concurrent lease release', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', OLD_KEY)
    await store.writeJson(chapterAddress(), chapter, store.captureWriteGuard(lease))
    await store.removeOtherGenerations('123', NEW_KEY)

    await Promise.all([
      store.removeOtherGenerations('123', OLD_KEY),
      lease.release(),
    ])

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toEqual(chapter)
  })

  it('keeps the last concurrent generation cleanup as current', async () => {
    const { store } = await createStore()
    const lease = await store.acquireGeneration('123', NEW_KEY)
    await store.writeJson(
      chapterAddress(NEW_KEY),
      chapter,
      store.captureWriteGuard(lease),
    )

    await Promise.all([
      store.removeOtherGenerations('123', OLD_KEY),
      store.removeOtherGenerations('123', NEW_KEY),
    ])
    await lease.release()

    await expect(store.readJson(chapterAddress(NEW_KEY), parseChapter)).resolves.toEqual(chapter)
  })

  it('serializes reads and writes for the same binary cache entry', async () => {
    const { store } = await createStore()
    const values = [
      { data: Buffer.from('seed'), extension: 'seed' },
      { data: Buffer.from('a'.repeat(31)), extension: 'a' },
      { data: Buffer.from('b'.repeat(97)), extension: 'b' },
    ]
    await store.writeBinary(imageAddress(), values[0], resourceGuard(store))

    const results = await Promise.all([
      store.writeBinary(imageAddress(), values[1], resourceGuard(store)),
      store.readBinary(imageAddress()),
      store.writeBinary(imageAddress(), values[2], resourceGuard(store)),
      store.readBinary(imageAddress()),
    ])

    for (const result of results) {
      if (typeof result === 'boolean') continue
      expect(result).not.toBeNull()
      const matching = values.find(value => value.extension === result?.extension)
      expect(result?.data.equals(matching?.data ?? Buffer.alloc(0))).toBe(true)
    }
    const final = await store.readBinary(imageAddress())
    const matching = values.find(value => value.extension === final?.extension)
    expect(final?.data.equals(matching?.data ?? Buffer.alloc(0))).toBe(true)
  })

  it('skips writes when minimum free space cannot be restored', async () => {
    const { root, store } = await createStore({ freeBytes: 100 })
    await expect(store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard()))
      .resolves.toBe(false)
    await expect(readFile(join(root, 'books', 'missing'))).rejects.toThrow()
  })

  it('runs LRU when a pending write would cross the minimum free threshold', async () => {
    let freeBytes = 50 * GIB
    const { store } = await createStore({
      statDisk: async () => ({ totalBytes: 100 * GIB, freeBytes }),
    })
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(chapterAddress(), chapter, resourceGuard(store))
    freeBytes = GIB + 1

    await expect(store.writeJson(
      chapterAddress(OLD_KEY, 'https://www.wenku8.net/new.htm'),
      chapter,
      resourceGuard(store),
    )).resolves.toBe(false)

    await expect(store.readJson(chapterAddress(), parseChapter)).resolves.toBeNull()
  })

  it('prunes stale temporary files and corrupt current-generation entries', async () => {
    const { root, store } = await createStore()
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(chapterAddress(), chapter, resourceGuard(store))
    const chapterPath = join(
      root,
      'assets',
      hashCacheKey('123'),
      hashCacheKey(OLD_KEY),
      'chapters',
      `${hashCacheKey(chapterAddress().sourceKey)}.json`,
    )
    await writeFile(chapterPath, '{invalid')
    const staleTemp = join(root, '.entry.tmp-1-value')
    await writeFile(staleTemp, 'temp')
    const expired = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(staleTemp, expired, expired)

    await store.prune('startup')

    await expect(readFile(chapterPath)).rejects.toThrow()
    await expect(readFile(staleTemp)).rejects.toThrow()
  })

  it('does not retain touch state when the cache path disappears', async () => {
    const { root, store } = await createStore()
    const missingPath = join(root, 'assets', 'missing.json')
    const internals = store as unknown as {
      touch(path: string): Promise<void>
      lastTouched: Map<string, number>
    }

    await internals.touch(missingPath)

    expect(internals.lastTouched.has(missingPath)).toBe(false)
  })

  it('keeps a stale entry that is read while pruning starts', async () => {
    const now = Date.now()
    const { root, store } = await createStore({ now: () => now })
    const address = chapterAddress(OLD_KEY, 'https://www.wenku8.net/read-during-prune.htm')
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(address, chapter, resourceGuard(store))
    const entryPath = join(
      root,
      'assets',
      hashCacheKey('123'),
      hashCacheKey(OLD_KEY),
      'chapters',
      `${hashCacheKey(address.sourceKey)}.json`,
    )
    const expired = new Date(now - UNUSED_MAX_AGE_MS - 1)
    await utimes(entryPath, expired, expired)
    const internals = store as unknown as {
      touch(path: string): Promise<void>
    }
    const touch = internals.touch.bind(store)
    let started!: () => void
    let resume!: () => void
    const touchStarted = new Promise<void>(resolve => { started = resolve })
    const resumed = new Promise<void>(resolve => { resume = resolve })
    internals.touch = async (path) => {
      if (path === entryPath) {
        started()
        await resumed
      }
      await touch(path)
    }

    const reading = store.readJson(address, parseChapter)
    await touchStarted
    const pruning = store.prune('startup')
    await new Promise(resolve => setTimeout(resolve, 10))
    resume()

    await expect(reading).resolves.toEqual(chapter)
    await pruning
    await expect(store.readJson(address, parseChapter)).resolves.toEqual(chapter)
  })

  it('serializes lease acquisition behind an active prune for the same book', async () => {
    const { store } = await createStore()
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(chapterAddress(), chapter, resourceGuard(store))
    const internals = store as unknown as {
      removeUnusedGenerationEntries(path: string): Promise<void>
    }
    const removeUnusedGenerationEntries = internals.removeUnusedGenerationEntries.bind(store)
    let scanning!: () => void
    let resume!: () => void
    const scanStarted = new Promise<void>(resolve => { scanning = resolve })
    const resumed = new Promise<void>(resolve => { resume = resolve })
    internals.removeUnusedGenerationEntries = async (path) => {
      scanning()
      await resumed
      await removeUnusedGenerationEntries(path)
    }

    const pruning = store.prune('startup')
    await scanStarted
    let acquired = false
    const leasePromise = store.acquireGeneration('123', OLD_KEY).then((lease) => {
      acquired = true
      return lease
    })
    await Promise.resolve()
    expect(acquired).toBe(false)

    resume()
    await pruning
    const lease = await leasePromise
    expect(acquired).toBe(true)
    await lease.release()
  })

  it('prioritizes an obsolete generation while preserving the current one', async () => {
    const { store } = await createStore()
    await store.writeJson(snapshotAddress(), snapshot(NEW_KEY), store.captureWriteGuard())
    await store.writeJson(chapterAddress(OLD_KEY), chapter, resourceGuard(store, OLD_KEY))
    await store.writeJson(chapterAddress(NEW_KEY), chapter, resourceGuard(store, NEW_KEY))

    await store.prune('startup')

    await expect(store.readJson(chapterAddress(OLD_KEY), parseChapter)).resolves.toBeNull()
    await expect(store.readJson(chapterAddress(NEW_KEY), parseChapter)).resolves.toEqual(chapter)
  })

  it('rechecks the current snapshot before pruning an obsolete generation', async () => {
    const { store } = await createStore()
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(chapterAddress(OLD_KEY), chapter, resourceGuard(store, OLD_KEY))
    await store.writeJson(chapterAddress(NEW_KEY), chapter, resourceGuard(store, NEW_KEY))
    const internals = store as unknown as {
      currentGenerations(): Promise<Map<string, unknown>>
    }
    const currentGenerations = internals.currentGenerations.bind(store)
    let scanned!: () => void
    let resume!: () => void
    const scanComplete = new Promise<void>(resolve => { scanned = resolve })
    const resumed = new Promise<void>(resolve => { resume = resolve })
    internals.currentGenerations = async () => {
      const result = await currentGenerations()
      scanned()
      await resumed
      return result
    }

    const pruning = store.prune('startup')
    await scanComplete
    await store.writeJson(snapshotAddress(), snapshot(NEW_KEY), store.captureWriteGuard())
    resume()
    await pruning

    await expect(store.readJson(chapterAddress(OLD_KEY), parseChapter)).resolves.toBeNull()
    await expect(store.readJson(chapterAddress(NEW_KEY), parseChapter)).resolves.toEqual(chapter)
  })

  it('invalidates old guards after expired book state is released', async () => {
    const now = Date.now()
    const { root, store } = await createStore({ now: () => now })
    const staleGuard = resourceGuard(store)
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(chapterAddress(), chapter, staleGuard)
    await store.removeOtherGenerations('123', OLD_KEY)
    const generationPath = join(
      root,
      'assets',
      hashCacheKey('123'),
      hashCacheKey(OLD_KEY),
      'chapters',
      `${hashCacheKey(chapterAddress().sourceKey)}.json`,
    )
    const snapshotPath = join(root, 'books', hashCacheKey('123'), 'snapshot.json')
    const expired = new Date(now - UNUSED_MAX_AGE_MS - 1)
    await Promise.all([
      utimes(generationPath, expired, expired),
      utimes(snapshotPath, expired, expired),
    ])

    await store.prune('startup')

    const freshGuard = resourceGuard(store)
    await expect(store.writeJson(chapterAddress(), chapter, staleGuard)).resolves.toBe(false)
    await expect(store.writeJson(chapterAddress(), chapter, freshGuard)).resolves.toBe(true)
  })

  it('removes 90 day old resources without deleting a recently used snapshot', async () => {
    const now = Date.now()
    const { root, store } = await createStore({ now: () => now })
    const oldAddress = chapterAddress(OLD_KEY, 'https://www.wenku8.net/old.htm')
    const recentAddress = chapterAddress(OLD_KEY, 'https://www.wenku8.net/recent.htm')
    await store.writeJson(snapshotAddress(), snapshot(), store.captureWriteGuard())
    await store.writeJson(oldAddress, chapter, resourceGuard(store))
    await store.writeJson(recentAddress, chapter, resourceGuard(store))
    const oldPath = join(
      root,
      'assets',
      hashCacheKey('123'),
      hashCacheKey(OLD_KEY),
      'chapters',
      `${hashCacheKey(oldAddress.sourceKey)}.json`,
    )
    const expired = new Date(now - UNUSED_MAX_AGE_MS - 1)
    await utimes(oldPath, expired, expired)

    await store.prune('startup')

    await expect(store.readJson(oldAddress, parseChapter)).resolves.toBeNull()
    await expect(store.readJson(recentAddress, parseChapter)).resolves.toEqual(chapter)
    await expect(store.readJson(snapshotAddress(), parseBookSnapshot)).resolves.toEqual(snapshot())
  })
})
