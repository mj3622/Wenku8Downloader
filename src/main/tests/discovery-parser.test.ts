import { readFileSync } from 'fs'
import { join } from 'path'
import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import {
  coverUrlForBook,
  parseDiscoveryHome,
  parseRankingPage,
} from '../discovery-parser'

const fixtures = join(__dirname, 'fixtures')

function loadFixture(name: string) {
  return cheerio.load(readFileSync(join(fixtures, name), 'utf8'))
}

describe('discovery parser', () => {
  it('parses all supported homepage sections and deduplicates book links', () => {
    const sections = parseDiscoveryHome(loadFixture('discovery-home.html'))

    expect(sections.map(section => [section.key, section.moreRanking])).toEqual([
      ['new-books', 'postdate'],
      ['weekly-recommendations', 'weekvote'],
      ['daily-hot', 'dayvisit'],
      ['monthly-hot', 'monthvisit'],
      ['most-followed', 'goodnum'],
      ['recent-updates', 'lastupdate'],
      ['animated', 'anime'],
      ['latest', 'postdate'],
    ])
    expect(sections[0].books).toHaveLength(2)
    expect(sections[0].books[0]).toEqual({
      id: '4307',
      title: '探索者',
      cover: 'https://img.wenku8.com/image/4/4307/4307s.jpg',
    })
    expect(sections[2].books[0]).toMatchObject({
      id: '1787',
      rank: 1,
      cover: coverUrlForBook('1787'),
    })
    expect(sections[5].books[0].title).toBe('魔女审判的辩护人')
  })

  it('rejects pages without any known homepage section', () => {
    expect(() => parseDiscoveryHome(cheerio.load('<html><body>blocked</body></html>')))
      .toThrow('首页推荐')
  })

  it('parses ranked books and pager metadata', () => {
    const ranking = parseRankingPage(loadFixture('ranking-page.html'), 'allvisit', 2)

    expect(ranking).toEqual({
      type: 'allvisit',
      title: '总排行榜',
      page: 2,
      totalPages: 209,
      books: [
        {
          id: '1973',
          title: '欢迎来到实力至上主义的教室',
          cover: 'https://img.wenku8.com/image/1/1973/1973s.jpg',
          rank: 21,
        },
        {
          id: '1787',
          title: '关于我转生变成史莱姆这档事',
          cover: 'https://img.wenku8.com/image/1/1787/1787s.jpg',
          rank: 22,
        },
      ],
    })
  })

  it('allows a structurally valid empty ranking and rejects missing ranking markup', () => {
    expect(parseRankingPage(
      cheerio.load('<table class="grid"><caption>轻小说日排行榜</caption></table>'),
      'dayvisit',
      1,
    ).books).toEqual([])
    expect(() => parseRankingPage(cheerio.load('<div>blocked</div>'), 'dayvisit', 1))
      .toThrow('排行榜')
  })
})
