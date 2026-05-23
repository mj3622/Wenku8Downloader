import { describe, it, expect } from 'vitest'
import { guessType } from './downloader'

describe('guessType', () => {
  it('returns jpeg for unknown extensions', () => {
    expect(guessType('unknown')).toBe('image/jpeg')
  })

  it('returns png for .png', () => {
    expect(guessType('png')).toBe('image/png')
  })

  it('returns gif for .gif', () => {
    expect(guessType('gif')).toBe('image/gif')
  })

  it('returns webp for .webp', () => {
    expect(guessType('webp')).toBe('image/webp')
  })

  it('returns svg for .svg', () => {
    expect(guessType('svg')).toBe('image/svg+xml')
  })

  it('handles uppercase extensions', () => {
    expect(guessType('PNG')).toBe('image/png')
    expect(guessType('JPG')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpg', () => {
    expect(guessType('jpg')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpeg', () => {
    expect(guessType('jpeg')).toBe('image/jpeg')
  })
})
