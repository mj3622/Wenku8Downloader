import type * as cheerio from 'cheerio'

type CheerioDocument = ReturnType<typeof cheerio.load>

export interface RemoteBookshelfEntry {
  bookId: string
  title: string
  author: string
  latestChapter: string | null
  bookmark: string | null
  updatedAt: string | null
}

const LOGIN_REQUIRED_MESSAGE = '请先刷新登录状态'
const STRUCTURE_CHANGED_MESSAGE = '书架页面结构已变化，请稍后重试'

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function optionalText(value: string): string | null {
  const normalized = normalizedText(value)
  return normalized || null
}

function parseBookId(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href, 'https://www.wenku8.net/modules/article/bookcase.php')
    const bookId = url.searchParams.get('aid')
    return bookId && /^\d{1,12}$/.test(bookId) ? bookId : null
  } catch {
    return null
  }
}

function loginRequired($: CheerioDocument, finalUrl?: string): boolean {
  if (finalUrl) {
    try {
      const url = new URL(finalUrl, 'https://www.wenku8.net/')
      if (/login|login\.php/i.test(url.pathname + url.search)) return true
    } catch {
      return true
    }
  }
  return $('input[type="password"], form[action*="login" i]').length > 0
    || /(?:用户|会员)登录/.test(normalizedText($('body').text()).slice(0, 2_000))
}

export function parseBookshelfPage(
  $: CheerioDocument,
  finalUrl?: string,
): RemoteBookshelfEntry[] {
  if (loginRequired($, finalUrl)) throw new Error(LOGIN_REQUIRED_MESSAGE)

  const table = $('table.grid').filter((_index, element) => {
    const header = normalizedText($(element).find('tr').first().text())
    return header.includes('名称') && header.includes('最新章节') && header.includes('更新')
  }).first()
  if (table.length === 0) throw new Error(LOGIN_REQUIRED_MESSAGE)

  const headers = table.find('tr').first().find('th,td').map((_index, cell) => (
    normalizedText($(cell).text())
  )).get()
  if (!headers.includes('名称')
    || !headers.includes('作者')
    || !headers.includes('最新章节')
    || !headers.includes('书签')
    || !headers.includes('更新')) {
    throw new Error(STRUCTURE_CHANGED_MESSAGE)
  }

  const entries: RemoteBookshelfEntry[] = []
  table.find('tr').slice(1).each((_index, row) => {
    const cells = $(row).find('td')
    if (cells.length === 0 || $(row).find('input[name="checkid[]"]').length === 0) return
    if (cells.length < 7) throw new Error(STRUCTURE_CHANGED_MESSAGE)

    const titleCell = cells.eq(1)
    const titleLink = titleCell.find('a[href*="readbookcase.php"][href*="aid="]').first()
    const bookId = parseBookId(titleLink.attr('href'))
    const title = normalizedText(titleLink.text())
    const author = normalizedText(cells.eq(2).text())
    if (!bookId || !title || title.length > 500 || author.length > 500) {
      throw new Error(STRUCTURE_CHANGED_MESSAGE)
    }

    const bookmarkCell = cells.eq(4)
    const bookmark = optionalText(
      bookmarkCell.text()
        || bookmarkCell.find('a').attr('title')
        || bookmarkCell.find('a').attr('aria-label')
        || '',
    )
    const latestChapter = optionalText(cells.eq(3).text())
    const updatedAt = optionalText(cells.eq(5).text())
    if ((latestChapter?.length ?? 0) > 500
      || (bookmark?.length ?? 0) > 500
      || (updatedAt?.length ?? 0) > 100) {
      throw new Error(STRUCTURE_CHANGED_MESSAGE)
    }
    entries.push({ bookId, title, author, latestChapter, bookmark, updatedAt })
  })

  if (entries.length > 600) throw new Error(STRUCTURE_CHANGED_MESSAGE)
  return entries
}
