import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { ElectronCloudflareChallengeSolver } from '../cloudflare-challenge'

function createHarness(timeoutMs = 1_000) {
  const cookieEvents = new EventEmitter()
  const windowEvents = new EventEmitter()
  const webContentsEvents = new EventEmitter()
  const cookies = {
    get: vi.fn(async () => [{
      name: 'cf_clearance',
      value: 'fresh-clearance',
      domain: '.wenku8.net',
    }]),
    on: cookieEvents.on.bind(cookieEvents),
    removeListener: cookieEvents.removeListener.bind(cookieEvents),
  }
  let destroyed = false
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async () => true),
      on: webContentsEvents.on.bind(webContentsEvents),
      removeListener: webContentsEvents.removeListener.bind(webContentsEvents),
    },
    loadURL: vi.fn(async () => undefined),
    show: vi.fn(),
    close: vi.fn(() => {
      destroyed = true
      windowEvents.emit('closed')
    }),
    isDestroyed: vi.fn(() => destroyed),
    on: windowEvents.on.bind(windowEvents),
    once: windowEvents.once.bind(windowEvents),
    removeListener: windowEvents.removeListener.bind(windowEvents),
  }
  const createWindow = vi.fn(() => window)
  const solver = new ElectronCloudflareChallengeSolver({
    cookies,
    createWindow,
    timeoutMs,
  })
  return {
    solver,
    cookies,
    window,
    createWindow,
    cookieEvents,
    windowEvents,
    webContentsEvents,
  }
}

describe('ElectronCloudflareChallengeSolver', () => {
  it('finishes when the existing clearance cookie opens the Wenku8 homepage', async () => {
    const harness = createHarness()

    const solving = harness.solver.solve()
    await vi.waitFor(() => expect(harness.window.loadURL).toHaveBeenCalledTimes(1))
    harness.webContentsEvents.emit('did-finish-load')
    await expect(solving).resolves.toBeUndefined()
    expect(harness.cookies.get).toHaveBeenCalledWith({
      name: 'cf_clearance',
    })
    expect(harness.window.loadURL).toHaveBeenCalledTimes(1)
    expect(harness.window.webContents.executeJavaScript).toHaveBeenCalledWith(
      "Boolean(document.querySelector('.block .blocktitle'))",
    )
    expect(harness.window.close).toHaveBeenCalledTimes(1)
    expect(harness.createWindow).toHaveBeenCalledTimes(1)
  })

  it('ignores same-named cookies that are not usable for Wenku8', async () => {
    const harness = createHarness()

    const solving = harness.solver.solve()
    await vi.waitFor(() => expect(harness.window.loadURL).toHaveBeenCalledTimes(1))
    harness.cookieEvents.emit('changed', {}, {
      name: 'cf_clearance',
      value: 'unrelated-clearance',
      domain: '.cloudflare.com',
    }, 'explicit', false)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(harness.cookies.get).not.toHaveBeenCalled()
    expect(harness.window.close).not.toHaveBeenCalled()

    harness.windowEvents.emit('closed')
    await expect(solving).rejects.toThrow('安全验证未完成')
  })

  it('rejects when the verification window is closed before clearance is available', async () => {
    const harness = createHarness()

    const solving = harness.solver.solve()
    await vi.waitFor(() => expect(harness.window.loadURL).toHaveBeenCalledTimes(1))
    harness.windowEvents.emit('closed')

    await expect(solving).rejects.toThrow('安全验证未完成')
  })

  it('returns an actionable error instead of waiting indefinitely', async () => {
    const harness = createHarness(10)

    await expect(harness.solver.solve()).rejects.toThrow(
      '网站安全验证暂时无法完成，请更换网络线路或稍后重试',
    )
    expect(harness.window.close).toHaveBeenCalledTimes(1)
  })

  it('shares one verification window between concurrent challenge requests', async () => {
    const harness = createHarness()

    const first = harness.solver.solve()
    const second = harness.solver.solve()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(harness.window.loadURL).toHaveBeenCalledTimes(1))

    harness.webContentsEvents.emit('did-finish-load')
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(harness.createWindow).toHaveBeenCalledTimes(1)
  })
})
