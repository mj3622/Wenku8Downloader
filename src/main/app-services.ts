import { app } from 'electron'
import { Book } from './book'
import { BookService } from './book-service'
import { ConfigService } from './config/config-service'
import { resolveConfigPaths } from './config/config-paths'
import { LocalSecretCodec } from './config/secret-codec'
import { SecretStore } from './config/secret-store'
import { SettingsStore } from './config/settings-store'
import { WebCrawler, type CrawlerRequestControlFactory } from './crawler'
import {
  createDownloadExecutor,
  type DownloadExecutorBook,
} from './download-executor'
import { DownloadManager } from './download-manager'
import { sharedDownloadRateLimiter } from './download-rate-limiter'
import { DownloadTaskStore, resolveDownloadTaskPath } from './download-task-store'
import { resolveDownloadRoot, selectVolumeCoverUrl } from './downloader'
import { configureLogger, logger } from './logging/logger'
import { resolveCacheRoot } from './cache/cache-paths'
import { MAINTENANCE_INTERVAL_MS } from './cache/cache-policy'
import { CacheStore, type CacheClearResult } from './cache/cache-store'
import { DownloadAssetCache } from './cache/download-asset-cache'
import {
  clearLegacyDownloadCache,
  pruneLegacyDownloadCache,
} from './cache/legacy-download-cache'
import { BookCacheRepository } from './book-cache-repository'

export interface AppServices {
  config: ConfigService
  crawler: WebCrawler
  books: BookService
  downloads: DownloadManager
  initializeCache(): Promise<void>
  stopCacheMaintenance(): void
  clearCache(): Promise<CacheClearResult>
  invalidateBookCache(): Promise<void>
  resolveVolumeCovers(bookId: string, volumes: string[]): Promise<Record<string, string>>
}

function createDownloadBookView(
  book: Book,
  requestControlFactory: CrawlerRequestControlFactory,
): DownloadExecutorBook {
  return {
    bookId: book.bookId,
    generationKey: book.generationKey,
    legacyImportGenerationKey: book.legacyImportGenerationKey,
    baseChapterUrl: book.baseChapterUrl,
    volumes: book.volumes,
    pictureUrls: book.pictureUrls,
    basicInfo: book.basicInfo,
    getFormattedTitle: (format) => book.getFormattedTitle(format),
    getChapterImageUrls: (volumeName, signal) => (
      book.getChapterImageUrls(volumeName, signal, requestControlFactory)
    ),
    getCoverContent: (signal) => book.getCoverContent(signal, requestControlFactory),
  }
}

export function createAppServices(): AppServices {
  const paths = resolveConfigPaths({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    devRoot: process.cwd(),
  })
  const settingsStore = new SettingsStore(paths.settingsPath)
  const secretStore = new SecretStore(
    paths.secretsPath,
    new LocalSecretCodec(),
  )
  const config = ConfigService.load({
    settingsStore,
    secretStore,
    legacyPath: paths.legacyPath,
  })
  const crawler = new WebCrawler(config)
  const environment = {
    isPackaged: app.isPackaged,
    downloadsPath: app.getPath('downloads'),
    devRoot: process.cwd(),
  }
  const cacheStore = new CacheStore(resolveCacheRoot({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    devRoot: process.cwd(),
  }))
  const bookCache = new BookCacheRepository(cacheStore)
  const assetCache = new DownloadAssetCache(cacheStore)
  const createControlFactory = (onThrottleWait?: (waitMs: number) => void) => (
    (kind, url) => sharedDownloadRateLimiter.createRequestControl(
      kind,
      url,
      onThrottleWait ? { onThrottleWait } : {},
    )
  ) satisfies CrawlerRequestControlFactory
  const books = new BookService({
    fetchPage: (bookId, signal, onThrottleWait) => Book.fetchPage(
      bookId,
      crawler,
      signal,
      createControlFactory(onThrottleWait),
    ),
    buildFromPage: (
      bookId,
      page,
      version,
      legacyImportGenerationKey,
      signal,
      onThrottleWait,
    ) => Book.createFromPage(
      bookId,
      crawler,
      page,
      version,
      legacyImportGenerationKey,
      signal,
      createControlFactory(onThrottleWait),
      bookCache,
    ),
    restore: (snapshot) => Book.fromSnapshot(
      snapshot,
      crawler,
      createControlFactory(),
      bookCache,
    ),
  }, bookCache)
  const executor = createDownloadExecutor({
    config,
    crawler,
    loadBook: async (bookId, signal, controlFactory, onThrottleWait) => {
      const book = await books.get(bookId, { signal, onThrottleWait })
      return createDownloadBookView(book, controlFactory)
    },
    rateLimiter: sharedDownloadRateLimiter,
    assetCache,
    environment,
  })
  const taskPath = resolveDownloadTaskPath({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    devRoot: process.cwd(),
  })
  const downloads = new DownloadManager({
    store: new DownloadTaskStore(taskPath),
    executor,
  })
  let stopCentralMaintenance: (() => void) | undefined
  let legacyMaintenanceTimer: ReturnType<typeof setInterval> | undefined

  const currentDownloadRoot = (): string => resolveDownloadRoot(
    config.getDownloadSnapshot(),
    environment,
  )

  const initializeCache = async (): Promise<void> => {
    try {
      await cacheStore.initialize()
      stopCentralMaintenance ??= cacheStore.startMaintenance()
      queueMicrotask(() => {
        void pruneLegacyDownloadCache(currentDownloadRoot()).catch((error) => {
          logger.warn('cache.legacy-prune.failed', '旧版缓存清理失败，主流程继续运行', { error })
        })
      })
      if (!legacyMaintenanceTimer) {
        legacyMaintenanceTimer = setInterval(() => {
          void pruneLegacyDownloadCache(currentDownloadRoot()).catch((error) => {
            logger.warn('cache.legacy-prune.failed', '旧版缓存清理失败，主流程继续运行', { error })
          })
        }, MAINTENANCE_INTERVAL_MS)
        legacyMaintenanceTimer.unref?.()
      }
    } catch (error) {
      logger.warn('cache.initialize.failed', '缓存初始化失败，将继续使用网络加载', { error })
    }
  }

  const stopCacheMaintenance = (): void => {
    stopCentralMaintenance?.()
    stopCentralMaintenance = undefined
    if (legacyMaintenanceTimer) clearInterval(legacyMaintenanceTimer)
    legacyMaintenanceTimer = undefined
  }

  const clearCache = async (): Promise<CacheClearResult> => {
    books.clearMemory()
    try {
      const result = await cacheStore.clear()
      await clearLegacyDownloadCache(currentDownloadRoot())
      return result
    } catch (error) {
      logger.warn('cache.clear.failed', '缓存清除失败', { error })
      throw new Error('cache clear failed', { cause: error })
    }
  }

  const invalidateBookCache = async (): Promise<void> => {
    books.clearMemory()
    await bookCache.clearSnapshots()
  }

  const resolveVolumeCovers = async (
    bookId: string,
    volumes: string[],
  ): Promise<Record<string, string>> => {
    const book = await books.get(bookId)
    const coverIndex = config.getDownloadSnapshot().defaultCoverIndex
    const resolved = await Promise.all(volumes.map(async (volumeName) => {
      try {
        const urls = await book.getChapterImageUrls(volumeName)
        const cover = selectVolumeCoverUrl(urls, coverIndex, book.baseChapterUrl)
        return cover ? [volumeName, cover] as const : undefined
      } catch (error) {
        logger.warn(
          'book.volume-cover.failed',
          '分卷封面解析失败，下载任务将不沿用小说封面',
          { bookId, volumeName, error },
        )
        return undefined
      }
    }))
    return Object.fromEntries(resolved.filter((item) => item !== undefined))
  }

  return {
    config,
    crawler,
    books,
    downloads,
    initializeCache,
    stopCacheMaintenance,
    clearCache,
    invalidateBookCache,
    resolveVolumeCovers,
  }
}

export async function initializeAppServices(): Promise<AppServices> {
  const services = createAppServices()
  configureLogger(services.config.getLogSnapshot())
  const diagnostics = services.config.getLoadDiagnostics()
  logger.info('config.loaded', '配置加载完成', {
    health: services.config.getPublicSnapshot().health,
    settingsState: diagnostics.settingsState,
    secretState: diagnostics.secretState,
    legacyMigrationState: diagnostics.legacyMigrationState,
  })
  if (diagnostics.settingsMigrated) {
    logger.info('config.settings-migrated', '设置文件已迁移到当前版本', {
      settingsState: diagnostics.settingsState,
    })
  }
  if (diagnostics.legacyMigrationState === 'migrated') {
    logger.info('config.legacy-migrated', '旧版配置已迁移', {
      legacyMigrationState: diagnostics.legacyMigrationState,
    })
  }
  if (diagnostics.settingsError !== undefined) {
    logger.error(
      'config.settings-load-failed',
      '设置文件加载失败，已保留原文件',
      diagnostics.settingsError,
      {
        settingsState: diagnostics.settingsState,
        message: diagnostics.settingsMessage,
      },
    )
  }
  await services.initializeCache()
  services.downloads.initialize()
  await services.crawler.syncCookies()
  return services
}
