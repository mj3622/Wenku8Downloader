import type { CrawlerRequestControlFactory, WebCrawler } from './crawler'
import { parseBookshelfPage, type RemoteBookshelfEntry } from './bookshelf-parser'
import { WENKU_BASE_URL } from './wenku-network'

const BOOKSHELF_URL = `${WENKU_BASE_URL}/modules/article/bookcase.php`
const ADD_BOOKSHELF_URL = `${WENKU_BASE_URL}/modules/article/addbookcase.php`

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

  async addBook(bookId: string): Promise<RemoteBookshelfEntry[]> {
    const url = `${ADD_BOOKSHELF_URL}?bid=${encodeURIComponent(bookId)}`
    const control = this.requestControlFactory?.('document', url)
    await this.crawler.fetch(url, true, undefined, control)
    return this.fetchEntries()
  }
}
