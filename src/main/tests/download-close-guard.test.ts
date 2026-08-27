import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: mocks.showMessageBox,
    showErrorBox: mocks.showErrorBox,
  },
}))

import { registerDownloadCloseGuard } from '../download-close-guard'

function createWindow() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
  })
}

function createCancelableCloseEvent() {
  return { preventDefault: vi.fn() }
}

function createManager() {
  return {
    hasActiveTasks: vi.fn(() => true),
    shutdown: vi.fn(async () => undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerDownloadCloseGuard', () => {
  it('flushes manager state before closing when no task is active', async () => {
    const window = createWindow()
    const manager = createManager()
    manager.hasActiveTasks.mockReturnValue(false)
    registerDownloadCloseGuard(window as never, manager)
    const event = createCancelableCloseEvent()

    window.emit('close', event)

    await vi.waitFor(() => expect(window.destroy).toHaveBeenCalledTimes(1))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    expect(manager.shutdown).toHaveBeenCalledTimes(1)
  })

  it('keeps downloading when the user cancels close confirmation', async () => {
    const window = createWindow()
    const manager = createManager()
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    registerDownloadCloseGuard(window as never, manager)
    const event = createCancelableCloseEvent()

    window.emit('close', event)
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalled())

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(manager.shutdown).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('shuts down downloads before destroying the confirmed window', async () => {
    const window = createWindow()
    const manager = createManager()
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    registerDownloadCloseGuard(window as never, manager)
    const event = createCancelableCloseEvent()

    window.emit('close', event)
    await vi.waitFor(() => expect(window.destroy).toHaveBeenCalledTimes(1))

    expect(manager.shutdown).toHaveBeenCalledTimes(1)
    expect(manager.shutdown.mock.invocationCallOrder[0])
      .toBeLessThan(window.destroy.mock.invocationCallOrder[0])
  })

  it('does not open duplicate close prompts', async () => {
    const window = createWindow()
    const manager = createManager()
    let resolvePrompt!: (value: { response: number }) => void
    mocks.showMessageBox.mockReturnValue(new Promise((resolve) => {
      resolvePrompt = resolve
    }))
    registerDownloadCloseGuard(window as never, manager)

    window.emit('close', createCancelableCloseEvent())
    window.emit('close', createCancelableCloseEvent())
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1)

    resolvePrompt({ response: 0 })
    await vi.waitFor(() => expect(manager.shutdown).not.toHaveBeenCalled())
  })

  it('keeps the window open and explains a shutdown failure', async () => {
    const window = createWindow()
    const manager = createManager()
    manager.hasActiveTasks.mockReturnValue(false)
    manager.shutdown.mockRejectedValue(new Error('disk unavailable'))
    registerDownloadCloseGuard(window as never, manager)

    window.emit('close', createCancelableCloseEvent())

    await vi.waitFor(() => expect(mocks.showErrorBox).toHaveBeenCalledTimes(1))
    expect(window.destroy).not.toHaveBeenCalled()
    expect(mocks.showErrorBox).toHaveBeenCalledWith(
      '无法退出',
      '下载状态未能安全保存，请检查磁盘或数据目录权限后重试。',
    )
  })
})
