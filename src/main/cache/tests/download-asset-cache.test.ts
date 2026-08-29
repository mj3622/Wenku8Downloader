import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DownloadAssetCache } from '../download-asset-cache'
import { GIB } from '../cache-policy'
import { CacheStore } from '../cache-store'
import { legacyBookCacheDir } from '../legacy-download-cache'

const roots: string[] = []
const OLD_KEY = 'a'.repeat(64)
const NEW_KEY = 'b'.repeat(64)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-assets-'))
  const downloadRoot = await mkdtemp(join(tmpdir(), 'wenku8-legacy-'))
  roots.push(root, downloadRoot)
  const store = new CacheStore(root, {
    statDisk: async () => ({ totalBytes: 100 * GIB, freeBytes: 50 * GIB }),
  })
  await store.initialize()
  return { cache: new DownloadAssetCache(store), downloadRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DownloadAssetCache', () => {
  it('keys chapters by normalized absolute URL within a generation', async () => {
    const { cache } = await setup()
    const context = await cache.acquire('123', OLD_KEY, OLD_KEY)
    const guard = cache.captureWriteGuard(context)
    await cache.saveChapter(context, 'HTTPS://EXAMPLE.COM:443/a/../1.htm', {
      title: '第一章', content: '<p>正文</p>',
    }, guard)
    await expect(cache.loadChapter(context, 'https://example.com/1.htm'))
      .resolves.toEqual({ title: '第一章', content: '<p>正文</p>' })
    await context.lease.release()
  })

  it('does not read central or legacy images across generations', async () => {
    const { cache, downloadRoot } = await setup()
    const oldContext = await cache.acquire('123', OLD_KEY, OLD_KEY)
    const url = 'https://img.example/1.jpg'
    await cache.saveImage(oldContext, url, {
      data: Buffer.from('central-old'), extension: 'jpg',
    }, cache.captureWriteGuard(oldContext))

    const legacyDir = join(legacyBookCacheDir(downloadRoot, '123'), 'images', '1_volume')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, '0.bin'), 'legacy-old')
    await writeFile(join(legacyDir, '0.meta'), 'jpg')

    const nextContext = await cache.acquire('123', NEW_KEY, OLD_KEY)
    await expect(cache.loadImage(nextContext, url, {
      downloadRoot, volumeKey: '1_volume', index: 0,
    })).resolves.toBeNull()
    expect(nextContext.allowLegacyImport).toBe(false)
    expect(await readFile(join(legacyDir, '0.bin'), 'utf8')).toBe('legacy-old')
    await oldContext.lease.release()
    await nextContext.lease.release()
  })

  it('imports a usable legacy chapter once and deletes the old entry', async () => {
    const { cache, downloadRoot } = await setup()
    const context = await cache.acquire('123', OLD_KEY, OLD_KEY)
    const chapterDir = join(legacyBookCacheDir(downloadRoot, '123'), 'chapters', '1_volume')
    const chapterPath = join(chapterDir, '0.json')
    await mkdir(chapterDir, { recursive: true })
    await writeFile(chapterPath, JSON.stringify({ title: '第一章', content: '<p>正文</p>' }))
    const ref = { downloadRoot, volumeKey: '1_volume', index: 0 }

    await expect(cache.loadChapter(context, 'https://example.com/1.htm', ref))
      .resolves.toEqual({ title: '第一章', content: '<p>正文</p>' })
    await expect(readFile(chapterPath)).rejects.toThrow()
    await expect(cache.loadChapter(context, 'https://example.com/1.htm'))
      .resolves.toEqual({ title: '第一章', content: '<p>正文</p>' })
    await context.lease.release()
  })

  it('does not cache empty chapters or zero-byte images', async () => {
    const { cache } = await setup()
    const context = await cache.acquire('123', OLD_KEY, OLD_KEY)
    await expect(cache.saveChapter(context, 'https://example.com/1.htm', {
      title: '第一章', content: '  ',
    }, cache.captureWriteGuard(context))).resolves.toBe(false)
    await expect(cache.saveImage(context, 'https://example.com/1.jpg', {
      data: Buffer.alloc(0), extension: 'jpg',
    }, cache.captureWriteGuard(context))).resolves.toBe(false)
    await context.lease.release()
  })
})
