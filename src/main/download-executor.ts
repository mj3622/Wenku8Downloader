import type { Book } from './book'
import type { ConfigService } from './config/config-service'
import {
  Downloader,
  NoUsableDownloadContentError,
  resolveDownloadRoot,
  type DownloaderBook,
  type DownloaderCrawler,
  type DownloaderOptions,
  type DownloadProgress,
  type DownloadRuntimeConfig,
} from './downloader'
import {
  DownloadCancelledError,
  throwIfDownloadCancelled,
} from './download-cancellation'
import { logger } from './logging/logger'
import type { DownloadTask } from '../shared/ipc-types'

export interface DownloadExecutionContext {
  signal: AbortSignal
  onProgress(progress: DownloadProgress): void
}

export interface DownloadExecutionResult {
  warnings: string[]
}

export interface DownloadExecutor {
  execute(
    task: DownloadTask,
    context: DownloadExecutionContext,
  ): Promise<DownloadExecutionResult>
}

export type DownloadExecutorBook = DownloaderBook & Pick<Book, 'pictureUrls'>

export interface DownloadRunner {
  setOnProgress(callback: (progress: DownloadProgress) => void): void
  downloadNovel(book: DownloaderBook, volumeName?: string): Promise<void>
  downloadPictures(
    urls: string[],
    volumeName: string,
    novelName: string,
    bookId: string,
    volumeIndex?: number,
  ): Promise<void>
  getWarnings(): string[]
}

interface DownloadExecutorDependencies {
  config: Pick<ConfigService, 'getDownloadSnapshot'>
  crawler: DownloaderCrawler
  loadBook(bookId: string, signal: AbortSignal): Promise<DownloadExecutorBook>
  environment: {
    isPackaged: boolean
    downloadsPath: string
    devRoot: string
  }
  createDownloader?: (
    crawler: DownloaderCrawler,
    runtimeConfig: DownloadRuntimeConfig,
    options: DownloaderOptions,
  ) => DownloadRunner
}

const GENERIC_DOWNLOAD_ERROR = '下载未能完成，请检查网络和下载设置后重试。'
const GENERIC_DOWNLOAD_WARNING = '部分附加内容未能保存，正文或其他已完成内容仍然可用。'
const TECHNICAL_DETAIL = /(?:Error invoking remote method|\bIPC\b|\bCookie\b|(?:https?|file):\/\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\|[?&](?:token|key|signature|authorization|password|secret)=|\b(?:Authorization|Bearer|ENOTFOUND|ECONN\w*|ETIMEDOUT)\b|\n\s*at\s)/i
const SAFE_WARNING_FORMS = [
  /^封面未能下载，正文内容仍已保存。$/,
  /^“[^”\r\n]{1,200}”有 \d{1,6} 张插图未能下载，已保存其余(?:插图|内容)。$/,
  /^“[^”\r\n]{1,200}”的插图(?:未能下载|未能获取)，正文内容仍会保存。$/,
  /^“[^”\r\n]{1,200}”的插图页无法读取，(?:正文内容仍会保存|已跳过该卷)。$/,
  /^“[^”\r\n]{1,200}”没有可保存的插图。$/,
]

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  return typeof error === 'string' ? error.trim() : ''
}

export function toSafeDownloadErrorMessage(error: unknown): string {
  const message = rawErrorMessage(error)
  if (
    /(?:\bHTTP\s*403\b|访问被拒绝|cookie.{0,20}(?:过期|失效)|登录状态.{0,12}(?:过期|失效))/i.test(message)
  ) {
    return '请前往配置页重新登录，然后再试一次。'
  }
  if (/(?:\bHTTP\s*429\b|too many requests|(?:请求|操作).{0,8}(?:过于频繁|太频繁))/i.test(message)) {
    return '请稍等一会儿再试。'
  }
  if (/(?:ENOSPC|disk full|磁盘.{0,8}(?:已满|空间不足)|存储空间不足)/i.test(message)) {
    return '请清理磁盘空间或更换下载目录后重试。'
  }
  if (/(?:EACCES|EPERM|permission denied|没有权限|无权限)/i.test(message)) {
    return '请选择有写入权限的下载目录后重试。'
  }
  if (
    error instanceof NoUsableDownloadContentError
    && message.length <= 300
    && !TECHNICAL_DETAIL.test(message)
  ) {
    return message
  }
  return GENERIC_DOWNLOAD_ERROR
}

export function toSafeDownloadWarningMessage(warning: unknown): string {
  if (typeof warning !== 'string') return GENERIC_DOWNLOAD_WARNING
  const message = warning.trim()
  if (
    message.length === 0
    || message.length > 500
    || TECHNICAL_DETAIL.test(message)
    || !SAFE_WARNING_FORMS.some((pattern) => pattern.test(message))
  ) {
    return GENERIC_DOWNLOAD_WARNING
  }
  return message
}

export function createDownloadExecutor(
  dependencies: DownloadExecutorDependencies,
): DownloadExecutor {
  const createRunner = dependencies.createDownloader
    ?? ((crawler, runtimeConfig, options) => new Downloader(crawler, runtimeConfig, options))

  return {
    async execute(task, context) {
      throwIfDownloadCancelled(context.signal)
      const downloadConfig = dependencies.config.getDownloadSnapshot()
      const runtimeConfig: DownloadRuntimeConfig = {
        ...downloadConfig,
        rootPath: resolveDownloadRoot(downloadConfig, dependencies.environment),
      }
      const book = await dependencies.loadBook(task.bookId, context.signal)
      throwIfDownloadCancelled(context.signal)
      const downloader = createRunner(dependencies.crawler, runtimeConfig, {
        logContext: { operationId: task.id, taskId: task.id },
        signal: context.signal,
      })
      downloader.setOnProgress(context.onProgress)

      if (task.type === 'epub_full' || task.type === 'epub_volume') {
        if (task.volume && !book.volumes[task.volume]) {
          throw new Error(`未找到卷: ${task.volume}`)
        }
        await downloader.downloadNovel(book, task.type === 'epub_volume' ? task.volume : undefined)
        return { warnings: downloader.getWarnings() }
      }

      if (task.volume) {
        const volumeIndex = Object.keys(book.volumes).indexOf(task.volume)
        const urls = await book.getChapterImageUrls(task.volume, context.signal)
        throwIfDownloadCancelled(context.signal)
        if (volumeIndex < 0 || !urls?.length) {
          throw new NoUsableDownloadContentError(`该卷没有可保存的插图: ${task.volume}`)
        }
        await downloader.downloadPictures(
          urls,
          task.volume,
          book.basicInfo['标题'],
          book.bookId,
          volumeIndex,
        )
        return { warnings: downloader.getWarnings() }
      }

      const volumes = Object.keys(book.pictureUrls)
      if (volumes.length === 0) {
        throw new NoUsableDownloadContentError('该作品没有可保存的插图')
      }
      const warnings: string[] = []
      let firstIllustrationError: unknown
      let completedVolumes = 0
      for (const volume of volumes) {
        throwIfDownloadCancelled(context.signal)
        let urls: string[] | null
        try {
          urls = await book.getChapterImageUrls(volume, context.signal)
        } catch (error) {
          throwIfDownloadCancelled(context.signal)
          if (error instanceof DownloadCancelledError) throw error
          firstIllustrationError ??= error
          logger.error(
            'download.illustration-page.failed',
            '插图页读取失败，继续处理其他分卷',
            error,
            { taskId: task.id, bookId: task.bookId, volumeName: volume },
          )
          warnings.push(`“${volume}”的插图页无法读取，已跳过该卷。`)
          continue
        }
        throwIfDownloadCancelled(context.signal)
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
          throwIfDownloadCancelled(context.signal)
          if (error instanceof DownloadCancelledError) throw error
          if (!(error instanceof NoUsableDownloadContentError)) throw error
          warnings.push(`“${volume}”没有可保存的插图。`)
        }
      }
      if (completedVolumes === 0) {
        if (firstIllustrationError !== undefined) throw firstIllustrationError
        throw new NoUsableDownloadContentError('该作品没有可保存的插图')
      }
      return { warnings: [...downloader.getWarnings(), ...warnings] }
    },
  }
}
