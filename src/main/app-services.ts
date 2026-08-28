import { app, safeStorage } from 'electron'
import { Book } from './book'
import { BookService } from './book-service'
import { ConfigService } from './config/config-service'
import { resolveConfigPaths } from './config/config-paths'
import { ElectronSafeStorageCodec } from './config/secret-codec'
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
import { configureLogger, logger } from './logging/logger'

export interface AppServices {
  config: ConfigService
  crawler: WebCrawler
  books: BookService
  downloads: DownloadManager
}

function createDownloadBookView(
  book: Book,
  requestControlFactory: CrawlerRequestControlFactory,
): DownloadExecutorBook {
  return {
    bookId: book.bookId,
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
    new ElectronSafeStorageCodec(safeStorage),
  )
  const config = ConfigService.load({
    settingsStore,
    secretStore,
    legacyPath: paths.legacyPath,
  })
  const crawler = new WebCrawler(config)
  const books = new BookService((bookId, signal, onThrottleWait) => (
    Book.create(bookId, crawler, signal, (kind, url) => (
      sharedDownloadRateLimiter.createRequestControl(kind, url, { onThrottleWait })
    ))
  ))
  const environment = {
    isPackaged: app.isPackaged,
    downloadsPath: app.getPath('downloads'),
    devRoot: process.cwd(),
  }
  const executor = createDownloadExecutor({
    config,
    crawler,
    loadBook: async (bookId, signal, controlFactory, onThrottleWait) => {
      const book = await books.get(bookId, signal, onThrottleWait)
      return createDownloadBookView(book, controlFactory)
    },
    rateLimiter: sharedDownloadRateLimiter,
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

  return { config, crawler, books, downloads }
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
  services.downloads.initialize()
  await services.crawler.syncCookies()
  return services
}
