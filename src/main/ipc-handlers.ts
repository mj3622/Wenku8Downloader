import { app, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { Book } from './book'
import { CookieService } from './cookie-service'
import {
  validateCredentialsInput,
  type ConfigService,
} from './config/config-service'
import { validateDownloadConfig, validateLogConfig } from './config/config-schema'
import type { WebCrawler } from './crawler'
import {
  Downloader,
  NoUsableDownloadContentError,
  resolveDownloadRoot,
  type DownloaderBook,
  type DownloadRuntimeConfig,
} from './downloader'
import { resolveWithin } from './path-safety'
import {
  validateBookId,
  validateExternalUrl,
  validateLoginOperationId,
  validateOpenFolder,
  validateOptionalTaskId,
  validateOptionalVolumeName,
  validateSearchQuery,
} from './ipc-validation'
import type { LogContext } from './logging/file-logger'
import type { DownloadResult } from '../shared/ipc-types'
import { configureLogger, getLogDirectory, logger } from './logging/logger'
import { RendererErrorReporter } from './logging/renderer-error-reporter'

function requirePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求参数格式无效')
  }
  return value as Record<string, unknown>
}

export type IpcBook = DownloaderBook & Pick<Book, 'pictureUrls'>

export interface IpcServices {
  config: Pick<
    ConfigService,
    | 'getPublicSnapshot'
    | 'getDownloadSnapshot'
    | 'getLogSnapshot'
    | 'updateDownload'
    | 'updateLogging'
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

function completedDownloadResult(warnings: string[]): DownloadResult {
  const uniqueWarnings = [...new Set(warnings)]
  return uniqueWarnings.length > 0
    ? {
        status: 'ok',
        message: '下载完成，但有部分内容缺失',
        warnings: uniqueWarnings,
      }
    : { status: 'ok', message: '下载完成' }
}

function downloadLogContext(
  value: unknown,
  type: 'epub' | 'images',
): LogContext {
  const context: LogContext = { type }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return context

  try {
    const record = value as Record<string, unknown>
    for (const key of ['bookId', 'volumeName', 'taskId'] as const) {
      if (typeof record[key] === 'string') context[key] = record[key]
    }
  } catch {
    // Diagnostic context must never make an IPC request fail.
  }
  return context
}

function preferredDownloadOperationId(value: unknown): string | undefined {
  try {
    return validateOptionalTaskId(value)
  } catch {
    return undefined
  }
}

async function runLoggedOperation<T>(
  event: string,
  context: LogContext,
  work: (operationId: string) => Promise<T> | T,
  options: { logStart?: boolean; logSuccess?: boolean; operationId?: string } = {},
): Promise<T> {
  const operationId = options.operationId ?? randomUUID()
  const started = performance.now()
  if (options.logStart !== false) {
    logger.info(`${event}.started`, '操作开始', { ...context, operationId })
  }
  try {
    const result = await work(operationId)
    if (options.logSuccess !== false) {
      logger.info(`${event}.completed`, '操作完成', {
        ...context,
        operationId,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      })
    }
    return result
  } catch (error) {
    logger.error(`${event}.failed`, '操作失败', error, {
      ...context,
      operationId,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    })
    throw error
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
  const rendererErrorReporter = new RendererErrorReporter({ logger })

  ipcMain.handle('config:get', () => runLoggedOperation(
    'config.get',
    {},
    () => services.config.getPublicSnapshot(),
    { logStart: false, logSuccess: false },
  ))

  ipcMain.handle('config:update-download', (_event, input: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('config.update-download', context, () => {
      const validated = validateDownloadConfig(input)
      Object.assign(context, validated)
      return services.config.updateDownload(validated)
    })
  })

  ipcMain.handle('config:update-logging', (_event, input: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('config.update-logging', context, () => {
      const validated = validateLogConfig(input)
      Object.assign(context, validated)
      const snapshot = services.config.updateLogging(validated)
      configureLogger(snapshot.logging)
      return snapshot
    })
  })

  ipcMain.handle('config:update-credentials', (_event, input: unknown) => runLoggedOperation(
    'config.update-credentials',
    { action: 'update' },
    async () => {
      const credentials = validateCredentialsInput(input)
      const clearRequested = credentials.username === '' && credentials.password === ''
      services.config.updateCredentials(credentials)
      try {
        await services.crawler.syncCookies()
        services.books.clear()
      } catch (error) {
        const message = clearRequested
          ? '登录信息已清除，但旧登录状态清理未完成，请重启应用'
          : '账号设置已保存，但登录状态同步失败，请重新登录'
        throw new Error(message, {
          cause: error,
        })
      }
      return services.config.getPublicSnapshot()
    },
  ))

  ipcMain.handle('config:reset-corrupt', () => runLoggedOperation(
    'config.reset-corrupt',
    {},
    async () => {
      services.config.resetCorruptConfig()
      try {
        await services.crawler.syncCookies()
        services.books.clear()
      } catch (error) {
        throw new Error('配置已重置，但登录状态同步失败，请重启应用', { cause: error })
      }
      return services.config.getPublicSnapshot()
    },
  ))

  ipcMain.handle('cookie:auto', (event, rawPayload: unknown) => {
    const operationId = validateLoginOperationId(requirePayload(rawPayload).operationId)
    return runLoggedOperation(
      'cookie.auto',
      {},
      async () => {
        const service = new CookieService(services.crawler, services.config)
        try {
          await service.acquire((progress) => {
            event.sender.send('cookie:progress', { ...progress, operationId })
          })
        } catch (error) {
          throw new Error('登录失败或登录状态无法保存，请检查账号后重试', { cause: error })
        }
        services.books.clear()
        return { status: 'ok', message: '登录成功，登录状态已更新' }
      },
      { operationId },
    )
  })

  ipcMain.handle('search:author', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('search.author', context, async () => {
      const query = validateSearchQuery(requirePayload(rawPayload).query)
      context.query = query
      const results = await services.crawler.search(query, 'author')
      context.resultCount = results.length
      return { results }
    })
  })

  ipcMain.handle('search:title', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('search.title', context, async () => {
      const query = validateSearchQuery(requirePayload(rawPayload).query)
      context.query = query
      const results = await services.crawler.search(query, 'title')
      context.resultCount = results.length
      return { results }
    })
  })

  ipcMain.handle('book:get', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('book.get', context, async () => {
      const bookId = validateBookId(requirePayload(rawPayload).bookId)
      context.bookId = bookId
      const book = await services.books.get(bookId)
      context.title = book.basicInfo['标题']
      context.volumeCount = Object.keys(book.volumes).length
      return {
        book_id: book.bookId,
        basic_info: book.basicInfo,
        volumes: book.volumes,
      }
    })
  })

  ipcMain.handle('book:images', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('book.images', context, async () => {
      const bookId = validateBookId(requirePayload(rawPayload).bookId)
      context.bookId = bookId
      const book = await services.books.get(bookId)
      context.volumeCount = Object.keys(book.pictureUrls).length
      return { images: book.pictureUrls }
    })
  })

  ipcMain.handle('download:epub', (event, rawPayload: unknown) => {
    const context = downloadLogContext(rawPayload, 'epub')
    const preferredOperationId = preferredDownloadOperationId(context.taskId)
    return runLoggedOperation('download.novel', context, async (operationId) => {
      const payload = requirePayload(rawPayload)
      const taskId = validateOptionalTaskId(payload.taskId)
      const bookId = validateBookId(payload.bookId)
      const volumeName = validateOptionalVolumeName(payload.volumeName)
      Object.assign(context, { bookId, volumeName, taskId, operationId })
      const runtimeConfig = getDownloadRuntimeConfig(services)
      const book = await services.books.get(bookId)
      context.title = book.basicInfo['标题']
      if (volumeName && !book.volumes[volumeName]) throw new Error(`未找到卷: ${volumeName}`)
      const downloader = new Downloader(services.crawler, runtimeConfig, { operationId, taskId })
      downloader.setOnProgress((progress) => {
        event.sender.send('download:progress', { taskId, ...progress })
      })
      await downloader.downloadNovel(book, volumeName)
      return completedDownloadResult(downloader.getWarnings())
    }, { operationId: preferredOperationId })
  })

  ipcMain.handle('download:images', (event, rawPayload: unknown) => {
    const context = downloadLogContext(rawPayload, 'images')
    const preferredOperationId = preferredDownloadOperationId(context.taskId)
    return runLoggedOperation('download.pictures', context, async (operationId) => {
      const payload = requirePayload(rawPayload)
      const taskId = validateOptionalTaskId(payload.taskId)
      const bookId = validateBookId(payload.bookId)
      const volumeName = validateOptionalVolumeName(payload.volumeName)
      Object.assign(context, { bookId, volumeName, taskId, operationId })
      const runtimeConfig = getDownloadRuntimeConfig(services)
      const book = await services.books.get(bookId)
      context.title = book.basicInfo['标题']
      const downloader = new Downloader(services.crawler, runtimeConfig, { operationId, taskId })
      downloader.setOnProgress((progress) => {
        event.sender.send('download:progress', { taskId, ...progress })
      })
      if (volumeName) {
        const volumeIndex = Object.keys(book.volumes).indexOf(volumeName)
        const urls = await book.getChapterImageUrls(volumeName)
        if (volumeIndex < 0 || !urls?.length) {
          throw new NoUsableDownloadContentError(`该卷没有可保存的插图: ${volumeName}`)
        }
        await downloader.downloadPictures(
          urls,
          volumeName,
          book.basicInfo['标题'],
          book.bookId,
          volumeIndex,
        )
      } else {
        if (Object.keys(book.pictureUrls).length === 0) {
          throw new NoUsableDownloadContentError('该作品没有可保存的插图')
        }
        const warnings: string[] = []
        let firstIllustrationError: unknown
        let completedVolumes = 0
        for (const volume of Object.keys(book.pictureUrls)) {
          let urls: string[] | null
          try {
            urls = await book.getChapterImageUrls(volume)
          } catch (error) {
            firstIllustrationError ??= error
            logger.error(
              'download.illustration-page.failed',
              '插图页读取失败，继续处理其他分卷',
              error,
              { ...context, volumeName: volume },
            )
            warnings.push(`“${volume}”的插图页无法读取，已跳过该卷。`)
            continue
          }
          if (!urls?.length) {
            warnings.push(`“${volume}”没有可保存的插图。`)
            continue
          }
          const volumeIndex = Object.keys(book.volumes).indexOf(volume)
          try {
            await downloader.downloadPictures(
              urls,
              volume,
              book.basicInfo['标题'],
              book.bookId,
              volumeIndex,
            )
            completedVolumes++
          } catch (error) {
            if (!(error instanceof NoUsableDownloadContentError)) throw error
            warnings.push(`“${volume}”没有可保存的插图。`)
          }
        }
        if (completedVolumes === 0) {
          if (firstIllustrationError !== undefined) throw firstIllustrationError
          throw new NoUsableDownloadContentError('该作品没有可保存的插图')
        }
        return completedDownloadResult([...downloader.getWarnings(), ...warnings])
      }
      return completedDownloadResult(downloader.getWarnings())
    }, { operationId: preferredOperationId })
  })

  ipcMain.handle('shell:openExternal', (_event, rawUrl: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('shell.open-external', context, async () => {
      const url = validateExternalUrl(rawUrl)
      context.url = url
      await shell.openExternal(url)
    })
  })

  ipcMain.handle('shell:openFolder', (_event, rawTarget: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('shell.open-folder', context, async () => {
      const target = validateOpenFolder(rawTarget)
      context.target = target
      const rootPath = getDownloadRuntimeConfig(services).rootPath
      const folderPath = target === 'root'
        ? rootPath
        : resolveWithin(rootPath, target)
      context.folderPath = folderPath

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
  })

  ipcMain.handle('logs:open-directory', () => runLoggedOperation(
    'logs.open-directory',
    {},
    async () => {
      const directory = getLogDirectory()
      await mkdir(directory, { recursive: true })
      const error = await shell.openPath(directory)
      if (error) throw new Error(`打开日志目录失败: ${error}`)
    },
  ))

  ipcMain.handle('dialog:selectFolder', () => {
    const context: LogContext = {}
    return runLoggedOperation(
      'dialog.select-folder',
      context,
      async () => {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        if (result.canceled || result.filePaths.length === 0) {
          context.canceled = true
          return null
        }
        context.canceled = false
        context.folderPath = result.filePaths[0]
        return result.filePaths[0]
      },
    )
  })

  ipcMain.on('log:renderer-error', (event, report: unknown) => {
    rendererErrorReporter.report(event.sender.id, report)
  })
}
