import * as cheerio from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import { WenkuBookshelfSource } from '../bookshelf-source'
import type { WebCrawler } from '../crawler'

describe('WenkuBookshelfSource', () => {
  it('requests only the fixed GET bookcase URL through the scheduler', async () => {
    const document = cheerio.load(`
      <table class="grid"><tr>
        <th></th><th>名称</th><th>作者</th><th>最新章节</th><th>书签</th><th>更新</th><th>操作</th>
      </tr></table>
    `)
    ;(document as unknown as { myUrl: string }).myUrl = 'https://www.wenku8.net/modules/article/bookcase.php'
    const fetch = vi.fn().mockResolvedValue(document)
    const control = {}
    const requestControlFactory = vi.fn(() => control)
    const source = new WenkuBookshelfSource(
      { fetch } as unknown as WebCrawler,
      requestControlFactory,
    )

    await expect(source.fetchEntries()).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledWith(
      'https://www.wenku8.net/modules/article/bookcase.php',
      true,
      undefined,
      control,
    )
    expect(requestControlFactory).toHaveBeenCalledWith(
      'document',
      'https://www.wenku8.net/modules/article/bookcase.php',
    )
  })

  it('rejects a final login redirect even if stale bookcase markup is present', async () => {
    const document = cheerio.load(`
      <table class="grid"><tr>
        <th></th><th>名称</th><th>作者</th><th>最新章节</th><th>书签</th><th>更新</th><th>操作</th>
      </tr></table>
    `)
    ;(document as unknown as { myUrl: string }).myUrl = 'https://www.wenku8.net/login.php'
    const source = new WenkuBookshelfSource({
      fetch: vi.fn().mockResolvedValue(document),
    } as unknown as WebCrawler)

    await expect(source.fetchEntries()).rejects.toThrow('请先刷新登录状态')
  })
})
