import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogQuery } from '../../shared/ipc-types'
import type { CrawlerRequestControlFactory, WebCrawler } from '../crawler'
import { WenkuCatalogSource } from '../catalog-source'

const fixture = readFileSync(join(__dirname, 'fixtures', 'catalog-list.html'), 'utf8')

function query(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    status: 'all',
    animation: 'all',
    sort: 'lastupdate',
    page: 1,
    ...overrides,
  }
}

describe('WenkuCatalogSource', () => {
  it('maps article-list filters to allowlisted parameters', async () => {
    const fetch = vi.fn(async (_url: string) => load(fixture))
    const control = {}
    const controls: CrawlerRequestControlFactory = vi.fn(() => control)
    const source = new WenkuCatalogSource(
      { fetch } as unknown as Pick<WebCrawler, 'fetch'>,
      controls,
    )

    await source.fetchPage(query({ publisher: '1', initial: 'A', status: 'completed', page: 2 }))

    const url = 'https://www.wenku8.net/modules/article/articlelist.php?class=1&initial=A&fullflag=1&page=2'
    expect(controls).toHaveBeenCalledWith('document', url)
    expect(fetch).toHaveBeenCalledWith(url, true, undefined, control)
  })

  it('encodes allowlisted tags with the original GBK query encoding', async () => {
    const fetch = vi.fn(async (_url: string) => load(readFileSync(
      join(__dirname, 'fixtures', 'catalog-tag-list.html'),
      'utf8',
    )))
    const source = new WenkuCatalogSource({ fetch } as unknown as Pick<WebCrawler, 'fetch'>)

    await source.fetchPage(query({ tag: '校园', sort: 'allvisit', page: 3 }))

    expect(fetch).toHaveBeenCalledWith(
      'https://www.wenku8.net/modules/article/tags.php?t=%D0%A3%D4%B0&v=1&page=3',
      true,
      undefined,
      undefined,
    )
  })

  it('uses toplists for global popular and animated browsing', async () => {
    const fetch = vi.fn(async (_url: string) => load(fixture))
    const source = new WenkuCatalogSource({ fetch } as unknown as Pick<WebCrawler, 'fetch'>)

    await source.fetchPage(query({ sort: 'allvisit' }))
    await source.fetchPage(query({ animation: 'animated' }))

    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://www.wenku8.net/modules/article/toplist.php?sort=allvisit&page=1',
      'https://www.wenku8.net/modules/article/toplist.php?sort=anime&page=1',
    ])
  })

  it('rejects unsafe values and unsupported cross-surface combinations before fetching', async () => {
    const fetch = vi.fn(async (_url: string) => load(fixture))
    const source = new WenkuCatalogSource({ fetch } as unknown as Pick<WebCrawler, 'fetch'>)

    await expect(source.fetchPage({ ...query(), publisher: '../secrets' } as unknown as CatalogQuery))
      .rejects.toThrow('出版社筛选无效')
    await expect(source.fetchPage({ ...query(), tag: '不存在的标签' } as unknown as CatalogQuery))
      .rejects.toThrow('标签筛选无效')
    await expect(source.fetchPage({ ...query(), sort: 'unknown' } as unknown as CatalogQuery))
      .rejects.toThrow('排序方式无效')
    await expect(source.fetchPage(query({ page: 501 })))
      .rejects.toThrow('页码无效')
    await expect(source.fetchPage(query({ tag: '校园', publisher: '1' })))
      .rejects.toThrow('标签不能与出版社或首字母同时筛选')
    await expect(source.fetchPage(query({ publisher: '1', sort: 'allvisit' })))
      .rejects.toThrow('出版社或首字母筛选仅支持按更新排序')
    expect(fetch).not.toHaveBeenCalled()
  })
})
