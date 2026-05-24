import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { registerIpcHandlers } from './ipc-handlers'

function getIconPath(): string {
  // 开发环境：相对于 out/main/ 目录的路径
  const devPath = join(__dirname, '../../resources/icon.png')
  if (existsSync(devPath)) return devPath
  // 生产环境：extraResources 复制到 process.resourcesPath
  const prodPath = join(process.resourcesPath, 'icon.png')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '轻小说文库下载器',
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
