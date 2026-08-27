import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestSingleInstanceLock: vi.fn(),
  on: vi.fn(),
  getAllWindows: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: mocks.requestSingleInstanceLock,
    on: mocks.on,
  },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}))

import { registerSingleInstanceGuard } from '../single-instance'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAllWindows.mockReturnValue([])
})

describe('registerSingleInstanceGuard', () => {
  it('does not register a second-instance listener without the lock', () => {
    mocks.requestSingleInstanceLock.mockReturnValue(false)

    expect(registerSingleInstanceGuard()).toBe(false)
    expect(mocks.on).not.toHaveBeenCalled()
  })

  it('restores and focuses the existing window for a second launch', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    mocks.requestSingleInstanceLock.mockReturnValue(true)
    mocks.getAllWindows.mockReturnValue([window])

    expect(registerSingleInstanceGuard()).toBe(true)
    const listener = mocks.on.mock.calls.find(([event]) => event === 'second-instance')?.[1]
    listener?.()

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
