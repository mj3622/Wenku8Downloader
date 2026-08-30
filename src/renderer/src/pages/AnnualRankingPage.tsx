import { useEffect, useState } from 'react'
import { IconArrowLeft, IconBookOff, IconRefresh } from '@tabler/icons-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ANNUAL_RANKING_MAX_YEAR,
  ANNUAL_RANKING_MIN_YEAR,
  ANNUAL_RANKING_YEARS,
  type AnnualRankingCategory,
  type AnnualRankingPage as AnnualRankingData,
} from '../../../shared/ipc-types'
import StatusAlert from '../components/StatusAlert'
import Select from '../components/Select'
import { useAnnualRankingStore } from '../stores/annualRankingStore'

const GROUP_OPTIONS: Array<{ value: AnnualRankingCategory; label: string }> = [
  { value: 'bunko', label: '文库部门' },
  { value: 'tankobon', label: '单行本部门' },
]

function parseYear(value: string | undefined): number | null {
  if (!value || !/^\d{4}$/.test(value)) return null
  const year = Number(value)
  return Number.isSafeInteger(year)
    && year >= ANNUAL_RANKING_MIN_YEAR
    && year <= ANNUAL_RANKING_MAX_YEAR
    ? year
    : null
}

function AnnualSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-x-5 gap-y-8 min-[1100px]:grid-cols-5" role="status" aria-label="正在加载年度榜单">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index}>
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-black/[0.06] motion-reduce:animate-none" />
          <div className="mt-2.5 h-3 w-4/5 animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

export default function AnnualRankingPage() {
  const { year: rawYear } = useParams()
  const navigate = useNavigate()
  const year = parseYear(rawYear)
  const [group, setGroup] = useState<AnnualRankingCategory>('bunko')
  const entry = useAnnualRankingStore(state => year ? state.entries[year] : undefined)
  const load = useAnnualRankingStore(state => state.load)
  const data: AnnualRankingData | null = entry?.data ?? null
  const loading = entry?.loading ?? Boolean(year && !data)
  const refreshing = entry?.refreshing ?? false
  const error = entry?.error ?? null

  useEffect(() => {
    setGroup('bunko')
    if (year) void load(year)
  }, [load, year])

  if (!year) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <StatusAlert type="error" message="这个年度榜单不存在，请返回发现页重新选择" announce={false} />
        <Link to="/discover" className="motion-pressable inline-flex rounded-lg bg-apple-accent px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30">
          返回发现
        </Link>
      </div>
    )
  }

  const books = data?.categories[group] ?? []
  return (
    <div className="mx-auto max-w-6xl pb-4">
      <Link to="/discover" className="motion-pressable mb-4 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[13px] font-medium text-apple-secondary hover:bg-black/[0.03] hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25">
        <IconArrowLeft aria-hidden="true" size={16} stroke={1.8} />
        返回发现
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-apple-heading">这本轻小说真厉害！{year}</h1>
          <p className="mt-1 text-[13px] text-apple-secondary">按原站年度专题整理，缺失作品仅保留榜单名称</p>
        </div>
        <div className="flex items-center gap-2">
          <label id="annual-ranking-year-label" htmlFor="annual-ranking-year" className="sr-only">榜单年份</label>
          <Select
            id="annual-ranking-year"
            value={String(year)}
            onChange={nextYear => navigate(`/discover/annual/${nextYear}`)}
            options={ANNUAL_RANKING_YEARS.map(option => ({ value: String(option), label: `${option} 年` }))}
            ariaLabelledBy="annual-ranking-year-label"
            className="w-28"
            size="compact"
            align="end"
          />
          <button
            type="button"
            aria-label="刷新当前年度榜单"
            title="刷新"
            disabled={loading || refreshing}
            onClick={() => void load(year, true)}
            className="motion-pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/30 hover:text-apple-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
          >
            <IconRefresh aria-hidden="true" size={18} stroke={1.8} className={refreshing ? 'motion-spinner animate-spin motion-reduce:animate-none' : ''} />
          </button>
        </div>
      </div>

      <div className="mb-7 inline-flex rounded-lg bg-black/[0.045] p-1" role="tablist" aria-label="年度榜单部门">
        {GROUP_OPTIONS.map((option, index) => (
          <button
            key={option.value}
            id={`annual-ranking-tab-${option.value}`}
            type="button"
            role="tab"
            aria-selected={group === option.value}
            aria-controls="annual-ranking-panel"
            tabIndex={group === option.value ? 0 : -1}
            onClick={() => setGroup(option.value)}
            onKeyDown={(event) => {
              let nextIndex: number | undefined
              if (event.key === 'ArrowRight') nextIndex = (index + 1) % GROUP_OPTIONS.length
              if (event.key === 'ArrowLeft') nextIndex = (index - 1 + GROUP_OPTIONS.length) % GROUP_OPTIONS.length
              if (event.key === 'Home') nextIndex = 0
              if (event.key === 'End') nextIndex = GROUP_OPTIONS.length - 1
              if (nextIndex === undefined) return

              event.preventDefault()
              const nextGroup = GROUP_OPTIONS[nextIndex].value
              setGroup(nextGroup)
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`#annual-ranking-tab-${nextGroup}`)
                ?.focus()
            }}
            className={`motion-pressable rounded-md px-4 py-1.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25 ${group === option.value ? 'bg-white text-apple-heading shadow-sm' : 'text-apple-secondary hover:text-apple-heading'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        id="annual-ranking-panel"
        role="tabpanel"
        aria-labelledby={`annual-ranking-tab-${group}`}
        tabIndex={0}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
      >
        {loading && !data && <AnnualSkeleton />}
        {!data && error && (
          <div>
            <StatusAlert type="error" message={error} announce={false} />
            <button type="button" onClick={() => void load(year, true)} className="motion-pressable rounded-lg bg-apple-accent px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30">重试</button>
          </div>
        )}
        {data && books.length > 0 && (
          <div className="grid grid-cols-4 gap-x-5 gap-y-8 min-[1100px]:grid-cols-5 min-[1100px]:gap-x-7" data-annual-ranking-grid>
            {books.map(book => {
              const content = (
                <>
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-black/[0.045]">
                    {book.cover
                      ? <img src={book.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <span className="flex h-full items-center justify-center px-3 text-center text-xs leading-5 text-apple-tertiary">原站暂无封面</span>}
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">{book.rank}</span>
                  </div>
                  <p className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-5 text-apple-heading">{book.title}</p>
                </>
              )
              return book.bookId
                ? <Link key={`${book.rank}:${book.title}`} to={`/book/${book.bookId}`} className="motion-pressable min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25">{content}</Link>
                : <div key={`${book.rank}:${book.title}`} className="min-w-0">{content}</div>
            })}
          </div>
        )}
        {data && books.length === 0 && (
          <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
            <IconBookOff aria-hidden="true" size={24} className="mb-3 text-apple-tertiary" />
            <p className="text-sm font-medium text-apple-secondary">这个部门暂时没有可展示的作品</p>
          </div>
        )}
      </div>
    </div>
  )
}
