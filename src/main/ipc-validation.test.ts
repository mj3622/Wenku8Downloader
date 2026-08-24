import { describe, expect, it } from 'vitest'
import {
  validateBookId,
  validateExternalUrl,
  validateLoginOperationId,
  validateOpenFolder,
  validateRendererErrorReport,
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
    expect(() => validateSearchQuery('')).toThrow('请输入 1 到 100 个字符')
    expect(() => validateSearchQuery('x'.repeat(101))).toThrow('请输入 1 到 100 个字符')
  })

  it('allows only known external HTTPS destinations', () => {
    expect(validateExternalUrl('https://github.com/mj3622/Wenku8Downloader')).toContain('github.com')
    expect(() => validateExternalUrl('http://github.com/mj3622')).toThrow('外部链接')
    expect(() => validateExternalUrl('https://evil.example')).toThrow('外部链接')
    expect(() => validateExternalUrl('file:///C:/Windows/System32')).toThrow('外部链接')
  })

  it('allows only the download root and known subfolders', () => {
    expect(validateOpenFolder('root')).toBe('root')
    expect(validateOpenFolder('pics')).toBe('pics')
    expect(validateOpenFolder('novels')).toBe('novels')
    expect(() => validateOpenFolder('../')).toThrow('下载文件夹')
  })

  it('accepts only bounded login operation IDs', () => {
    expect(validateLoginOperationId('login-1720000000000-3')).toBe('login-1720000000000-3')
    expect(() => validateLoginOperationId('../login-1-1')).toThrow('登录请求')
    expect(() => validateLoginOperationId('dl-1-1')).toThrow('登录请求')
  })

  it('accepts bounded renderer error reports', () => {
    expect(validateRendererErrorReport({
      kind: 'error',
      message: 'render failed',
      stack: 'Error: render failed',
      source: 'file:///app.js',
      line: 12,
      column: 3,
    })).toEqual({
      kind: 'error',
      message: 'render failed',
      stack: 'Error: render failed',
      source: 'file:///app.js',
      line: 12,
      column: 3,
    })
  })

  it('ignores unknown renderer error fields', () => {
    expect(validateRendererErrorReport({
      kind: 'error',
      message: 'render failed',
      futureMetadata: { retryable: true },
    })).toEqual({
      kind: 'error',
      message: 'render failed',
    })
  })

  it('rejects oversized renderer reports even when the excess is in unknown fields', () => {
    expect(() => validateRendererErrorReport({
      kind: 'error',
      message: 'render failed',
      futureMetadata: 'x'.repeat(65 * 1024),
    })).toThrow('渲染进程错误报告')
  })

  it.each([
    [{ kind: 'other', message: 'failed' }],
    [{ kind: 'error', message: '' }],
    [{ kind: 'error', message: 'x'.repeat(8 * 1024 + 1) }],
    [{ kind: 'error', message: 'failed', line: -1 }],
    [{ kind: 'error', message: 'failed', stack: 'x'.repeat(65 * 1024) }],
  ])('rejects malformed renderer reports %#', (input) => {
    expect(() => validateRendererErrorReport(input)).toThrow('渲染进程错误报告')
  })
})
