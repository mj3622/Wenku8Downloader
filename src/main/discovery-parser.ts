import * as cheerio from 'cheerio'
import {
  RANKING_TITLES,
  type DiscoveryBook,
  type DiscoverySection,
  type RankingPage,
  type RankingType,
} from '../shared/ipc-types'
import { WENKU_BASE_URL } from './wenku-network'

type CheerioDocument = ReturnType<typeof cheerio.load>

const BASE_URL = WENKU_BASE_URL
const RANKING_PAGE_SIZE = 20

const HOME_SECTIONS: Array<{
  key: string
  sourceTitle: string
  title: string
  moreRanking: RankingType
  ranked?: boolean
}> = [
  { key: 'new-books', sourceTitle: '新书风云榜', title: '新书风云榜', moreRanking: 'postdate' },
  {
    key: 'weekly-recommendations',
    sourceTitle: '本周会员推荐榜',
    title: '本周会员推荐榜',
    moreRanking: 'weekvote',
  },
  {
    key: 'daily-hot', sourceTitle: '今日热榜', title: '今日热榜', moreRanking: 'dayvisit', ranked: true,
  },
  {
    key: 'monthly-hot', sourceTitle: '本月热点', title: '本月热点', moreRanking: 'monthvisit', ranked: true,
  },
  {
    key: 'most-followed', sourceTitle: '最受关注', title: '最受关注', moreRanking: 'goodnum', ranked: true,
  },
  {
    key: 'recent-updates',
    sourceTitle: '最近更新轻小说',
    title: '最近更新',
    moreRanking: 'lastupdate',
  },
  { key: 'animated', sourceTitle: '已动画化', title: '已动画化', moreRanking: 'anime' },
  { key: 'latest', sourceTitle: '最新入库', title: '最新入库', moreRanking: 'postdate' },
]

function parseBookId(href: string | undefined): string | null {
  if (!href || href.length > 2_048) return null
  try {
    const path = new URL(href, BASE_URL).pathname
    return path.match(/^\/book\/(\d{1,12})\.htm$/)?.[1] ?? null
  } catch {
    return null
  }
}

function normalizeCoverUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || rawUrl.length > 2_048) return null
  try {
    const url = new URL(rawUrl, BASE_URL)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.hostname !== 'img.wenku8.com'
    ) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

export function coverUrlForBook(bookId: string): string {
  if (!/^\d{1,12}$/.test(bookId)) return ''
  return `https://img.wenku8.com/image/${Math.floor(Number(bookId) / 1000)}/${bookId}/${bookId}s.jpg`
}

function extractBooks(
  $: CheerioDocument,
  root: ReturnType<CheerioDocument>,
  ranked = false,
  rankOffset = 0,
): DiscoveryBook[] {
  const found = new Map<string, { title: string; cover: string | null }>()

  root.find('a[href]').each((_index, anchor) => {
    const link = $(anchor)
    const id = parseBookId(link.attr('href'))
    if (!id) return
    const title = (
      link.attr('tiptitle')
      || link.attr('title')
      || link.find('img').attr('alt')
      || link.text()
    ).trim().slice(0, 500)
    const cover = normalizeCoverUrl(link.find('img').first().attr('src'))
    const existing = found.get(id)
    if (!existing) {
      found.set(id, { title, cover })
      return
    }
    if (title.length > existing.title.length) existing.title = title
    if (!existing.cover && cover) existing.cover = cover
  })

  return Array.from(found.entries()).flatMap(([id, value], index) => {
    if (!value.title) return []
    return [{
      id,
      title: value.title,
      cover: value.cover ?? coverUrlForBook(id),
      ...(ranked ? { rank: rankOffset + index + 1 } : {}),
    }]
  })
}

export function parseDiscoveryHome($: CheerioDocument): DiscoverySection[] {
  const sections: DiscoverySection[] = []
  for (const definition of HOME_SECTIONS) {
    const block = $('.block').filter((_index, element) => (
      $(element).find('.blocktitle').first().text().trim() === definition.sourceTitle
    )).first()
    if (block.length === 0) continue
    sections.push({
      key: definition.key,
      title: definition.title,
      moreRanking: definition.moreRanking,
      books: extractBooks($, block, definition.ranked),
    })
  }
  if (sections.length === 0) throw new Error('网站首页推荐结构已变化，请稍后重试')
  return sections
}

function parsePager($: CheerioDocument, requestedPage: number): {
  page: number
  totalPages: number
} {
  const stats = $('#pagestats').first().text().trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (stats) {
    const page = Number(stats[1])
    const totalPages = Number(stats[2])
    if (Number.isSafeInteger(page) && page > 0
      && Number.isSafeInteger(totalPages) && totalPages >= page) {
      return { page, totalPages }
    }
  }

  let totalPages = 1
  $('.pagelink a[href*="page="]').each((_index, anchor) => {
    try {
      const page = Number(new URL($(anchor).attr('href') ?? '', BASE_URL).searchParams.get('page'))
      if (Number.isSafeInteger(page) && page > totalPages) totalPages = page
    } catch {
      // Ignore malformed pagination links.
    }
  })
  return { page: requestedPage, totalPages: Math.max(requestedPage, totalPages) }
}

export function parseRankingPage(
  $: CheerioDocument,
  type: RankingType,
  requestedPage: number,
): Omit<RankingPage, 'fetchedAt' | 'stale'> {
  const table = $('table.grid').first()
  if (table.length === 0 || table.find('caption').length === 0) {
    throw new Error('网站排行榜结构已变化，请稍后重试')
  }
  const pager = parsePager($, requestedPage)
  return {
    type,
    title: RANKING_TITLES[type],
    page: pager.page,
    totalPages: pager.totalPages,
    books: extractBooks($, table, true, (pager.page - 1) * RANKING_PAGE_SIZE),
  }
}
