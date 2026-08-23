import { app, safeStorage } from 'electron'
import { Book } from './book'
import { BookService } from './book-service'
import { ConfigService } from './config/config-service'
import { resolveConfigPaths } from './config/config-paths'
import { ElectronSafeStorageCodec } from './config/secret-codec'
import { SecretStore } from './config/secret-store'
import { SettingsStore } from './config/settings-store'
import { WebCrawler } from './crawler'

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
  await services.crawler.syncCookies()
  return services
}
