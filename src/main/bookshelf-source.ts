import type { CrawlerRequestControlFactory, WebCrawler } from './crawler'
import { parseBookshelfPage, type RemoteBookshelfEntry } from './bookshelf-parser'
import { WENKU_BASE_URL } from './wenku-network'

const BOOKSHELF_URL = `${WENKU_BASE_URL}/modules/article/bookcase.php`

export class WenkuBookshelfSource {
  constructor(
    private readonly crawler: Pick<WebCrawler, 'fetch'>,
    private readonly requestControlFactory?: CrawlerRequestControlFactory,
  ) {}

  async fetchEntries(): Promise<RemoteBookshelfEntry[]> {
    const control = this.requestControlFactory?.('document', BOOKSHELF_URL)
    const document = await this.crawler.fetch(BOOKSHELF_URL, true, undefined, control)
    const finalUrl = (document as unknown as { myUrl?: unknown }).myUrl
    return parseBookshelfPage(document, typeof finalUrl === 'string' ? finalUrl : undefined)
  }
}
