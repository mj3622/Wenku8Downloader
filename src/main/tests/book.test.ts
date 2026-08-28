import * as cheerio from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import type { WebCrawler } from '../crawler'
import { Book } from '../book'

describe('Book.create', () => {
  it('passes the task cancellation signal through every metadata request', async () => {
    const bookPage = cheerio.load(`
      <div id="content">
        <div><a href="/novel/1/100/index.htm">小说目录</a></div>
        <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
          <td>文库：测试</td><td>作者：测试作者</td><td>状态：完结</td>
        </tr></table>
      </div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="1.htm">第一章</a></td></tr></table>
    `)
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
      .mockResolvedValueOnce(bookPage)
    const crawler = { fetch } as unknown as WebCrawler
    const controller = new AbortController()
    const control = {}
    const requestControlFactory = vi.fn(() => control)

    await Book.create('100', crawler, controller.signal, requestControlFactory)

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://www.wenku8.net/book/100.htm',
      true,
      controller.signal,
      control,
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/novel/1/100/index.htm',
      true,
      controller.signal,
      control,
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://www.wenku8.net/book/100.htm',
      true,
      controller.signal,
      control,
    )
    expect(requestControlFactory.mock.calls).toEqual([
      ['document', 'https://www.wenku8.net/book/100.htm'],
      ['document', 'https://www.wenku8.net/novel/1/100/index.htm'],
      ['document', 'https://www.wenku8.net/book/100.htm'],
    ])
  })

  it('reuses resolved illustration URLs for the same volume', async () => {
    const bookPage = cheerio.load(`
      <div id="content">
        <div><a href="https://www.wenku8.net/novel/1/100/index.htm">小说目录</a></div>
        <table><tr><td><b>测试作品</b></td></tr><tr></tr><tr>
          <td>文库：测试</td><td>作者：测试作者</td><td>状态：完结</td>
        </tr></table>
      </div>
    `)
    const chapterPage = cheerio.load(`
      <table class="css"><tr><td class="vcss">第一卷</td></tr>
      <tr><td><a href="illustrations.htm">插图</a></td></tr></table>
    `)
    const illustrationPage = cheerio.load(`
      <img src="https://example.com/volume-1-cover.jpg">
    `)
    const fetch = vi.fn()
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(chapterPage)
      .mockResolvedValueOnce(bookPage)
      .mockResolvedValueOnce(illustrationPage)
    const crawler = { fetch } as unknown as WebCrawler
    const control = {}
    const requestControlFactory = vi.fn(() => control)
    const book = await Book.create('100', crawler, undefined, requestControlFactory)
    const taskControl = {}
    const taskRequestControlFactory = vi.fn(() => taskControl)

    await expect(book.getChapterImageUrls(
      '第一卷',
      undefined,
      taskRequestControlFactory,
    )).resolves.toEqual([
      'https://example.com/volume-1-cover.jpg',
    ])
    await expect(book.getChapterImageUrls('第一卷')).resolves.toEqual([
      'https://example.com/volume-1-cover.jpg',
    ])
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch).toHaveBeenLastCalledWith(
      'https://www.wenku8.net/novel/1/100/illustrations.htm',
      true,
      undefined,
      taskControl,
    )
    expect(taskRequestControlFactory).toHaveBeenCalledWith(
      'document',
      'https://www.wenku8.net/novel/1/100/illustrations.htm',
    )
  })
})
