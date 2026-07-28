import { describe, expect, it } from 'vitest'
import { filterWenku8ImageUrls, normalizeWenku8ImageUrl } from './crawler'

describe('normalizeWenku8ImageUrl', () => {
  it('accepts and upgrades the Wenku8 image CDN', () => {
    expect(normalizeWenku8ImageUrl('http://img.wenku8.com/image/1.jpg'))
      .toBe('https://img.wenku8.com/image/1.jpg')
  })

  it('accepts Wenku8 subdomains', () => {
    expect(normalizeWenku8ImageUrl('https://www.wenku8.net/image/cover.jpg'))
      .toBe('https://www.wenku8.net/image/cover.jpg')
  })

  it('accepts the current Wenku8 illustration CDN', () => {
    expect(normalizeWenku8ImageUrl('https://pic.777743.xyz/1/1269/40162/48046.jpg'))
      .toBe('https://pic.777743.xyz/1/1269/40162/48046.jpg')
  })

  it('rejects unrelated hosts', () => {
    expect(() => normalizeWenku8ImageUrl('https://example.com/image.jpg'))
      .toThrow('拒绝访问非轻小说文库地址')
    expect(() => normalizeWenku8ImageUrl('https://609999.xyz/wenku8/ai_1.gif'))
      .toThrow('拒绝访问非轻小说文库地址')
  })

  it('filters advertising images while retaining Wenku8 illustrations', () => {
    expect(filterWenku8ImageUrls([
      'https://609999.xyz/wenku8/ai_1.gif',
      'https://pic.777743.xyz/1/1269/40162/48046.jpg',
    ])).toEqual([
      'https://pic.777743.xyz/1/1269/40162/48046.jpg',
    ])
  })
})
