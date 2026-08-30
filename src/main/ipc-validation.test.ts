import { describe, expect, it } from 'vitest'
import {
  validateBookId,
  validateCatalogPayload,
  validateDownloadArtifactPayload,
  validateDownloadHistoryScope,
  validateDownloadTaskId,
  validateDiscoveryRankingPayload,
  validateDiscoveryHomePayload,
  validateEnqueueDownloadInput,
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

  it.each([
    '550e8400-e29b-41d4-a716-446655440000',
    'dl-1720000000000-3',
  ])('accepts a supported download task ID: %s', (taskId) => {
    expect(validateDownloadTaskId(taskId)).toBe(taskId)
  })

  it('rejects arbitrary download task IDs', () => {
    expect(() => validateDownloadTaskId('../task')).toThrow('下载任务')
    expect(() => validateDownloadTaskId('legacy-1')).toThrow('下载任务')
  })

  it('accepts only task and artifact identifiers for artifact actions', () => {
    expect(validateDownloadArtifactPayload({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      artifactId: 'primary',
    })).toEqual({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      artifactId: 'primary',
    })
    expect(() => validateDownloadArtifactPayload({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      artifactId: '../secret',
    })).toThrow('下载产物请求')
    expect(() => validateDownloadArtifactPayload({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      artifactId: 'primary',
      path: '/tmp/private',
    })).toThrow('下载产物请求')
  })

  it('validates and normalizes download enqueue input', () => {
    expect(validateEnqueueDownloadInput({
      bookId: '3057',
      title: '  测试作品  ',
      cover: 'https://example.com/cover.jpg',
      type: 'epub_volume',
      volume: '第一卷',
      ignored: true,
    })).toEqual({
      bookId: '3057',
      title: '测试作品',
      cover: 'https://example.com/cover.jpg',
      type: 'epub_volume',
      volume: '第一卷',
    })
  })

  it('requires a volume for volume downloads', () => {
    expect(() => validateEnqueueDownloadInput({
      bookId: '3057',
      title: '测试作品',
      type: 'epub_volume',
    })).toThrow('分卷')
  })

  it('rejects malformed download enqueue fields', () => {
    expect(() => validateEnqueueDownloadInput({
      bookId: '3057',
      title: '测试作品',
      type: 'unsupported',
    })).toThrow('下载类型')
    expect(() => validateEnqueueDownloadInput({
      bookId: '3057',
      title: '测试作品',
      type: 'epub_full',
      cover: 'file:///tmp/cover.png',
    })).toThrow('封面')
  })

  it('accepts only known download history scopes', () => {
    expect(validateDownloadHistoryScope('completed')).toBe('completed')
    expect(validateDownloadHistoryScope('terminal')).toBe('terminal')
    expect(() => validateDownloadHistoryScope('everything')).toThrow('清理范围')
  })

  it('validates and normalizes discovery ranking payloads', () => {
    expect(validateDiscoveryRankingPayload({
      type: 'monthvisit',
      page: 3,
      refresh: true,
      ignored: 'value',
    })).toEqual({ type: 'monthvisit', page: 3, refresh: true })

    expect(validateDiscoveryRankingPayload({ type: 'allvisit', page: 1 }))
      .toEqual({ type: 'allvisit', page: 1, refresh: false })
  })

  it('accepts only a boolean discovery home refresh flag', () => {
    expect(validateDiscoveryHomePayload({})).toEqual({ refresh: false })
    expect(validateDiscoveryHomePayload({ refresh: true })).toEqual({ refresh: true })
    expect(() => validateDiscoveryHomePayload({ refresh: 'yes' })).toThrow('发现页')
    expect(() => validateDiscoveryHomePayload(null)).toThrow('发现页')
  })

  it('validates catalog queries field by field and rejects unknown input', () => {
    expect(validateCatalogPayload({
      query: {
        publisher: '10',
        initial: 'A',
        status: 'completed',
        animation: 'all',
        sort: 'lastupdate',
        page: 2,
      },
      refresh: true,
    })).toEqual({
      query: {
        publisher: '10',
        initial: 'A',
        status: 'completed',
        animation: 'all',
        sort: 'lastupdate',
        page: 2,
      },
      refresh: true,
    })

    expect(() => validateCatalogPayload({
      query: {
        status: 'all', animation: 'all', sort: 'lastupdate', page: 1, url: 'file:///tmp',
      },
    })).toThrow('找书请求格式无效')
    expect(() => validateCatalogPayload({
      query: { status: 'all', animation: 'all', sort: 'lastupdate', page: 501 },
    })).toThrow('找书页码无效')
    expect(() => validateCatalogPayload({
      query: { tag: '不存在', status: 'all', animation: 'all', sort: 'lastupdate', page: 1 },
    })).toThrow('标签筛选无效')
    expect(() => validateCatalogPayload({
      query: {
        tag: '校园', publisher: '1', status: 'all', animation: 'all', sort: 'lastupdate', page: 1,
      },
    })).toThrow('标签不能与出版社或首字母同时筛选')
  })

  it.each([
    { type: 'unknown', page: 1 },
    { type: 'allvisit', page: 0 },
    { type: 'allvisit', page: 1.5 },
    { type: 'allvisit', page: 10_001 },
    { type: 'allvisit', page: 1, refresh: 'yes' },
    null,
  ])('rejects malformed discovery ranking payloads %#', (input) => {
    expect(() => validateDiscoveryRankingPayload(input)).toThrow('榜单')
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
