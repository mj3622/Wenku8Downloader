import * as cheerio from 'cheerio'
import {
  CATALOG_PUBLISHER_OPTIONS,
  type CatalogPage,
  type CatalogQuery,
  type SearchResult,
} from '../shared/ipc-types'
import { WENKU_BASE_URL } from './wenku-network'

type CheerioDocument = ReturnType<typeof cheerio.load>
type CheerioRoot = ReturnType<CheerioDocument>

const MAX_FIELD_LENGTH = 500
const PUBLISHER_LABELS = new Map<string, string>(
  CATALOG_PUBLISHER_OPTIONS.map(option => [option.value, option.label]),
)

function normalizeText(value: string, maxLength = MAX_FIELD_LENGTH): string {
  const decoded = value.replace(
    /&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi,
    (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10)
      if (
        !Number.isSafeInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10FFFF
        || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
      ) return entity
      return String.fromCodePoint(codePoint)
    },
  )
  return decoded.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function parseBookId(href: string | undefined): string | null {
  if (!href || href.length > 2_048) return null
  try {
    const url = new URL(href, WENKU_BASE_URL)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.hostname !== 'www.wenku8.net') return null
    return url.pathname.match(/^\/book\/(\d{1,12})\.htm$/)?.[1] ?? null
  } catch {
    return null
  }
}

function normalizeCoverUrl(rawUrl: string | undefined): string {
  if (!rawUrl || rawUrl.length > 2_048) return ''
  try {
    const url = new URL(rawUrl, WENKU_BASE_URL)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.hostname !== 'img.wenku8.com'
    ) return ''
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return ''
  }
}

function findBookRoot(
  $: CheerioDocument,
  link: CheerioRoot,
  bookId: string,
): CheerioRoot | null {
  const candidates = link.parents('div').filter((_index, element) => {
    const root = $(element)
    if (root.find('img').length === 0 || root.find('p').length === 0) return false
    return root.find('a[href]').toArray().some(anchor => (
      parseBookId($(anchor).attr('href')) === bookId
    ))
  })
  return candidates.length > 0 ? candidates.first() : null
}

function parseIdentityLine(line: string): { author: string; publisher: string } {
  const match = line.match(/^作者[:：]\s*(.*?)\s*\/\s*分类[:：]\s*(.*)$/)
  return {
    author: normalizeText(match?.[1] ?? ''),
    publisher: normalizeText(match?.[2] ?? ''),
  }
}

function parseStatusLine(line: string): {
  updateTime: string
  wordCount: string
  status: string
  isAnimated: boolean
} {
  const metadata = {
    updateTime: '',
    wordCount: '',
    status: '',
    isAnimated: false,
  }
  for (const part of line.split('/').map(value => normalizeText(value)).filter(Boolean)) {
    const update = part.match(/^更新[:：]\s*(.*)$/)
    if (update) {
      metadata.updateTime = normalizeText(update[1])
      continue
    }
    const wordCount = part.match(/^字数[:：]\s*(.*)$/)
    if (wordCount) {
      metadata.wordCount = normalizeText(wordCount[1])
      continue
    }
    if (part === '已动画化') {
      metadata.isAnimated = true
      continue
    }
    if (!metadata.status && (part === '连载中' || part === '已完结')) {
      metadata.status = part
    }
  }
  return metadata
}

function parseBook(
  $: CheerioDocument,
  root: CheerioRoot,
  bookId: string,
): SearchResult | null {
  const bookLinks = root.find('a[href]').filter((_index, anchor) => (
    parseBookId($(anchor).attr('href')) === bookId
  ))
  let title = ''
  bookLinks.each((_index, anchor) => {
    const link = $(anchor)
    const candidate = normalizeText(
      link.attr('tiptitle') || link.attr('title') || link.text(),
    )
    if (candidate.length > title.length) title = candidate
  })
  if (!title) return null

  const paragraphLines = root.find('p').toArray().map(paragraph => (
    normalizeText($(paragraph).text(), 2_000)
  ))
  const identity = parseIdentityLine(
    paragraphLines.find(line => /^作者[:：]/.test(line)) ?? '',
  )
  const status = parseStatusLine(
    paragraphLines.find(line => (
      /(?:更新|字数)[:：]/.test(line) || /(?:连载中|已完结|已动画化)/.test(line)
    )) ?? '',
  )
  const tags = normalizeText(
    (paragraphLines.find(line => /^Tags[:：]/i.test(line)) ?? '')
      .replace(/^Tags[:：]\s*/i, ''),
    1_000,
  )
  const desc = normalizeText(
    (paragraphLines.find(line => /^简介[:：]/.test(line)) ?? '')
      .replace(/^简介[:：]\s*/, ''),
    2_000,
  )

  return {
    id: bookId,
    title,
    cover: normalizeCoverUrl(root.find('img').first().attr('src')),
    author: identity.author,
    publisher: identity.publisher,
    updateTime: status.updateTime,
    wordCount: status.wordCount,
    status: status.status,
    isAnimated: status.isAnimated,
    tags,
    desc,
  }
}

function extractBooks($: CheerioDocument, table: CheerioRoot): SearchResult[] {
  const books = new Map<string, SearchResult>()
  table.find('a[href]').each((_index, anchor) => {
    const link = $(anchor)
    const bookId = parseBookId(link.attr('href'))
    if (!bookId || books.has(bookId)) return
    const root = findBookRoot($, link, bookId)
    if (!root) return
    const parsed = parseBook($, root, bookId)
    if (parsed) books.set(bookId, parsed)
  })
  return Array.from(books.values())
}

function parsePager($: CheerioDocument, requestedPage: number): {
  page: number
  totalPages: number
} {
  const stats = $('#pagestats').first().text().trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (stats) {
    const page = Number(stats[1])
    const totalPages = Number(stats[2])
    if (
      Number.isSafeInteger(page) && page > 0
      && Number.isSafeInteger(totalPages) && totalPages >= page
    ) return { page, totalPages }
  }

  let totalPages = 1
  $('.pagelink a[href*="page="]').each((_index, anchor) => {
    try {
      const page = Number(new URL($(anchor).attr('href') ?? '', WENKU_BASE_URL).searchParams.get('page'))
      if (Number.isSafeInteger(page) && page > totalPages) totalPages = page
    } catch {
      // Ignore malformed pagination links from the remote page.
    }
  })
  return { page: requestedPage, totalPages: Math.max(requestedPage, totalPages) }
}

function matchesQuery(book: SearchResult, query: CatalogQuery): boolean {
  if (query.publisher) {
    const label = PUBLISHER_LABELS.get(query.publisher)
    if (!label || book.publisher !== label) return false
  }
  if (query.tag && !book.tags?.split(/\s+/).includes(query.tag)) return false
  if (query.status === 'completed' && book.status !== '已完结') return false
  if (query.status === 'serializing' && book.status !== '连载中') return false
  if (query.animation === 'animated' && !book.isAnimated) return false
  return true
}

export function parseCatalogPage(
  $: CheerioDocument,
  query: CatalogQuery,
): Omit<CatalogPage, 'fetchedAt' | 'stale'> {
  const table = $('table').filter((_index, element) => (
    normalizeText($(element).find('caption').first().text(), 200).includes('轻小说')
  )).first()
  if (table.length === 0) throw new Error('轻小说列表结构已变化，请稍后重试')

  const pager = parsePager($, query.page)
  return {
    query: { ...query },
    books: extractBooks($, table).filter(book => matchesQuery(book, query)),
    page: pager.page,
    totalPages: pager.totalPages,
  }
}
