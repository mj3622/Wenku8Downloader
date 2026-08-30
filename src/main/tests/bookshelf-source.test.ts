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

  it('adds only the validated book ID through the fixed endpoint and reads back the bookshelf', async () => {
    const addResult = cheerio.load('<main>操作完成</main>')
    const bookshelf = cheerio.load(`
      <table class="grid">
        <tr>
          <th></th><th>名称</th><th>作者</th><th>最新章节</th><th>书签</th><th>更新</th><th>操作</th>
        </tr>
        <tr>
          <td><input name="checkid[]" value="101"></td>
          <td><a href="/modules/article/readbookcase.php?aid=3057&amp;bid=501">测试作品</a></td>
          <td>测试作者</td><td>第十章</td><td></td><td>26-08-29</td><td></td>
        </tr>
      </table>
    `)
    const fetch = vi.fn()
      .mockResolvedValueOnce(addResult)
      .mockResolvedValueOnce(bookshelf)
    const requestControlFactory = vi.fn(() => ({}))
    const source = new WenkuBookshelfSource(
      { fetch } as unknown as WebCrawler,
      requestControlFactory,
    )

    await expect(source.addBook('3057')).resolves.toEqual([
      expect.objectContaining({ bookId: '3057', title: '测试作品' }),
    ])
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://www.wenku8.net/modules/article/addbookcase.php?bid=3057',
      'https://www.wenku8.net/modules/article/bookcase.php',
    ])
    expect(requestControlFactory.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['document', 'https://www.wenku8.net/modules/article/addbookcase.php?bid=3057'],
      ['document', 'https://www.wenku8.net/modules/article/bookcase.php'],
    ])
  })
})
