import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import type {
  CrawlerRequestControl,
  CrawlerRequestControlFactory,
  WebCrawler,
} from '../crawler'
import { WenkuDiscoverySource } from '../discovery-source'
import type { RankingType } from '../../shared/ipc-types'

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'discovery-home.html'),
  'utf8',
)
const annualFixture = readFileSync(join(__dirname, 'fixtures', 'annual-ranking.html'), 'utf8')
const rankingFixture = readFileSync(join(__dirname, 'fixtures', 'ranking-page.html'), 'utf8')

describe('WenkuDiscoverySource', () => {
  it('uses the supplied background request control for discovery requests', async () => {
    const control: CrawlerRequestControl = { beforeAttempt: vi.fn(async () => undefined) }
    const controlFactory: CrawlerRequestControlFactory = vi.fn(() => control)
    const fetch = vi.fn(async () => load(fixture))
    const source = new WenkuDiscoverySource(
      { fetch } as unknown as Pick<WebCrawler, 'fetch'>,
      controlFactory,
    )

    await source.fetchHome()

    const url = 'https://www.wenku8.net/index.php'
    expect(controlFactory).toHaveBeenCalledWith('document', url)
    expect(fetch).toHaveBeenCalledWith(url, true, undefined, control)
  })

  it('requests only the selected annual ranking year', async () => {
    const control: CrawlerRequestControl = { beforeAttempt: vi.fn(async () => undefined) }
    const controlFactory: CrawlerRequestControlFactory = vi.fn(() => control)
    const fetch = vi.fn(async () => load(annualFixture))
    const source = new WenkuDiscoverySource(
      { fetch } as unknown as Pick<WebCrawler, 'fetch'>,
      controlFactory,
    )

    await source.fetchAnnualRanking(2026)

    const url = 'https://www.wenku8.net/zt/sugoi/2026.php'
    expect(controlFactory).toHaveBeenCalledOnce()
    expect(controlFactory).toHaveBeenCalledWith('document', url)
    expect(fetch).toHaveBeenCalledWith(url, true, undefined, control)
  })

  it.each([
    ['allvote', '总推荐榜'],
    ['monthvote', '本月推荐榜'],
    ['dayvote', '今日推荐榜'],
    ['size', '字数榜'],
  ] satisfies Array<[RankingType, string]>)('maps %s to the shared ranking URL and title', async (type, title) => {
    const control: CrawlerRequestControl = { beforeAttempt: vi.fn(async () => undefined) }
    const controlFactory: CrawlerRequestControlFactory = vi.fn(() => control)
    const fetch = vi.fn(async () => load(rankingFixture))
    const source = new WenkuDiscoverySource(
      { fetch } as unknown as Pick<WebCrawler, 'fetch'>,
      controlFactory,
    )

    const result = await source.fetchRanking(type, 2)

    const url = `https://www.wenku8.net/modules/article/toplist.php?sort=${type}&page=2`
    expect(controlFactory).toHaveBeenCalledWith('document', url)
    expect(fetch).toHaveBeenCalledWith(url, true, undefined, control)
    expect(result).toMatchObject({ type, title, page: 2, totalPages: 209 })
    expect(result.books.map(book => book.rank)).toEqual([21, 22])
  })
})
