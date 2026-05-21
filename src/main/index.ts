import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'

let pythonProcess: ChildProcess | null = null
let pythonPort = 52525

function startPythonServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const cwd = app.isPackaged
      ? join(process.resourcesPath, '..')
      : join(__dirname, '..', '..')

    const proc = spawn(
      'python3',
      ['-c', 'from tools.api_server import start_server; port = start_server(52525); print(f"API_READY:{port}", flush=True); import time; time.sleep(999999)'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    )

    pythonProcess = proc

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      // 匹配 API_READY:PORT 信号
      const match = line.match(/API_READY:(\d+)/)
      if (match) {
        pythonPort = parseInt(match[1], 10)
        resolve(pythonPort)
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      console.error('[Python]', data.toString().trim())
    })

    proc.on('error', (err) => reject(err))
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`Python process exited with code ${code}`)
      }
    })

    // 超时处理
    setTimeout(() => reject(new Error('Python 服务启动超时')), 15000)
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '轻小说文库下载器',
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

app.whenReady().then(async () => {
  try {
    await startPythonServer()
    console.log(`Python API server ready on port ${pythonPort}`)
  } catch (err) {
    console.error('Failed to start Python server:', err)
  }
  createWindow()
})

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
  app.quit()
})

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
})

// IPC: 向渲染进程提供 API 端口
ipcMain.handle('get-api-port', () => pythonPort)
