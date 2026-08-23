import { describe, expect, it } from 'vitest'
import {
  validateBookId,
  validateExternalUrl,
  validateOpenFolder,
  validateSearchQuery,
} from './ipc-validation'

describe('IPC validation', () => {
  it('accepts numeric book IDs and rejects path-like values', () => {
    expect(validateBookId('3057')).toBe('3057')
    expect(() => validateBookId('../3057')).toThrow('作品编号')
    expect(() => validateBookId('3057.htm')).toThrow('作品编号')
  })

  it('trims bounded search queries', () => {
    expect(validateSearchQuery('  测试作品  ')).toBe('测试作品')
    expect(() => validateSearchQuery('')).toThrow('搜索内容')
    expect(() => validateSearchQuery('x'.repeat(101))).toThrow('搜索内容')
  })

  it('allows only known external HTTPS destinations', () => {
    expect(validateExternalUrl('https://github.com/mj3622/Wenku8Downloader')).toContain('github.com')
    expect(() => validateExternalUrl('http://github.com/mj3622')).toThrow('外部链接')
    expect(() => validateExternalUrl('https://evil.example')).toThrow('外部链接')
    expect(() => validateExternalUrl('file:///C:/Windows/System32')).toThrow('外部链接')
  })

  it('allows only the two download subfolders', () => {
    expect(validateOpenFolder('pics')).toBe('pics')
    expect(validateOpenFolder('novels')).toBe('novels')
    expect(() => validateOpenFolder('../')).toThrow('下载文件夹')
  })
})
