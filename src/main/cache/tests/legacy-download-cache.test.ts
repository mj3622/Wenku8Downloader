import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_CACHE_TTL_MS,
  clearLegacyDownloadCache,
  legacyBookCacheDir,
  loadLegacyChapter,
  pruneLegacyDownloadCache,
} from '../legacy-download-cache'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'wenku8-legacy-cache-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true })))
})

describe('legacy download cache', () => {
  it('rejects and removes chapters older than 24 hours', async () => {
    const downloadRoot = await root()
    const chapterDir = join(legacyBookCacheDir(downloadRoot, '123'), 'chapters', '1_volume')
    const chapterPath = join(chapterDir, '0.json')
    await mkdir(chapterDir, { recursive: true })
    await writeFile(chapterPath, JSON.stringify({ title: '一', content: '<p>正文</p>' }))
    const now = Date.now()
    const expired = new Date(now - LEGACY_CACHE_TTL_MS - 1)
    await utimes(chapterPath, expired, expired)

    await expect(loadLegacyChapter('123', {
      downloadRoot, volumeKey: '1_volume', index: 0,
    }, now)).resolves.toBeNull()
    await expect(readFile(chapterPath)).rejects.toThrow()
  })

  it('prunes only stale cache files', async () => {
    const downloadRoot = await root()
    const cacheDir = join(legacyBookCacheDir(downloadRoot, '123'), 'chapters', '1_volume')
    await mkdir(cacheDir, { recursive: true })
    const stale = join(cacheDir, '0.json')
    const fresh = join(cacheDir, '1.json')
    await writeFile(stale, '{}')
    await writeFile(fresh, '{}')
    const now = Date.now()
    const expired = new Date(now - LEGACY_CACHE_TTL_MS - 1)
    await utimes(stale, expired, expired)

    await pruneLegacyDownloadCache(downloadRoot, now)
    await expect(readFile(stale)).rejects.toThrow()
    await expect(readFile(fresh, 'utf8')).resolves.toBe('{}')
  })

  it('clears only recognizable legacy entries in the current download root', async () => {
    const downloadRoot = await root()
    const outside = join(downloadRoot, 'outside.txt')
    const unrelated = join(downloadRoot, '.cache', 'unrelated.txt')
    const unknownBookFile = join(legacyBookCacheDir(downloadRoot, '123'), 'value')
    const chapterDir = join(legacyBookCacheDir(downloadRoot, '123'), 'chapters', '1_volume')
    await writeFile(outside, 'keep')
    await mkdir(chapterDir, { recursive: true })
    await writeFile(join(chapterDir, '0.json'), '{}')
    await writeFile(unknownBookFile, 'keep')
    await writeFile(unrelated, 'keep')

    await clearLegacyDownloadCache(downloadRoot)

    await expect(readFile(outside, 'utf8')).resolves.toBe('keep')
    await expect(readFile(join(chapterDir, '0.json'))).rejects.toThrow()
    await expect(readFile(unknownBookFile, 'utf8')).resolves.toBe('keep')
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('keep')
  })

  it('does not follow symlinked legacy cache directories', async () => {
    const downloadRoot = await root()
    const outsideRoot = await root()
    const outsideChapter = join(outsideRoot, '123', 'chapters', '1_volume', '0.json')
    await mkdir(join(outsideRoot, '123', 'chapters', '1_volume'), { recursive: true })
    await writeFile(outsideChapter, '{}')
    await symlink(outsideRoot, join(downloadRoot, '.cache'), 'dir')

    await clearLegacyDownloadCache(downloadRoot)
    await expect(loadLegacyChapter('123', {
      downloadRoot, volumeKey: '1_volume', index: 0,
    })).resolves.toBeNull()

    await expect(readFile(outsideChapter, 'utf8')).resolves.toBe('{}')

    const nestedDownloadRoot = await root()
    const outsideChapters = await root()
    const nestedChapter = join(outsideChapters, '1_volume', '0.json')
    const bookPath = legacyBookCacheDir(nestedDownloadRoot, '123')
    await mkdir(join(outsideChapters, '1_volume'), { recursive: true })
    await writeFile(nestedChapter, '{}')
    await mkdir(bookPath, { recursive: true })
    await symlink(outsideChapters, join(bookPath, 'chapters'), 'dir')

    await clearLegacyDownloadCache(nestedDownloadRoot)

    await expect(readFile(nestedChapter, 'utf8')).resolves.toBe('{}')
  })
})
