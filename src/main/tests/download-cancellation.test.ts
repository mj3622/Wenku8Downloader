import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DownloadCancelledError,
  sleepWithSignal,
  throwIfDownloadCancelled,
  withRequestTimeout,
} from '../download-cancellation'

afterEach(() => {
  vi.useRealTimers()
})

describe('download cancellation', () => {
  it('throws the domain cancellation error for an aborted signal', () => {
    const controller = new AbortController()
    controller.abort()

    expect(() => throwIfDownloadCancelled(controller.signal))
      .toThrow(DownloadCancelledError)
  })

  it('rejects an abortable delay without leaving a timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const waiting = sleepWithSignal(8_000, controller.signal)

    controller.abort()

    await expect(waiting).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves an abortable delay normally and removes its listener', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const waiting = sleepWithSignal(100, controller.signal)

    await vi.advanceTimersByTimeAsync(100)

    await expect(waiting).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('preserves a parent abort through the timeout signal', () => {
    const controller = new AbortController()
    const signal = withRequestTimeout(controller.signal, 30_000)

    controller.abort()

    expect(signal.aborted).toBe(true)
  })
})
