import { readFile } from 'fs/promises'
import { join } from 'path'
import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { parseBookshelfPage } from '../bookshelf-parser'

describe('parseBookshelfPage', () => {
  it('parses only readonly bookshelf fields and ignores operation links', async () => {
    const html = await readFile(join(__dirname, 'fixtures', 'bookcase.html'), 'utf8')

    expect(parseBookshelfPage(cheerio.load(html))).toEqual([
      {
        bookId: '101',
        title: '星海图书馆',
        author: '林间笔记',
        latestChapter: '第十二章 晚风',
        bookmark: '第三章',
        updatedAt: '26-08-20',
      },
      {
        bookId: '202',
        title: '雨夜邮差',
        author: '野原作者',
        latestChapter: null,
        bookmark: null,
        updatedAt: null,
      },
    ])
  })

  it('accepts a valid empty bookshelf', () => {
    const $ = cheerio.load(`
      <table class="grid"><tr>
        <th></th><th>名称</th><th>作者</th><th>最新章节</th><th>书签</th><th>更新</th><th>操作</th>
      </tr><tr><td colspan="7">暂无收藏</td></tr></table>
    `)
    expect(parseBookshelfPage($)).toEqual([])
  })

  it('returns a stable login error for login pages, redirects and missing tables', () => {
    expect(() => parseBookshelfPage(cheerio.load('<form action="login.php"><input type="password"></form>')))
      .toThrow('请先刷新登录状态')
    expect(() => parseBookshelfPage(cheerio.load('<main></main>'), 'https://www.wenku8.net/login.php'))
      .toThrow('请先刷新登录状态')
    expect(() => parseBookshelfPage(cheerio.load('<main></main>')))
      .toThrow('请先刷新登录状态')
  })

  it('rejects changed row structures instead of returning partial data', () => {
    const $ = cheerio.load(`
      <table class="grid">
        <tr><th></th><th>名称</th><th>作者</th><th>最新章节</th><th>书签</th><th>更新</th><th>操作</th></tr>
        <tr><td><input name="checkid[]"></td><td><a href="readbookcase.php?aid=bad">作品</a></td></tr>
      </table>
    `)
    expect(() => parseBookshelfPage($)).toThrow('书架页面结构已变化')
  })
})
