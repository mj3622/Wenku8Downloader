import { logger } from './logger'

export interface LoggingEventTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

function objectContext(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {}
  try {
    return { ...(value as Record<string, unknown>) }
  } catch {
    return {}
  }
}

export function registerProcessLogging(target: LoggingEventTarget): void {
  target.on('uncaughtExceptionMonitor', (...args) => {
    const [error, origin] = args
    logger.error('process.uncaught-exception', '主进程出现未捕获异常', error, {
      origin,
    })
  })
  target.on('unhandledRejection', (...args) => {
    const [reason] = args
    logger.error('process.unhandled-rejection', '主进程出现未处理的 Promise 拒绝', reason, undefined)
  })
}

export function registerAppLogging(target: LoggingEventTarget): void {
  target.on('before-quit', () => {
    logger.info('app.before-quit', '应用准备退出')
  })
  target.on('child-process-gone', (...args) => {
    const details = objectContext(args[1])
    logger.error(
      'app.child-process-gone',
      'Electron 子进程异常退出',
      new Error(`Child process gone: ${String(details.reason ?? 'unknown')}`),
      details,
    )
  })
}

export function registerWebContentsLogging(
  target: LoggingEventTarget,
  windowId?: number,
): void {
  if (windowId !== undefined) {
    logger.info('window.created', '应用窗口已创建', { windowId })
  }
  target.on('render-process-gone', (...args) => {
    const details = objectContext(args[1])
    logger.error(
      'renderer.process-gone',
      '渲染进程异常退出',
      new Error(`Renderer process gone: ${String(details.reason ?? 'unknown')}`),
      details,
      'renderer',
    )
  })
  target.on('did-fail-load', (...args) => {
    const errorCode = typeof args[1] === 'number' ? args[1] : 0
    const errorDescription = typeof args[2] === 'string' ? args[2] : 'Unknown load error'
    const url = typeof args[3] === 'string' ? args[3] : ''
    const isMainFrame = args[4] === true
    if (!isMainFrame) return
    logger.error(
      'renderer.load-failed',
      '渲染页面加载失败',
      new Error(`${errorDescription} (${errorCode})`),
      { errorCode, url },
      'renderer',
    )
  })
}
