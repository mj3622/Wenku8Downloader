import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOWNLOAD_CONFIG,
  parseSettingsDocument,
  validateDownloadConfig,
} from './config-schema'

const booksPath = resolve('Books')

describe('validateDownloadConfig', () => {
  it('accepts a complete valid download configuration', () => {
    expect(validateDownloadConfig({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: booksPath,
    })).toEqual({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: booksPath,
    })
  })

  it('rejects malformed fields and unknown request keys', () => {
    expect(() => validateDownloadConfig({
      fullTitle: 'INVALID',
      defaultCoverIndex: 0,
      downloadPath: '',
    })).toThrow('书名格式')
    expect(() => validateDownloadConfig({
      fullTitle: 'FULL',
      defaultCoverIndex: -1,
      downloadPath: '',
    })).toThrow('非负整数')
    expect(() => validateDownloadConfig({
      fullTitle: 'FULL',
      defaultCoverIndex: 0,
      downloadPath: 'bad\0path',
    })).toThrow('路径')
    expect(() => validateDownloadConfig({
      fullTitle: 'FULL',
      defaultCoverIndex: 0,
      downloadPath: 'relative/books',
    })).toThrow('路径')
    expect(() => validateDownloadConfig({
      fullTitle: 'FULL',
      defaultCoverIndex: 0,
      downloadPath: '',
      future: true,
    })).toThrow('未知下载设置')
  })
})

describe('parseSettingsDocument', () => {
  it('maps a v1 disk document to the domain model', () => {
    const result = parseSettingsDocument({
      config_version: 1,
      download: {
        full_title: 'OUT',
        default_cover_index: 2,
        download_path: booksPath,
      },
    })

    expect(result.state).toBe('ok')
    expect(result.value).toEqual({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: booksPath,
    })
  })

  it('migrates legacy string indexes and preserves unknown fields', () => {
    const result = parseSettingsDocument({
      future: { enabled: true },
      download: {
        full_title: 'IN',
        default_cover_index: '4',
        download_path: '',
        future_option: 'keep-me',
      },
    })

    expect(result.state).toBe('migrated')
    expect(result.value).toEqual({
      fullTitle: 'IN',
      defaultCoverIndex: 4,
      downloadPath: '',
    })
    expect(result.raw).toMatchObject({
      future: { enabled: true },
      download: { future_option: 'keep-me' },
    })
  })

  it('migrates an explicit v0 document', () => {
    const result = parseSettingsDocument({
      config_version: 0,
      download: {
        full_title: 'OUT',
        default_cover_index: '2',
        download_path: booksPath,
      },
    })

    expect(result).toMatchObject({
      state: 'migrated',
      value: {
        fullTitle: 'OUT',
        defaultCoverIndex: 2,
        downloadPath: booksPath,
      },
    })
  })

  it('falls back when a v0 string cover index exceeds the safe integer range', () => {
    const result = parseSettingsDocument({
      config_version: 0,
      download: {
        full_title: 'OUT',
        default_cover_index: '9'.repeat(400),
        download_path: '',
      },
    })

    expect(result.state).toBe('migrated')
    expect(result.value).toEqual({
      fullTitle: 'OUT',
      defaultCoverIndex: 0,
      downloadPath: '',
    })
  })

  it('uses safe defaults for malformed legacy values', () => {
    const result = parseSettingsDocument({
      download: { full_title: 'INVALID', default_cover_index: -1 },
    })

    expect(result.state).toBe('migrated')
    expect(result.value).toEqual(DEFAULT_DOWNLOAD_CONFIG)
  })

  it('keeps documents from newer versions read-only', () => {
    expect(parseSettingsDocument({ config_version: 99 })).toMatchObject({
      state: 'read-only-newer-version',
      value: DEFAULT_DOWNLOAD_CONFIG,
    })
  })
})
