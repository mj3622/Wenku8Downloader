import type { RankingPage, RankingType } from '../shared/ipc-types'
import type { DiscoverySource } from './discovery-service'
import { parseDiscoveryHome, parseRankingPage } from './discovery-parser'
import type { CrawlerRequestControlFactory, WebCrawler } from './crawler'
import { WENKU_BASE_URL } from './wenku-network'

export class WenkuDiscoverySource implements DiscoverySource {
  constructor(
    private readonly crawler: Pick<WebCrawler, 'fetch'>,
    private readonly requestControlFactory?: CrawlerRequestControlFactory,
  ) {}

  async fetchHome() {
    const url = `${WENKU_BASE_URL}/index.php`
    const control = this.requestControlFactory?.('document', url)
    return parseDiscoveryHome(await this.crawler.fetch(url, true, undefined, control))
  }

  async fetchRanking(
    type: RankingType,
    page: number,
  ): Promise<Omit<RankingPage, 'fetchedAt' | 'stale'>> {
    const url = new URL('/modules/article/toplist.php', WENKU_BASE_URL)
    url.searchParams.set('sort', type)
    url.searchParams.set('page', String(page))
    const target = url.toString()
    const control = this.requestControlFactory?.('document', target)
    return parseRankingPage(
      await this.crawler.fetch(target, true, undefined, control),
      type,
      page,
    )
  }
}
