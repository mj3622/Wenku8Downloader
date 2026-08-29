import { app, BrowserWindow } from 'electron'

export function registerSingleInstanceGuard(): boolean {
  if (!app.requestSingleInstanceLock()) return false

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  return true
}
