import iconv from 'iconv-lite'
import {
  CATALOG_ANIMATIONS,
  CATALOG_INITIALS,
  CATALOG_PUBLISHER_OPTIONS,
  CATALOG_SORTS,
  CATALOG_STATUSES,
  CATALOG_TAGS,
  type CatalogPage,
  type CatalogQuery,
} from '../shared/ipc-types'
import { parseCatalogPage } from './catalog-parser'
import type { CrawlerRequestControlFactory, WebCrawler } from './crawler'
import { WENKU_BASE_URL } from './wenku-network'

const PUBLISHERS = new Set<string>(CATALOG_PUBLISHER_OPTIONS.map(option => option.value))
const INITIALS = new Set<string>(CATALOG_INITIALS)
const TAGS = new Set<string>(CATALOG_TAGS)
const SORTS = new Set<string>(CATALOG_SORTS)
const STATUSES = new Set<string>(CATALOG_STATUSES)
const ANIMATIONS = new Set<string>(CATALOG_ANIMATIONS)

function encodeGbkQueryValue(value: string): string {
  return Array.from(iconv.encode(value, 'gbk')).map(byte => {
    const character = String.fromCharCode(byte)
    return /^[A-Za-z0-9._~-]$/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
}

function validateQuery(query: CatalogQuery): void {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new TypeError('找书条件无效')
  if (query.publisher !== undefined && !PUBLISHERS.has(query.publisher)) {
    throw new TypeError('出版社筛选无效')
  }
  if (query.initial !== undefined && !INITIALS.has(query.initial)) {
    throw new TypeError('首字母筛选无效')
  }
  if (query.tag !== undefined && !TAGS.has(query.tag)) throw new TypeError('标签筛选无效')
  if (!SORTS.has(query.sort)) throw new TypeError('排序方式无效')
  if (!STATUSES.has(query.status)) throw new TypeError('连载状态无效')
  if (!ANIMATIONS.has(query.animation)) throw new TypeError('动画化筛选无效')
  if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 500) {
    throw new TypeError('页码无效')
  }
  if (query.tag && (query.publisher || query.initial)) {
    throw new TypeError('标签不能与出版社或首字母同时筛选')
  }
  if ((query.publisher || query.initial) && query.sort === 'allvisit') {
    throw new TypeError('出版社或首字母筛选仅支持按更新排序')
  }
}

function buildArticleListUrl(query: CatalogQuery): string {
  const params = new URLSearchParams()
  if (query.publisher) params.set('class', query.publisher)
  if (query.initial) params.set('initial', query.initial)
  if (query.status === 'completed') params.set('fullflag', '1')
  params.set('page', String(query.page))
  return `${WENKU_BASE_URL}/modules/article/articlelist.php?${params.toString()}`
}

function buildTagUrl(query: CatalogQuery): string {
  const params = [`t=${encodeGbkQueryValue(query.tag!)}`]
  if (query.sort === 'allvisit') params.push('v=1')
  else if (query.status === 'completed') params.push('v=2')
  else if (query.animation === 'animated') params.push('v=3')
  params.push(`page=${query.page}`)
  return `${WENKU_BASE_URL}/modules/article/tags.php?${params.join('&')}`
}

function buildToplistUrl(sort: 'allvisit' | 'anime', page: number): string {
  return `${WENKU_BASE_URL}/modules/article/toplist.php?sort=${sort}&page=${page}`
}

export class WenkuCatalogSource {
  constructor(
    private readonly crawler: Pick<WebCrawler, 'fetch'>,
    private readonly requestControlFactory?: CrawlerRequestControlFactory,
  ) {}

  async fetchPage(query: CatalogQuery): Promise<Omit<CatalogPage, 'fetchedAt' | 'stale'>> {
    validateQuery(query)
    let url: string
    if (query.tag) url = buildTagUrl(query)
    else if (query.sort === 'allvisit') url = buildToplistUrl('allvisit', query.page)
    else if (query.animation === 'animated' && query.status === 'all' && !query.publisher && !query.initial) {
      url = buildToplistUrl('anime', query.page)
    } else url = buildArticleListUrl(query)

    const control = this.requestControlFactory?.('document', url)
    return parseCatalogPage(
      await this.crawler.fetch(url, true, undefined, control),
      query,
    )
  }
}
