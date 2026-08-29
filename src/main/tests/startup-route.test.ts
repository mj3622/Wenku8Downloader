import { describe, expect, it, vi } from 'vitest'
import { resolveStartupRoute } from '../startup-route'

describe('resolveStartupRoute', () => {
  it('opens the project introduction once and persists that decision', () => {
    const config = {
      hasSeenProjectIntro: vi.fn(() => false),
      markProjectIntroSeen: vi.fn(),
    }

    expect(resolveStartupRoute(config)).toBe('/about')
    expect(config.markProjectIntroSeen).toHaveBeenCalledTimes(1)
  })

  it('opens discovery after the project introduction has been seen', () => {
    const config = {
      hasSeenProjectIntro: vi.fn(() => true),
      markProjectIntroSeen: vi.fn(),
    }

    expect(resolveStartupRoute(config)).toBe('/discover')
    expect(config.markProjectIntroSeen).not.toHaveBeenCalled()
  })

  it('still opens the introduction when persisting its marker fails', () => {
    const error = new Error('disk full')
    const onPersistenceError = vi.fn()
    const config = {
      hasSeenProjectIntro: vi.fn(() => false),
      markProjectIntroSeen: vi.fn(() => { throw error }),
    }

    expect(resolveStartupRoute(config, onPersistenceError)).toBe('/about')
    expect(onPersistenceError).toHaveBeenCalledWith(error)
  })
})
