import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { CookieService } from './cookie-service'
import {
  validateCredentialsInput,
  type ConfigService,
} from './config/config-service'
import { validateDownloadConfig, validateLogConfig } from './config/config-schema'
import type { WebCrawler } from './crawler'
import { resolveDownloadRoot, type DownloadRuntimeConfig } from './downloader'
import type { DownloadManager } from './download-manager'
import type { DownloadExecutorBook } from './download-executor'
import { resolveWithin } from './path-safety'
import {
  validateBookId,
  validateDiscoveryHomePayload,
  validateDiscoveryRankingPayload,
  validateDownloadHistoryScope,
  validateDownloadTaskId,
  validateEnqueueDownloadInput,
  validateExternalUrl,
  validateLoginOperationId,
  validateOpenFolder,
  validateSearchQuery,
  validateVolumeNames,
} from './ipc-validation'
import type { LogContext } from './logging/file-logger'
import {
  configureLogger,
  getLogDirectory,
  getLogStats,
  logger,
} from './logging/logger'
import { RendererErrorReporter } from './logging/renderer-error-reporter'
import type { BookGetOptions } from './book-service'
import type { CacheClearResult } from '../shared/ipc-types'
import type { DiscoveryService } from './discovery-service'

function requirePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求参数格式无效')
  }
  return value as Record<string, unknown>
}

export type IpcBook = DownloadExecutorBook

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
  discovery: Pick<DiscoveryService, 'getHome' | 'getRanking'>
  books: {
    get(bookId: string, options?: BookGetOptions): Promise<IpcBook>
  }
  clearCache(): Promise<CacheClearResult>
  invalidateBookCache(): Promise<void>
  resolveVolumeCovers(bookId: string, volumes: string[]): Promise<Record<string, string>>
  downloads: Pick<
    DownloadManager,
    | 'getSnapshot'
    | 'enqueue'
    | 'cancel'
    | 'retry'
    | 'remove'
    | 'clearHistory'
    | 'importLegacyHistory'
    | 'subscribe'
  >
}

function validateBookGetPayload(value: unknown): { bookId: string; revalidate: boolean } {
  const payload = requirePayload(value)
  const keys = Object.keys(payload)
  if (keys.some(key => key !== 'bookId' && key !== 'revalidate')) {
    throw new Error('请求参数格式无效')
  }
  if (payload.revalidate !== undefined && typeof payload.revalidate !== 'boolean') {
    throw new Error('请求参数格式无效')
  }
  return {
    bookId: validateBookId(payload.bookId),
    revalidate: payload.revalidate === true,
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
  services.downloads.subscribe((stateEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      try {
        window.webContents.send('download:state-changed', stateEvent)
      } catch {
        // A closing renderer must not affect downloads in the main process.
      }
    }
  })

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
        await services.invalidateBookCache()
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
        await services.invalidateBookCache()
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
        await service.acquire((progress) => {
          event.sender.send('cookie:progress', { ...progress, operationId })
        })
        await services.invalidateBookCache()
        return { status: 'ok', message: '登录成功，登录状态已更新' }
      },
      { operationId },
    )
  })

  ipcMain.handle('search:author', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('search.author', context, async () => {
      const query = validateSearchQuery(requirePayload(rawPayload).query)
      const results = await services.crawler.search(query, 'author')
      context.resultCount = results.length
      return { results }
    })
  })

  ipcMain.handle('search:title', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('search.title', context, async () => {
      const query = validateSearchQuery(requirePayload(rawPayload).query)
      const results = await services.crawler.search(query, 'title')
      context.resultCount = results.length
      return { results }
    })
  })

  ipcMain.handle('discovery:get-home', (_event, rawPayload: unknown) => {
    const { refresh } = validateDiscoveryHomePayload(rawPayload)
    const context: LogContext = { refresh }
    return runLoggedOperation('discovery.home', context, async () => {
      const result = await services.discovery.getHome({ refresh })
      context.resultCount = result.sections.reduce((sum, section) => sum + section.books.length, 0)
      context.stale = result.stale
      return result
    })
  })

  ipcMain.handle('discovery:get-ranking', (_event, rawPayload: unknown) => {
    const { type, page, refresh } = validateDiscoveryRankingPayload(rawPayload)
    const context: LogContext = { rankingType: type, page, refresh }
    return runLoggedOperation('discovery.ranking', context, async () => {
      const result = await services.discovery.getRanking(type, page, { refresh })
      context.resultCount = result.books.length
      context.stale = result.stale
      return result
    })
  })

  ipcMain.handle('book:get', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('book.get', context, async () => {
      const { bookId, revalidate } = validateBookGetPayload(rawPayload)
      context.bookId = bookId
      context.revalidate = revalidate
      const book = await services.books.get(bookId, { revalidate })
      context.title = book.basicInfo['标题']
      context.volumeCount = Object.keys(book.volumes).length
      return {
        book_id: book.bookId,
        basic_info: book.basicInfo,
        volumes: book.volumes,
      }
    })
  })

  ipcMain.handle('cache:clear', (_event, rawPayload: unknown) => {
    if (rawPayload !== undefined) throw new Error('请求参数格式无效')
    return runLoggedOperation('cache.clear', {}, () => services.clearCache())
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

  ipcMain.handle('book:volume-covers', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('book.volume-covers', context, async () => {
      const payload = requirePayload(rawPayload)
      const bookId = validateBookId(payload.bookId)
      const volumes = validateVolumeNames(payload.volumes)
      Object.assign(context, { bookId, volumeCount: volumes.length })
      return { covers: await services.resolveVolumeCovers(bookId, volumes) }
    })
  })

  ipcMain.handle('download:get-snapshot', () => runLoggedOperation(
    'download.get-snapshot',
    {},
    () => services.downloads.getSnapshot(),
    { logStart: false, logSuccess: false },
  ))

  ipcMain.handle('download:enqueue', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('download.enqueue', context, () => {
      const input = validateEnqueueDownloadInput(requirePayload(rawPayload))
      Object.assign(context, { bookId: input.bookId, type: input.type, volumeName: input.volume })
      return services.downloads.enqueue(input)
    })
  })

  for (const [channel, eventName, command] of [
    ['download:cancel', 'download.cancel', services.downloads.cancel],
    ['download:retry', 'download.retry', services.downloads.retry],
    ['download:remove', 'download.remove', services.downloads.remove],
  ] as const) {
    ipcMain.handle(channel, (_event, rawPayload: unknown) => {
      const context: LogContext = {}
      return runLoggedOperation(eventName, context, () => {
        const taskId = validateDownloadTaskId(requirePayload(rawPayload).taskId)
        context.taskId = taskId
        return command.call(services.downloads, taskId)
      })
    })
  }

  ipcMain.handle('download:clear-history', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('download.clear-history', context, () => {
      const scope = validateDownloadHistoryScope(requirePayload(rawPayload).scope)
      context.scope = scope
      return services.downloads.clearHistory(scope)
    })
  })

  ipcMain.handle('download:import-legacy-history', (_event, rawPayload: unknown) => {
    const context: LogContext = {}
    return runLoggedOperation('download.import-legacy-history', context, () => {
      const tasks = requirePayload(rawPayload).tasks
      if (!Array.isArray(tasks) || tasks.length > 5_000) {
        throw new Error('旧下载历史格式无效')
      }
      context.taskCount = tasks.length
      return services.downloads.importLegacyHistory(tasks)
    })
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

  ipcMain.handle('logs:get-stats', () => runLoggedOperation(
    'logs.get-stats',
    {},
    () => getLogStats(),
    { logStart: false, logSuccess: false },
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
