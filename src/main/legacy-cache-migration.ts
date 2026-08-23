import { mkdir, readdir, rename, stat } from 'fs/promises'
import { dirname } from 'path'
import { resolveWithin, safePathSegment } from './path-safety'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function migrateLegacyPath(
  root: string,
  legacySegments: string[],
  targetSegments: string[],
): Promise<boolean> {
  let legacyPath: string
  try {
    legacyPath = resolveWithin(root, ...legacySegments)
  } catch {
    return false
  }

  const targetPath = resolveWithin(root, ...targetSegments)
  if (legacyPath === targetPath) return false
  if (!await pathExists(legacyPath) || await pathExists(targetPath)) return false

  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await rename(legacyPath, targetPath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EEXIST') return false
    throw error
  }
}

function legacyVolumeCacheKey(volumeName: string): string | null {
  if (volumeName.includes('..') || volumeName.includes('/') || volumeName.includes('\\')) {
    return null
  }
  return volumeName.replace(/[^a-zA-Z0-9一-鿿぀-ヿ_-]/g, '_')
}

async function migrateLegacyImagePair(
  bookCacheRoot: string,
  legacySegments: string[],
  targetSegments: string[],
  dataFile: string,
  metaFile: string,
): Promise<void> {
  const legacyDataSegments = [...legacySegments, dataFile]
  const targetDataSegments = [...targetSegments, dataFile]
  const dataMoved = await migrateLegacyPath(
    bookCacheRoot,
    legacyDataSegments,
    targetDataSegments,
  )
  if (!dataMoved) return

  try {
    const metaMoved = await migrateLegacyPath(
      bookCacheRoot,
      [...legacySegments, metaFile],
      [...targetSegments, metaFile],
    )
    if (!metaMoved) throw new Error(`图片缓存元数据迁移失败: ${metaFile}`)
  } catch (error) {
    try {
      const rolledBack = await migrateLegacyPath(
        bookCacheRoot,
        targetDataSegments,
        legacyDataSegments,
      )
      if (!rolledBack) throw new Error(`图片缓存数据回滚失败: ${dataFile}`)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], '图片缓存迁移失败且无法回滚')
    }
    throw error
  }
}

async function migrateLegacyCacheDirectory(
  bookCacheRoot: string,
  cacheType: 'chapters' | 'images',
  legacyKey: string,
  targetKey: string,
): Promise<void> {
  const legacySegments = [cacheType, legacyKey]
  const targetSegments = [cacheType, targetKey]
  if (await migrateLegacyPath(bookCacheRoot, legacySegments, targetSegments)) return

  let entries: string[]
  try {
    entries = await readdir(resolveWithin(bookCacheRoot, ...legacySegments))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  if (cacheType === 'images') {
    const entrySet = new Set(entries)
    const indices = new Set(
      entries.flatMap((entry) => {
        const match = entry.match(/^(\d+)\.(?:bin|meta)$/)
        return match ? [match[1]] : []
      }),
    )

    for (const index of indices) {
      const dataFile = `${index}.bin`
      const metaFile = `${index}.meta`
      if (!entrySet.has(dataFile) || !entrySet.has(metaFile)) continue

      const targetDataPath = resolveWithin(bookCacheRoot, ...targetSegments, dataFile)
      const targetMetaPath = resolveWithin(bookCacheRoot, ...targetSegments, metaFile)
      if (await pathExists(targetDataPath) || await pathExists(targetMetaPath)) continue

      await migrateLegacyImagePair(
        bookCacheRoot,
        legacySegments,
        targetSegments,
        dataFile,
        metaFile,
      )
    }
    return
  }

  for (const entry of entries.filter((name) => /^\d+\.json$/.test(name))) {
    await migrateLegacyPath(
      bookCacheRoot,
      [...legacySegments, entry],
      [...targetSegments, entry],
    )
  }
}

export async function migrateLegacyVolumeCache(
  bookCacheRoot: string,
  volumeName: string,
  volumeKey: string,
  allVolumeNames: string[],
): Promise<void> {
  const legacyKey = legacyVolumeCacheKey(volumeName)
  const targetKey = safePathSegment(volumeKey, 'volume')
  if (!legacyKey || legacyKey === targetKey) return
  const matchingVolumeCount = allVolumeNames.filter(
    (name) => legacyVolumeCacheKey(name) === legacyKey,
  ).length
  if (matchingVolumeCount !== 1) return

  await migrateLegacyCacheDirectory(bookCacheRoot, 'chapters', legacyKey, targetKey)
  await migrateLegacyCacheDirectory(bookCacheRoot, 'images', legacyKey, targetKey)
}
