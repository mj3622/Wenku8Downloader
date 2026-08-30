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

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'discovery-home.html'),
  'utf8',
)

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
})
