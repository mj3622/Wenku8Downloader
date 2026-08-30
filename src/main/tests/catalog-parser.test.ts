import { readFileSync } from 'fs'
import { join } from 'path'
import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import type { CatalogQuery } from '../../shared/ipc-types'
import { parseCatalogPage } from '../catalog-parser'

const fixtures = join(__dirname, 'fixtures')

function loadFixture(name: string) {
  return cheerio.load(readFileSync(join(fixtures, name), 'utf8'))
}

function query(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    status: 'all',
    animation: 'all',
    sort: 'lastupdate',
    page: 1,
    ...overrides,
  }
}

describe('catalog parser', () => {
  it('parses article list metadata, pagination, and safe URLs', () => {
    const result = parseCatalogPage(loadFixture('catalog-list.html'), query({ page: 2 }))

    expect(result.page).toBe(2)
    expect(result.totalPages).toBe(214)
    expect(result.books).toHaveLength(3)
    expect(result.books[0]).toEqual({
      id: '4353',
      title: '赛文奥特曼 EPISODE:0',
      cover: 'https://img.wenku8.com/image/4/4353/4353s.jpg',
      author: '武上纯希',
      publisher: '其他文库',
      updateTime: '2026-08-30',
      wordCount: '112K',
      status: '已完结',
      isAnimated: true,
      tags: '科幻 战斗',
      desc: '地球防卫军的精英部队•奥特警备队，包括队长在内共计六名正式队员',
    })
    expect(result.books[2]).toMatchObject({
      id: '4352',
      cover: '',
      updateTime: '',
      wordCount: '',
      tags: '',
      desc: '',
    })
    expect(result.books.some(book => book.id === '999')).toBe(false)
  })

  it('parses tag pages and applies result metadata filters to the requested page', () => {
    const catalogQuery = query({
      tag: '校园',
      status: 'serializing',
      animation: 'animated',
      page: 3,
    })

    expect(parseCatalogPage(loadFixture('catalog-tag-list.html'), catalogQuery)).toEqual({
      query: catalogQuery,
      page: 3,
      totalPages: 60,
      books: [{
        id: '3057',
        title: '败北女角太多了！',
        cover: 'https://img.wenku8.com/image/3/3057/3057s.jpg',
        author: '雨森焚火',
        publisher: '小学馆',
        updateTime: '2026-07-19',
        wordCount: '1271K',
        status: '连载中',
        isAnimated: true,
        tags: '校园 欢乐向 青春 恋爱 后宫 妹妹',
        desc: '平常担任班上背景人物的我，偶然目击人气女同学被甩掉',
      }],
    })
  })

  it('returns an empty page when page-local filters do not match', () => {
    const result = parseCatalogPage(
      loadFixture('catalog-tag-list.html'),
      query({ tag: '校园', status: 'completed', page: 3 }),
    )

    expect(result.books).toEqual([])
    expect(result.totalPages).toBe(60)
  })

  it('falls back to pagination links and rejects missing catalog markup', () => {
    const html = '<table class="grid"><caption>轻小说列表</caption></table>'
      + '<div class="pagelink"><a href="?page=7">7</a></div>'
    expect(parseCatalogPage(cheerio.load(html), query({ page: 2 }))).toMatchObject({
      page: 2,
      totalPages: 7,
      books: [],
    })
    expect(() => parseCatalogPage(cheerio.load('<main>blocked</main>'), query()))
      .toThrow('轻小说列表结构已变化，请稍后重试')
  })
})
