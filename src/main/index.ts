import { app, BrowserWindow, dialog, Menu } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { initializeAppServices, type AppServices } from './app-services'
import { registerDownloadCloseGuard } from './download-close-guard'
import { registerIpcHandlers } from './ipc-handlers'
import { DEFAULT_LOG_CONFIG } from './config/config-schema'
import { registerAppLogging, registerProcessLogging, registerWebContentsLogging } from './logging/electron-events'
import { initializeLogger, logger } from './logging/logger'
import { sanitizeLogLine } from './logging/redaction'
import { registerSingleInstanceGuard } from './single-instance'

try {
  app.setAppLogsPath()
  initializeLogger({
    directory: app.getPath('logs'),
    config: DEFAULT_LOG_CONFIG,
    source: 'main',
    development: process.env.NODE_ENV === 'development',
  })
} catch (error) {
  try {
    process.stderr.write(`日志系统初始化失败: ${sanitizeLogLine(error)}\n`)
  } catch {
    // Startup must continue even when both logging paths are unavailable.
  }
}

logger.info('app.starting', '应用开始启动', {
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
})
registerProcessLogging(process)
registerAppLogging(app)

function getIconPath(): string {
  // 开发环境：相对于 out/main/ 目录的路径
  const devPath = join(__dirname, '../../resources/icon.png')
  if (existsSync(devPath)) return devPath
  // 生产环境：extraResources 复制到 process.resourcesPath
  const prodPath = join(process.resourcesPath, 'icon.png')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

function createWindow(services: AppServices): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '轻小说文库下载器',
    icon: getIconPath(),
    webPreferences: {
      session: services.networkSession,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  registerDownloadCloseGuard(mainWindow, services.downloads)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  registerWebContentsLogging(mainWindow.webContents, mainWindow.id)

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!registerSingleInstanceGuard()) {
  app.quit()
} else {
  let services: AppServices | undefined
  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      Menu.setApplicationMenu(null)
    }
    services = await initializeAppServices()
    registerIpcHandlers(services)
    createWindow(services)
  }).catch((error) => {
    logger.error('app.startup-failed', '应用启动失败', error)
    dialog.showErrorBox(
      '启动失败',
      '应用数据或登录状态无法初始化，请检查数据目录权限后重启应用。',
    )
    app.quit()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    services?.stopCacheMaintenance()
  })
}
