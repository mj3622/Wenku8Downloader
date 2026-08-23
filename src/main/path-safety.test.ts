import { describe, expect, it } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { imageExtensionFromUrl, resolveWithin, safePathSegment } from './path-safety'

describe('safePathSegment', () => {
  it('preserves ordinary Unicode titles', () => {
    expect(safePathSegment('第一卷 测试标题')).toBe('第一卷 测试标题')
  })

  it('removes path traversal and Windows-invalid characters', () => {
    const result = safePathSegment('../危险<卷>:"/\\|?*..')

    expect(result).not.toContain('..')
    expect(result).not.toMatch(/[<>:"/\\|?*]/)
    expect(result).not.toMatch(/[. ]$/)
  })

  it('avoids Windows reserved device names', () => {
    expect(safePathSegment('CON')).toBe('_CON')
    expect(safePathSegment('lpt1')).toBe('_lpt1')
  })

  it('uses a fallback when no usable characters remain', () => {
    expect(safePathSegment('...', 'untitled')).toBe('untitled')
  })
})

describe('resolveWithin', () => {
  it('resolves descendants below the declared root', () => {
    const root = join(tmpdir(), 'wenku8-downloads')
    const result = resolveWithin(root, 'novels', 'book.epub')

    expect(result).toBe(join(root, 'novels', 'book.epub'))
  })

  it('rejects paths that escape the declared root', () => {
    const root = join(tmpdir(), 'wenku8-downloads')

    expect(() => resolveWithin(root, '..', 'outside.epub')).toThrow('超出下载目录')
  })
})

describe('imageExtensionFromUrl', () => {
  it('ignores URL query strings and normalizes case', () => {
    expect(imageExtensionFromUrl('https://example.com/cover.PNG?token=secret')).toBe('png')
  })

  it('falls back to jpg for unsupported extensions', () => {
    expect(imageExtensionFromUrl('https://example.com/image.php?id=1')).toBe('jpg')
  })
})
