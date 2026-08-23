import { app, safeStorage } from 'electron'
import { Book } from './book'
import { BookService } from './book-service'
import { ConfigService } from './config/config-service'
import { resolveConfigPaths } from './config/config-paths'
import { ElectronSafeStorageCodec } from './config/secret-codec'
import { SecretStore } from './config/secret-store'
import { SettingsStore } from './config/settings-store'
import { WebCrawler } from './crawler'
import { configureLogger, logger } from './logging/logger'

export interface AppServices {
  config: ConfigService
  crawler: WebCrawler
  books: BookService
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
  const books = new BookService((bookId) => Book.create(bookId, crawler))

  return { config, crawler, books }
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
  await services.crawler.syncCookies()
  return services
}
