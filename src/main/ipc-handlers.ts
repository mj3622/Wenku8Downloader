import { app, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'fs/promises'
import type { Book } from './book'
import { CookieService } from './cookie-service'
import {
  validateCredentialsInput,
  type ConfigService,
} from './config/config-service'
import { validateDownloadConfig } from './config/config-schema'
import type { WebCrawler } from './crawler'
import {
  Downloader,
  resolveDownloadRoot,
  type DownloaderBook,
  type DownloadRuntimeConfig,
} from './downloader'
import { resolveWithin } from './path-safety'
import {
  validateBookId,
  validateExternalUrl,
  validateOpenFolder,
  validateOptionalTaskId,
  validateOptionalVolumeName,
  validateSearchQuery,
} from './ipc-validation'

function requirePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IPC 参数格式无效')
  }
  return value as Record<string, unknown>
}

export type IpcBook = DownloaderBook & Pick<Book, 'pictureUrls'>

export interface IpcServices {
  config: Pick<
    ConfigService,
    | 'getPublicSnapshot'
    | 'getDownloadSnapshot'
    | 'updateDownload'
    | 'updateCredentials'
    | 'resetCorruptConfig'
    | 'getCredentials'
    | 'getCookies'
  >
  crawler: Pick<
    WebCrawler,
    'syncCookies' | 'search' | 'getCookie' | 'fetch' | 'getImageContent'
  >
  books: {
    get(bookId: string): Promise<IpcBook>
    clear(): void
  }
}

function getDownloadRuntimeConfig(services: IpcServices): DownloadRuntimeConfig {
  const download = services.config.getDownloadSnapshot()
  return {
    ...download,
    rootPath: resolveDownloadRoot(download, {
      isPackaged: app.isPackaged,
      downloadsPath: app.getPath('downloads'),
      devRoot: process.cwd(),
    }),
  }
}

export function registerIpcHandlers(services: IpcServices): void {
  ipcMain.handle('config:get', () => services.config.getPublicSnapshot())

  ipcMain.handle('config:update-download', (_event, input: unknown) => {
    return services.config.updateDownload(validateDownloadConfig(input))
  })

  ipcMain.handle('config:update-credentials', async (_event, input: unknown) => {
    services.config.updateCredentials(validateCredentialsInput(input))
    try {
      await services.crawler.syncCookies()
      services.books.clear()
    } catch (error) {
      throw new Error('账号设置已保存，但 Cookie 同步失败，请重试刷新 Cookie', {
        cause: error,
      })
    }
    return services.config.getPublicSnapshot()
  })

  ipcMain.handle('config:reset-corrupt', async () => {
    services.config.resetCorruptConfig()
    try {
      await services.crawler.syncCookies()
      services.books.clear()
    } catch (error) {
      throw new Error('配置已重置，但 Cookie 同步失败，请重启应用', { cause: error })
    }
    return services.config.getPublicSnapshot()
  })

  ipcMain.handle('cookie:auto', async (event) => {
    const service = new CookieService(services.crawler, services.config)
    try {
      await service.acquire((progress) => {
        event.sender.send('cookie:progress', progress)
      })
    } catch (error) {
      throw new Error('登录或 Cookie 保存失败，请检查账号后重试', { cause: error })
    }
    services.books.clear()
    return { status: 'ok', message: '登录成功，已获取 Cookie' }
  })

  ipcMain.handle('search:author', async (_event, rawPayload: unknown) => {
    const query = validateSearchQuery(requirePayload(rawPayload).query)
    const results = await services.crawler.search(query, 'author')
    return { results }
  })

  ipcMain.handle('search:title', async (_event, rawPayload: unknown) => {
    const query = validateSearchQuery(requirePayload(rawPayload).query)
    const results = await services.crawler.search(query, 'title')
    return { results }
  })

  ipcMain.handle('book:get', async (_event, rawPayload: unknown) => {
    const bookId = validateBookId(requirePayload(rawPayload).bookId)
    const book = await services.books.get(bookId)
    return {
      book_id: book.bookId,
      basic_info: book.basicInfo,
      volumes: book.volumes,
    }
  })

  ipcMain.handle('book:images', async (_event, rawPayload: unknown) => {
    const bookId = validateBookId(requirePayload(rawPayload).bookId)
    const book = await services.books.get(bookId)
    return { images: book.pictureUrls }
  })

  ipcMain.handle('download:epub', async (event, rawPayload: unknown) => {
    const payload = requirePayload(rawPayload)
    const bookId = validateBookId(payload.bookId)
    const volumeName = validateOptionalVolumeName(payload.volumeName)
    const taskId = validateOptionalTaskId(payload.taskId)
    const runtimeConfig = getDownloadRuntimeConfig(services)
    const book = await services.books.get(bookId)
    if (volumeName && !book.volumes[volumeName]) throw new Error(`未找到卷: ${volumeName}`)
    const downloader = new Downloader(services.crawler, runtimeConfig)
    downloader.setOnProgress((progress) => {
      event.sender.send('download:progress', { taskId, ...progress })
    })
    await downloader.downloadNovel(book, volumeName)
    return { status: 'ok', message: '下载完成' }
  })

  ipcMain.handle('download:images', async (event, rawPayload: unknown) => {
    const payload = requirePayload(rawPayload)
    const bookId = validateBookId(payload.bookId)
    const volumeName = validateOptionalVolumeName(payload.volumeName)
    const taskId = validateOptionalTaskId(payload.taskId)
    const runtimeConfig = getDownloadRuntimeConfig(services)
    const book = await services.books.get(bookId)
    const downloader = new Downloader(services.crawler, runtimeConfig)
    downloader.setOnProgress((progress) => {
      event.sender.send('download:progress', { taskId, ...progress })
    })
    if (volumeName) {
      const volumeIndex = Object.keys(book.volumes).indexOf(volumeName)
      const urls = await book.getChapterImageUrls(volumeName)
      if (volumeIndex < 0 || !urls) throw new Error(`该卷没有可下载的插图: ${volumeName}`)
      await downloader.downloadPictures(
        urls,
        volumeName,
        book.basicInfo['标题'],
        book.bookId,
        volumeIndex,
      )
    } else {
      if (Object.keys(book.pictureUrls).length === 0) {
        throw new Error('该作品没有可下载的插图')
      }
      for (const volume of Object.keys(book.pictureUrls)) {
        const urls = await book.getChapterImageUrls(volume)
        if (urls) {
          const volumeIndex = Object.keys(book.volumes).indexOf(volume)
          await downloader.downloadPictures(
            urls,
            volume,
            book.basicInfo['标题'],
            book.bookId,
            volumeIndex,
          )
        }
      }
    }
    return { status: 'ok', message: '下载完成' }
  })

  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    await shell.openExternal(validateExternalUrl(url))
  })

  ipcMain.handle('shell:openFolder', async (_event, rawTarget: unknown) => {
    const target = validateOpenFolder(rawTarget)
    const rootPath = getDownloadRuntimeConfig(services).rootPath
    const folderPath = target === 'root'
      ? rootPath
      : resolveWithin(rootPath, target)

    if (target === 'root') {
      try {
        await mkdir(folderPath, { recursive: true })
      } catch {
        throw new Error('创建下载文件夹失败')
      }
    }

    const error = await shell.openPath(folderPath)
    if (error) throw new Error(`打开下载文件夹失败: ${error}`)
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
