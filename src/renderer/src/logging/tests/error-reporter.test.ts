// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { installRendererErrorReporter } from '../error-reporter'

describe('installRendererErrorReporter', () => {
  it('forwards window errors and promise rejections with fixed fields', () => {
    const report = vi.fn()
    const remove = installRendererErrorReporter(window, report)

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'render failed',
      error: new Error('render failed'),
      filename: 'file:///app.js',
      lineno: 12,
      colno: 3,
    }))
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: new Error('async failed') })
    window.dispatchEvent(rejection)

    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'render failed',
      source: 'file:///app.js',
      line: 12,
      column: 3,
    }))
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'unhandled-rejection',
      message: 'async failed',
    }))

    remove()
    window.dispatchEvent(new ErrorEvent('error', { message: 'after remove' }))
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('does not throw when a rejection reason cannot be converted to text', () => {
    let rejectionListener: ((event: Event) => void) | undefined
    const target = {
      addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
        if (type === 'unhandledrejection') rejectionListener = listener
      }),
      removeEventListener: vi.fn(),
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>
    const report = vi.fn()
    installRendererErrorReporter(target, report)
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', {
      value: {
        [Symbol.toPrimitive]() {
          throw new Error('conversion failed')
        },
      },
    })

    expect(() => rejectionListener?.(rejection)).not.toThrow()
    expect(report).toHaveBeenCalledWith({
      kind: 'unhandled-rejection',
      message: 'Unknown rejection',
      stack: undefined,
    })
  })
})
