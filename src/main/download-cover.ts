import type { DownloadTask } from '../shared/ipc-types'
import { BookCacheRepository } from './book-cache-repository'
import { createBookVersion } from './book-cache-model'
import { normalizeCacheUrl } from './cache/cache-key'
import { CacheStore } from './cache/cache-store'

const MAX_COVER_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

export async function loadDownloadCover(
  task: DownloadTask | undefined,
  store: CacheStore,
  books: BookCacheRepository,
): Promise<string | null> {
  if (!task?.cover) return null
  const sourceKey = normalizeCacheUrl(task.cover)
  if (!sourceKey) return null

  const completedVersion = task.completedVersion
    ? createBookVersion(task.completedVersion, task.updatedAt)
    : undefined
  const generationKey = completedVersion?.stable
    ? completedVersion.generationKey
    : (await books.loadSnapshot(task.bookId))?.version.generationKey
  if (!generationKey) return null

  for (const kind of ['image', 'cover'] as const) {
    const cached = await store.readBinary({
      kind,
      bookId: task.bookId,
      generationKey,
      sourceKey,
    })
    if (!cached) continue
    const mimeType = IMAGE_TYPES[cached.extension]
    if (!mimeType || cached.data.byteLength > MAX_COVER_BYTES) return null
    return `data:${mimeType};base64,${cached.data.toString('base64')}`
  }
  return null
}
