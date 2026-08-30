import { useEffect, useState } from 'react'
import {
  IconArrowsSort,
  IconBuildingStore,
  IconCircleDot,
  IconMovie,
  IconRefresh,
  IconRestore,
} from '@tabler/icons-react'
import {
  CATALOG_PUBLISHER_OPTIONS,
  CATALOG_TAG_GROUPS,
  type CatalogQuery,
} from '../../../shared/ipc-types'
import Select, { type SelectOption } from './Select'

type CatalogFilters = Partial<Omit<CatalogQuery, 'page'>>

type Props = {
  query: CatalogQuery
  loading: boolean
  onChange: (filters: CatalogFilters) => void
  onReset: () => void
  onRefresh: () => void
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'serializing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

const ANIMATION_OPTIONS: SelectOption[] = [
  { value: 'all', label: '全部作品' },
  { value: 'animated', label: '仅动画化' },
]

function groupForTag(tag: CatalogQuery['tag']): string {
  return CATALOG_TAG_GROUPS.find(group => group.tags.some(item => item === tag))?.key ?? 'daily'
}

export default function CatalogFilters({ query, loading, onChange, onReset, onRefresh }: Props) {
  const [tagGroup, setTagGroup] = useState(() => groupForTag(query.tag))
  const selectedGroup = CATALOG_TAG_GROUPS.find(group => group.key === tagGroup)
    ?? CATALOG_TAG_GROUPS[0]
  const hasActiveFilters = Boolean(
    query.publisher
    || query.status !== 'all'
    || query.animation !== 'all'
    || query.sort !== 'lastupdate'
    || query.tag,
  )

  useEffect(() => {
    if (query.tag) setTagGroup(groupForTag(query.tag))
  }, [query.tag])

  const changePublisher = (publisher: string) => {
    onChange({
      publisher: publisher ? publisher as CatalogQuery['publisher'] : undefined,
      ...(publisher ? { tag: undefined, sort: 'lastupdate' as const } : {}),
    })
  }

  const chooseTag = (tag?: CatalogQuery['tag']) => {
    onChange({
      tag,
      ...(tag ? { publisher: undefined } : {}),
    })
  }

  return (
    <section className="mb-6 rounded-xl border border-apple-border-subtle bg-apple-card p-4" aria-label="找书筛选">
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <label id="catalog-publisher-label" htmlFor="catalog-publisher" className="sr-only">出版社</label>
          <Select
            id="catalog-publisher"
            value={query.publisher ?? ''}
            onChange={changePublisher}
            options={[
              { value: '', label: '全部出版社' },
              ...CATALOG_PUBLISHER_OPTIONS,
            ]}
            ariaLabelledBy="catalog-publisher-label"
            className="w-32"
            appearance="chip"
            active={Boolean(query.publisher)}
            leadingIcon={<IconBuildingStore size={16} stroke={1.8} />}
          />

          <label id="catalog-status-label" htmlFor="catalog-status" className="sr-only">连载状态</label>
          <Select
            id="catalog-status"
            value={query.status}
            onChange={status => onChange({ status: status as CatalogQuery['status'] })}
            options={STATUS_OPTIONS}
            ariaLabelledBy="catalog-status-label"
            className="w-[116px]"
            appearance="chip"
            active={query.status !== 'all'}
            leadingIcon={<IconCircleDot size={16} stroke={1.8} />}
          />

          <label id="catalog-animation-label" htmlFor="catalog-animation" className="sr-only">动画化</label>
          <Select
            id="catalog-animation"
            value={query.animation}
            onChange={animation => onChange({ animation: animation as CatalogQuery['animation'] })}
            options={ANIMATION_OPTIONS}
            ariaLabelledBy="catalog-animation-label"
            className="w-28"
            appearance="chip"
            active={query.animation !== 'all'}
            leadingIcon={<IconMovie size={16} stroke={1.8} />}
          />
        </div>

        <div className="flex flex-none items-center gap-1.5">
          <label id="catalog-sort-label" htmlFor="catalog-sort" className="sr-only">排序</label>
          <Select
            id="catalog-sort"
            value={query.sort}
            onChange={sort => onChange({ sort: sort as CatalogQuery['sort'] })}
            options={[
              { value: 'lastupdate', label: '最近更新' },
              { value: 'allvisit', label: '热门优先', disabled: Boolean(query.publisher) },
            ]}
            ariaLabelledBy="catalog-sort-label"
            className="w-[120px]"
            align="end"
            appearance="chip"
            active={query.sort !== 'lastupdate'}
            leadingIcon={<IconArrowsSort size={16} stroke={1.8} />}
          />

          <span aria-hidden="true" className="h-5 w-px bg-apple-border-medium" />
          <button
            type="button"
            aria-label="重置筛选"
            title="重置筛选"
            disabled={!hasActiveFilters}
            onClick={onReset}
            className="motion-pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/25 hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 disabled:cursor-not-allowed disabled:bg-black/[0.02] disabled:text-apple-tertiary"
          >
            <IconRestore aria-hidden="true" size={16} stroke={1.8} />
          </button>
          <button
            type="button"
            aria-label={loading ? '正在刷新筛选结果' : '刷新筛选结果'}
            title={loading ? '正在刷新' : '刷新结果'}
            onClick={onRefresh}
            disabled={loading}
            className="motion-pressable inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg bg-apple-accent-light px-0 text-xs font-medium text-apple-accent hover:bg-apple-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 disabled:cursor-not-allowed disabled:opacity-50 min-[1100px]:w-auto min-[1100px]:px-3"
          >
            <IconRefresh aria-hidden="true" size={15} stroke={1.8} />
            <span className="hidden min-[1100px]:inline">{loading ? '刷新中' : '刷新结果'}</span>
          </button>
        </div>
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
