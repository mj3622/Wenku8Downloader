import { useEffect, useState } from 'react'
import { IconRefresh, IconRestore } from '@tabler/icons-react'
import {
  CATALOG_PUBLISHER_OPTIONS,
  CATALOG_TAG_GROUPS,
  type CatalogQuery,
} from '../../../shared/ipc-types'

type CatalogFilters = Partial<Omit<CatalogQuery, 'page'>>

type Props = {
  query: CatalogQuery
  loading: boolean
  onChange: (filters: CatalogFilters) => void
  onReset: () => void
  onRefresh: () => void
}

const selectClass = `h-10 w-full rounded-lg border border-apple-border-input bg-white px-3 text-sm text-apple-heading
  focus:border-apple-accent/40 focus:outline-none focus:ring-2 focus:ring-apple-accent/10 disabled:cursor-not-allowed disabled:opacity-50`

function groupForTag(tag: CatalogQuery['tag']): string {
  return CATALOG_TAG_GROUPS.find(group => group.tags.some(item => item === tag))?.key ?? 'daily'
}

export default function CatalogFilters({ query, loading, onChange, onReset, onRefresh }: Props) {
  const [tagGroup, setTagGroup] = useState(() => groupForTag(query.tag))
  const selectedGroup = CATALOG_TAG_GROUPS.find(group => group.key === tagGroup)
    ?? CATALOG_TAG_GROUPS[0]

  useEffect(() => {
    if (query.tag) setTagGroup(groupForTag(query.tag))
  }, [query.tag])

  const changePublisher = (publisher: string) => {
    onChange({
      publisher: publisher ? publisher as CatalogQuery['publisher'] : undefined,
      ...(publisher ? { tag: undefined, sort: 'lastupdate' as const } : {}),
    })
  }

  const changeInitial = (initial: string) => {
    onChange({
      initial: initial ? initial as CatalogQuery['initial'] : undefined,
      ...(initial ? { tag: undefined, sort: 'lastupdate' as const } : {}),
    })
  }

  const chooseTag = (tag?: CatalogQuery['tag']) => {
    onChange({
      tag,
      ...(tag ? { publisher: undefined, initial: undefined } : {}),
    })
  }

  return (
    <section className="mb-6 rounded-xl border border-apple-border-subtle bg-apple-card p-4" aria-label="找书筛选">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-apple-heading">筛选轻小说</h2>
          <p className="mt-0.5 text-xs text-apple-secondary">筛选会自动加载当前结果页</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="motion-pressable inline-flex h-9 items-center gap-1.5 rounded-lg border border-apple-border-input bg-white px-3 text-xs font-medium text-apple-secondary hover:border-apple-accent/25 hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20"
          >
            <IconRestore aria-hidden="true" size={15} stroke={1.8} />
            重置筛选
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="motion-pressable inline-flex h-9 items-center gap-1.5 rounded-lg bg-apple-accent-light px-3 text-xs font-medium text-apple-accent hover:bg-apple-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconRefresh aria-hidden="true" size={15} stroke={1.8} />
            {loading ? '刷新中' : '刷新结果'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <label className="min-w-0 text-xs font-medium text-apple-secondary" htmlFor="catalog-publisher">
          出版社
          <select
            id="catalog-publisher"
            value={query.publisher ?? ''}
            onChange={event => changePublisher(event.target.value)}
            className={`${selectClass} mt-1.5`}
          >
            <option value="">全部出版社</option>
            {CATALOG_PUBLISHER_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="min-w-0 text-xs font-medium text-apple-secondary" htmlFor="catalog-initial">
          首字母
          <select
            id="catalog-initial"
            value={query.initial ?? ''}
            onChange={event => changeInitial(event.target.value)}
            className={`${selectClass} mt-1.5`}
          >
            <option value="">全部首字母</option>
            <option value="1">0–9</option>
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(initial => (
              <option key={initial} value={initial}>{initial}</option>
            ))}
          </select>
        </label>

        <label className="min-w-0 text-xs font-medium text-apple-secondary" htmlFor="catalog-status">
          连载状态
          <select
            id="catalog-status"
            value={query.status}
            onChange={event => onChange({ status: event.target.value as CatalogQuery['status'] })}
            className={`${selectClass} mt-1.5`}
          >
            <option value="all">全部状态</option>
            <option value="serializing">连载中</option>
            <option value="completed">已完结</option>
          </select>
        </label>

        <label className="min-w-0 text-xs font-medium text-apple-secondary" htmlFor="catalog-animation">
          动画化
          <select
            id="catalog-animation"
            value={query.animation}
            onChange={event => onChange({ animation: event.target.value as CatalogQuery['animation'] })}
            className={`${selectClass} mt-1.5`}
          >
            <option value="all">全部作品</option>
            <option value="animated">仅动画化</option>
          </select>
        </label>

        <label className="col-span-2 min-w-0 text-xs font-medium text-apple-secondary lg:col-span-1" htmlFor="catalog-sort">
          排序
          <select
            id="catalog-sort"
            value={query.sort}
            onChange={event => onChange({ sort: event.target.value as CatalogQuery['sort'] })}
            className={`${selectClass} mt-1.5`}
          >
            <option value="lastupdate">最近更新</option>
            <option value="allvisit" disabled={Boolean(query.publisher || query.initial)}>
              热门优先
            </option>
          </select>
        </label>
      </div>

      <fieldset className="mt-4 border-t border-apple-border-subtle pt-4">
        <legend className="sr-only">作品标签</legend>
        <div className="mb-2.5 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-apple-secondary">标签</span>
          {CATALOG_TAG_GROUPS.map(group => (
            <button
              key={group.key}
              type="button"
              aria-pressed={tagGroup === group.key}
              onClick={() => setTagGroup(group.key)}
              className={`motion-pressable rounded-md px-2 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 ${
                tagGroup === group.key
                  ? 'bg-apple-accent-light text-apple-accent'
                  : 'text-apple-secondary hover:bg-apple-bg hover:text-apple-heading'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={!query.tag}
            onClick={() => chooseTag()}
            className={`motion-pressable rounded-lg border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 ${
              !query.tag
                ? 'border-apple-accent/20 bg-apple-accent-light font-medium text-apple-accent'
                : 'border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/25 hover:text-apple-heading'
            }`}
          >
            全部标签
          </button>
          {selectedGroup.tags.map(tag => (
            <button
              key={tag}
              type="button"
              aria-pressed={query.tag === tag}
              aria-label={`按${tag}标签筛选`}
              onClick={() => chooseTag(query.tag === tag ? undefined : tag)}
              className={`motion-pressable rounded-lg border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 ${
                query.tag === tag
                  ? 'border-apple-accent/20 bg-apple-accent-light font-medium text-apple-accent'
                  : 'border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/25 hover:text-apple-heading'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  )
}
