import { describe, expect, it } from 'vitest'
import { wenkuRequestCredentials } from '../wenku-network'

describe('Wenku network identity', () => {
  it('includes session cookies only for Wenku8 hosts', () => {
    expect(wenkuRequestCredentials('https://www.wenku8.net/index.php')).toBe('include')
    expect(wenkuRequestCredentials('https://img.wenku8.net/cover.jpg')).toBe('include')
    expect(wenkuRequestCredentials('https://wenku8.net.example/')).toBe('omit')
    expect(wenkuRequestCredentials('not a URL')).toBe('omit')
  })
})
