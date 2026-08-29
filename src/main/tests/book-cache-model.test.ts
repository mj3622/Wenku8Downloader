import { describe, expect, it } from 'vitest'
import {
  createBookVersion,
  normalizeVersionField,
  parseBookSnapshot,
  type BookSnapshot,
} from '../book-cache-model'

function snapshot(): BookSnapshot {
  const version = createBookVersion({
    updatedAt: '2026-08-29',
    latestChapter: '第十章',
    status: '连载中',
  }, 1_000)
  return {
    schemaVersion: 1,
    bookId: '123',
    checkedAt: 1_000,
    version,
    legacyImportGenerationKey: version.generationKey,
    baseChapterUrl: 'https://www.wenku8.net/novel/1/2/',
    volumes: { 第一卷: [{ name: '第一章', link: '1.htm' }] },
    basicInfo: {
      '标题': '测试作品',
      '作者': '作者',
      '出版社': '文库',
      '最新章节': '第十章',
      '连载状态': '连载中',
      '更新时间': '2026-08-29',
      '全文长度': '10000',
      '简介': '简介',
      'cover': 'https://img.example/cover.jpg',
    },
  }
}

describe('book cache model', () => {
  it('normalizes whitespace before creating a stable version key', () => {
    const a = createBookVersion({
      updatedAt: ' 2026-08-29\n10:00 ',
      latestChapter: ' 第十章 ',
      status: ' 连载中 ',
    }, 1_000)
    const b = createBookVersion({
      updatedAt: '2026-08-29 10:00',
      latestChapter: '第十章',
      status: '连载中',
    }, 9_000)
    expect(normalizeVersionField('  A\n B  ')).toBe('A B')
    expect(a).toEqual(b)
    expect(a.stable).toBe(true)
    expect(a.generationKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it('creates a fresh generation for metadata-free full refreshes', () => {
    const fields = { updatedAt: '', latestChapter: '', status: '' }
    expect(createBookVersion(fields, 1_000).generationKey)
      .not.toBe(createBookVersion(fields, 2_000).generationKey)
    expect(createBookVersion(fields, 1_000).stable).toBe(false)
  })

  it('parses a valid snapshot into independent objects', () => {
    const value = snapshot()
    const parsed = parseBookSnapshot(value)
    expect(parsed).toEqual(value)
    expect(parsed).not.toBe(value)
    expect(parsed?.volumes).not.toBe(value.volumes)
  })

  it('rejects invalid book ids, versions and basic information', () => {
    expect(parseBookSnapshot({ ...snapshot(), bookId: '../x' })).toBeNull()
    expect(parseBookSnapshot({
      ...snapshot(),
      version: { ...snapshot().version, generationKey: 'x' },
    })).toBeNull()
    expect(parseBookSnapshot({ ...snapshot(), basicInfo: {} })).toBeNull()
    expect(parseBookSnapshot({
      ...snapshot(),
      version: { ...snapshot().version, stable: false },
    })).toBeNull()
    expect(parseBookSnapshot({ ...snapshot(), baseChapterUrl: 'file:///tmp/book/' })).toBeNull()
    const unknown = {
      ...snapshot(),
      version: createBookVersion({ updatedAt: '', latestChapter: '', status: '' }, 1_000),
    }
    expect(parseBookSnapshot({
      ...unknown,
      version: { ...unknown.version, generationKey: 'a'.repeat(64) },
    })).toBeNull()
  })
})
