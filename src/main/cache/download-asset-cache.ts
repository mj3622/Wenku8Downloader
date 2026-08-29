import { imageExtensionFromUrl } from '../path-safety'
import { normalizeCacheUrl } from './cache-key'
import {
  CacheStore,
  type CachedBinary,
  type CacheLease,
  type CacheWriteGuard,
} from './cache-store'
import {
  loadLegacyChapter,
  loadLegacyImage,
  removeLegacyEntry,
  type LegacyChapterRef,
  type LegacyImageRef,
} from './legacy-download-cache'
import { logger } from '../logging/logger'

export interface CachedChapter {
  title: string
  content: string
}

export interface DownloadCacheContext {
  bookId: string
  generationKey: string
  allowLegacyImport: boolean
  lease: CacheLease
}

export function hasUsableChapterContent(content: string): boolean {
  if (!content.trim()) return false
  if (/<img\b/i.test(content)) return true
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .trim()
    .length > 0
}

function parseChapter(value: unknown): CachedChapter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.title !== 'string'
    || data.title.length > 2_048
    || typeof data.content !== 'string'
    || !hasUsableChapterContent(data.content)) return null
  return { title: data.title, content: data.content }
}

export class DownloadAssetCache {
  constructor(private readonly store: CacheStore) {}

  captureTaskGuard(): CacheWriteGuard {
    return this.store.captureWriteGuard()
  }

  async acquire(
    bookId: string,
    generationKey: string,
    legacyImportGenerationKey: string,
    taskGuard?: CacheWriteGuard,
  ): Promise<DownloadCacheContext> {
    return {
      bookId,
      generationKey,
      allowLegacyImport: generationKey === legacyImportGenerationKey,
      lease: await this.store.acquireGeneration(bookId, generationKey, taskGuard),
    }
  }

  captureWriteGuard(context: DownloadCacheContext): CacheWriteGuard {
    return this.store.captureWriteGuard(context.lease)
  }

  async loadChapter(
    context: DownloadCacheContext,
    url: string,
    legacy?: LegacyChapterRef,
  ): Promise<CachedChapter | null> {
    const normalized = normalizeCacheUrl(url)
    if (!normalized) return null
    const address = {
      kind: 'chapter' as const,
      bookId: context.bookId,
      generationKey: context.generationKey,
      sourceKey: normalized,
    }
    const cached = await this.store.readJson(address, parseChapter)
    if (cached || !context.allowLegacyImport || !legacy) return cached
    const imported = await loadLegacyChapter(context.bookId, legacy)
    if (!imported || !hasUsableChapterContent(imported.value.content)) return null
    const saved = await this.store.writeJson(
      address,
      imported.value,
      this.captureWriteGuard(context),
    )
    if (saved) await this.removeImportedLegacyEntry(imported.paths, 'chapter')
    return imported.value
  }

  saveChapter(
    context: DownloadCacheContext,
    url: string,
    chapter: CachedChapter,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const normalized = normalizeCacheUrl(url)
    if (!normalized
      || chapter.title.length > 2_048
      || !hasUsableChapterContent(chapter.content)) return Promise.resolve(false)
    return this.store.writeJson({
      kind: 'chapter',
      bookId: context.bookId,
      generationKey: context.generationKey,
      sourceKey: normalized,
    }, chapter, guard)
  }

  async loadImage(
    context: DownloadCacheContext,
    url: string,
    legacy?: LegacyImageRef,
  ): Promise<CachedBinary | null> {
    const normalized = normalizeCacheUrl(url)
    if (!normalized) return null
    const address = {
      kind: 'image' as const,
      bookId: context.bookId,
      generationKey: context.generationKey,
      sourceKey: normalized,
    }
    const cached = await this.store.readBinary(address)
    if (cached || !context.allowLegacyImport || !legacy) return cached
    const imported = await loadLegacyImage(context.bookId, legacy)
    if (!imported) return null
    const saved = await this.store.writeBinary(
      address,
      imported.value,
      this.captureWriteGuard(context),
    )
    if (saved) await this.removeImportedLegacyEntry(imported.paths, 'image')
    return imported.value
  }

  saveImage(
    context: DownloadCacheContext,
    url: string,
    image: CachedBinary,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const normalized = normalizeCacheUrl(url)
    if (!normalized || image.data.byteLength === 0) return Promise.resolve(false)
    return this.store.writeBinary({
      kind: 'image',
      bookId: context.bookId,
      generationKey: context.generationKey,
      sourceKey: normalized,
    }, {
      data: image.data,
      extension: image.extension || imageExtensionFromUrl(normalized),
    }, guard)
  }

  private async removeImportedLegacyEntry(
    paths: string[],
    cacheType: 'chapter' | 'image',
  ): Promise<void> {
    try {
      await removeLegacyEntry(paths)
    } catch (error) {
      logger.warn('cache.legacy-entry-remove.failed', '旧版缓存条目删除失败，下载继续', {
        cacheType,
        error,
      })
    }
  }
}

export type { LegacyChapterRef, LegacyImageRef }
