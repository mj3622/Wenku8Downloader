import { describe, expect, it } from 'vitest'
import { normalizeProxyUrl, redactProxyUrl } from './config-manager'

describe('proxy configuration', () => {
  it.each([
    'http://127.0.0.1:8080',
    'https://proxy.example:8443',
    'socks5://127.0.0.1:1080',
    'socks5h://proxy.example:1080',
  ])('accepts supported proxy URL %s', (value) => {
    expect(normalizeProxyUrl(value)).toBe(new URL(value).toString())
  })

  it('accepts credentials but redacts them from public output', () => {
    const value = normalizeProxyUrl('socks5://user:secret@proxy.example:1080')
    expect(redactProxyUrl(value)).toEqual({
      url: 'socks5://proxy.example:1080',
      hasCredentials: true,
    })
  })

  it.each([
    'ftp://proxy.example:21',
    'http://proxy.example:8080/path',
    'http://proxy.example:8080?token=secret',
    'not-a-url',
  ])('rejects invalid proxy URL %s', (value) => {
    expect(() => normalizeProxyUrl(value)).toThrow()
  })

  it('treats an empty value as disabled proxy data', () => {
    expect(normalizeProxyUrl('')).toBe('')
    expect(redactProxyUrl('')).toEqual({ url: '', hasCredentials: false })
  })
})
