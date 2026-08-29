import { lstat, readFile, readdir, rm, rmdir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import { resolveWithin, safePathSegment } from '../path-safety'
import type { CachedBinary } from './cache-store'

export const LEGACY_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface LegacyChapterRef {
  downloadRoot: string
  volumeKey: string
  index: number
}

export interface LegacyImageRef {
  downloadRoot: string
  volumeKey: string
  index: number
}

export interface LegacyEntry<T> {
  value: T
  paths: string[]
}

export function legacyBookCacheDir(downloadRoot: string, bookId: string): string {
  return resolveWithin(
    resolveWithin(downloadRoot, '.cache'),
    safePathSegment(bookId, 'book'),
  )
}

function legacyChapterPath(bookId: string, ref: LegacyChapterRef): string {
  return resolveWithin(
    legacyBookCacheDir(ref.downloadRoot, bookId),
    'chapters',
    safePathSegment(ref.volumeKey, 'volume'),
    `${ref.index}.json`,
  )
}

function legacyImagePaths(bookId: string, ref: LegacyImageRef): [string, string] {
  const directory = resolveWithin(
    legacyBookCacheDir(ref.downloadRoot, bookId),
    'images',
    safePathSegment(ref.volumeKey, 'volume'),
  )
  return [resolveWithin(directory, `${ref.index}.bin`), resolveWithin(directory, `${ref.index}.meta`)]
}

export async function loadLegacyChapter(
  bookId: string,
  ref: LegacyChapterRef,
  now = Date.now(),
): Promise<LegacyEntry<{ title: string; content: string }> | null> {
  const path = legacyChapterPath(bookId, ref)
  try {
    if (!await isSymlinkFreePath(resolveWithin(ref.downloadRoot, '.cache'), path)) return null
    if (now - (await stat(path)).mtimeMs > LEGACY_CACHE_TTL_MS) {
      await rm(path, { force: true })
      return null
    }
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const chapter = value as Record<string, unknown>
    if (typeof chapter.title !== 'string' || typeof chapter.content !== 'string') return null
    return { value: { title: chapter.title, content: chapter.content }, paths: [path] }
  } catch {
    return null
  }
}

export async function loadLegacyImage(
  bookId: string,
  ref: LegacyImageRef,
  now = Date.now(),
): Promise<LegacyEntry<CachedBinary> | null> {
  const [dataPath, metadataPath] = legacyImagePaths(bookId, ref)
  try {
    const root = resolveWithin(ref.downloadRoot, '.cache')
    if (!await isSymlinkFreePath(root, dataPath)
      || !await isSymlinkFreePath(root, metadataPath)) return null
    if (now - (await stat(dataPath)).mtimeMs > LEGACY_CACHE_TTL_MS) {
      await Promise.all([rm(dataPath, { force: true }), rm(metadataPath, { force: true })])
      return null
    }
    const [data, extension] = await Promise.all([
      readFile(dataPath),
      readFile(metadataPath, 'utf8'),
    ])
    const normalizedExtension = extension.trim().toLowerCase()
    if (data.byteLength === 0 || !/^[a-z0-9]{1,8}$/.test(normalizedExtension)) return null
    return {
      value: { data, extension: normalizedExtension },
      paths: [dataPath, metadataPath],
    }
  } catch {
    return null
  }
}

export async function removeLegacyEntry(paths: string[]): Promise<void> {
  await Promise.all(paths.map(path => rm(path, { force: true })))
}

export async function clearLegacyDownloadCache(downloadRoot: string): Promise<void> {
  await cleanLegacyDownloadCache(downloadRoot, () => true)
}

export async function pruneLegacyDownloadCache(
  downloadRoot: string,
  now = Date.now(),
): Promise<void> {
  await cleanLegacyDownloadCache(
    downloadRoot,
    async path => now - (await stat(path)).mtimeMs > LEGACY_CACHE_TTL_MS,
  )
}

async function cleanLegacyDownloadCache(
  downloadRoot: string,
  shouldRemove: (path: string) => boolean | Promise<boolean>,
): Promise<void> {
  const root = resolveWithin(downloadRoot, '.cache')
  for (const bookEntry of await safeReadDirectory(root)) {
    if (!bookEntry.isDirectory() || bookEntry.isSymbolicLink() || !/^\d+$/.test(bookEntry.name)) {
      continue
    }
    const bookPath = resolveWithin(root, bookEntry.name)
    for (const kind of ['chapters', 'images'] as const) {
      const kindPath = resolveWithin(bookPath, kind)
      for (const volumeEntry of await safeReadDirectory(kindPath)) {
        if (!volumeEntry.isDirectory() || volumeEntry.isSymbolicLink()) continue
        const volumePath = resolveWithin(kindPath, volumeEntry.name)
        for (const fileEntry of await safeReadDirectory(volumePath)) {
          if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) continue
          const knownFile = kind === 'chapters'
            ? /^\d+\.json$/.test(fileEntry.name)
            : /^\d+\.(?:bin|meta)$/.test(fileEntry.name)
          if (!knownFile) continue
          const filePath = resolveWithin(volumePath, fileEntry.name)
          try {
            if (await shouldRemove(filePath)) await rm(filePath, { force: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        await removeDirectoryIfEmpty(volumePath)
      }
      await removeDirectoryIfEmpty(kindPath)
    }
    await removeDirectoryIfEmpty(bookPath)
  }
  await removeDirectoryIfEmpty(root)
}

async function safeReadDirectory(path: string) {
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) return []
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) return
    if ((await readdir(path)).length === 0) await rmdir(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error
  }
}

async function isSymlinkFreePath(root: string, target: string): Promise<boolean> {
  const relativePath = relative(root, target)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) return false
  let current = root
  try {
    if ((await lstat(current)).isSymbolicLink()) return false
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = join(current, segment)
      if ((await lstat(current)).isSymbolicLink()) return false
    }
    return true
  } catch {
    return false
  }
}
