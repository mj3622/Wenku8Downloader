import type { RankingPage, RankingType } from '../shared/ipc-types'
import type { DiscoverySource } from './discovery-service'
import { parseDiscoveryHome, parseRankingPage } from './discovery-parser'
import type { WebCrawler } from './crawler'
import { WENKU_BASE_URL } from './wenku-network'

export class WenkuDiscoverySource implements DiscoverySource {
  constructor(private readonly crawler: Pick<WebCrawler, 'fetch'>) {}

  async fetchHome() {
    return parseDiscoveryHome(await this.crawler.fetch(`${WENKU_BASE_URL}/index.php`))
  }

  async fetchRanking(
    type: RankingType,
    page: number,
  ): Promise<Omit<RankingPage, 'fetchedAt' | 'stale'>> {
    const url = new URL('/modules/article/toplist.php', WENKU_BASE_URL)
    url.searchParams.set('sort', type)
    url.searchParams.set('page', String(page))
    return parseRankingPage(await this.crawler.fetch(url.toString()), type, page)
  }
}
