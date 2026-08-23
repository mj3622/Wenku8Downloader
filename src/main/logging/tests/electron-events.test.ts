import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../logger', () => ({ logger: logMocks }))

import {
  registerAppLogging,
  registerProcessLogging,
  registerWebContentsLogging,
} from '../electron-events'

describe('Electron lifecycle logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs process failures with the original errors', () => {
    const target = new EventEmitter()
    registerProcessLogging(target)
    const fatal = new Error('startup exploded')
    const rejected = new Error('promise rejected')

    target.emit('uncaughtExceptionMonitor', fatal, 'uncaughtException')
    target.emit('unhandledRejection', rejected, Promise.resolve())

    expect(logMocks.error).toHaveBeenCalledWith(
      'process.uncaught-exception',
      expect.any(String),
      fatal,
      { origin: 'uncaughtException' },
    )
    expect(logMocks.error).toHaveBeenCalledWith(
      'process.unhandled-rejection',
      expect.any(String),
      rejected,
      undefined,
    )
  })

  it('logs app lifecycle and child-process failures', () => {
    const target = new EventEmitter()
    registerAppLogging(target)

    target.emit('before-quit')
    target.emit('child-process-gone', {}, {
      type: 'Utility',
      reason: 'crashed',
      exitCode: 9,
      serviceName: 'network',
      name: 'Network Service',
    })

    expect(logMocks.info).toHaveBeenCalledWith('app.before-quit', expect.any(String))
    expect(logMocks.error).toHaveBeenCalledWith(
      'app.child-process-gone',
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ type: 'Utility', reason: 'crashed', exitCode: 9 }),
    )
  })

  it('logs renderer exits and main-frame load failures', () => {
    const target = new EventEmitter()
    registerWebContentsLogging(target, 42)

    target.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    target.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://example.test/app', true)
    target.emit('did-fail-load', {}, -3, 'ABORTED', 'https://example.test/frame', false)

    expect(logMocks.error).toHaveBeenCalledWith(
      'renderer.process-gone',
      expect.any(String),
      expect.any(Error),
      { reason: 'crashed', exitCode: 1 },
      'renderer',
    )
    expect(logMocks.error).toHaveBeenCalledWith(
      'renderer.load-failed',
      expect.any(String),
      expect.any(Error),
      { errorCode: -105, url: 'https://example.test/app' },
      'renderer',
    )
    expect(logMocks.error).toHaveBeenCalledTimes(2)
    expect(logMocks.info).toHaveBeenCalledWith(
      'window.created',
      expect.any(String),
      { windowId: 42 },
    )
  })

  it('does not let hostile Electron detail objects escape event handlers', () => {
    const target = new EventEmitter()
    const hostileDetails = new Proxy({}, {
      ownKeys() {
        throw new Error('details failed')
      },
    })
    registerWebContentsLogging(target)

    expect(() => target.emit('render-process-gone', {}, hostileDetails)).not.toThrow()
    expect(logMocks.error).toHaveBeenCalledWith(
      'renderer.process-gone',
      expect.any(String),
      expect.any(Error),
      {},
      'renderer',
    )
  })
})
