import { useEffect } from 'react'
import {
  IconArrowLeft,
  IconBookOff,
  IconRefresh,
} from '@tabler/icons-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  RANKING_OPTIONS,
  RANKING_TYPES,
  type RankingType,
} from '../../../shared/ipc-types'
import DiscoveryBookTile from '../components/DiscoveryBookTile'
import Pagination from '../components/Pagination'
import StatusAlert from '../components/StatusAlert'
import { rankingCacheKey, useDiscoveryStore } from '../stores/discoveryStore'

function isRankingType(value: string | undefined): value is RankingType {
  return value !== undefined && RANKING_TYPES.includes(value as RankingType)
}

function parsePage(rawPage: string | null): number {
  if (!rawPage || !/^\d+$/.test(rawPage)) return 1
  const page = Number(rawPage)
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1
}

const rankingGridClass = 'grid grid-cols-4 gap-x-5 gap-y-8 min-[1100px]:grid-cols-5 min-[1100px]:gap-x-7'

function RankingSkeleton() {
  return (
    <div
      className={rankingGridClass}
      role="status"
      aria-label="正在加载排行榜"
      data-ranking-skeleton
    >
      {Array.from({ length: 20 }, (_, index) => (
        <div key={index}>
          <div className="aspect-[2/3] animate-pulse rounded-lg bg-black/[0.06] motion-reduce:animate-none" />
          <div className="mt-2.5 flex gap-2">
            <div className="h-4 w-6 flex-none animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
            <div className="h-3 w-20 animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RankingPage() {
  const { type: rawType } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const type = isRankingType(rawType) ? rawType : null
  const rawPage = searchParams.get('page')
  const page = parsePage(rawPage)
  const key = type ? rankingCacheKey(type, page) : null
  const entry = useDiscoveryStore((state) => key ? state.rankings[key] : undefined)
  const loadRanking = useDiscoveryStore((state) => state.loadRanking)

  useEffect(() => {
    if (rawPage !== String(page)) setSearchParams({ page: String(page) }, { replace: true })
  }, [page, rawPage, setSearchParams])

  useEffect(() => {
    if (type) void loadRanking(type, page)
  }, [loadRanking, page, type])

  if (!type) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <StatusAlert type="error" message="这个排行榜不存在，请返回发现页重新选择。" announce={false} />
        <Link
          to="/discover"
          className="motion-pressable inline-flex rounded-lg bg-apple-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
        >
          返回发现
        </Link>
      </div>
    )
  }

  const data = entry?.data ?? null
  const title = data?.title ?? RANKING_OPTIONS.find((option) => option.type === type)?.label ?? '排行榜'
  const loading = entry?.loading ?? !data
  const refreshing = entry?.refreshing ?? false

  return (
    <div className="mx-auto max-w-6xl pb-4">
      <Link
        to="/discover"
        className="motion-pressable mb-4 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[13px] font-medium text-apple-secondary hover:bg-black/[0.03] hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
      >
        <IconArrowLeft aria-hidden="true" size={16} stroke={1.8} />
        返回发现
      </Link>

      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-apple-heading">{title}</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="ranking-type" className="sr-only">榜单类型</label>
          <select
            id="ranking-type"
            value={type}
            onChange={(event) => navigate(`/discover/ranking/${event.target.value}?page=1`)}
            className="h-9 rounded-lg border border-apple-border-input bg-white px-3 text-[13px] font-medium text-apple-body focus:border-apple-accent/30 focus:outline-none focus:ring-2 focus:ring-apple-accent/15"
          >
            {RANKING_OPTIONS.map((option) => (
              <option key={option.type} value={option.type}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            aria-label="刷新当前排行榜"
            title="刷新"
            disabled={loading || refreshing}
            onClick={() => void loadRanking(type, page, true)}
            className="motion-pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/30 hover:text-apple-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
          >
            <IconRefresh
              aria-hidden="true"
              size={18}
              stroke={1.8}
              className={refreshing ? 'motion-spinner animate-spin motion-reduce:animate-none' : ''}
            />
          </button>
        </div>
      </div>

      {loading && !data && <RankingSkeleton />}

      {!data && entry?.error && (
        <div>
          <StatusAlert type="error" message={entry.error} announce={false} />
          <button
            type="button"
            onClick={() => void loadRanking(type, page, true)}
            className="motion-pressable rounded-lg bg-apple-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
          >
            重试
          </button>
        </div>
      )}

      {data && data.books.length > 0 && (
        <>
          <div className={rankingGridClass} data-ranking-grid>
            {data.books.map((book) => (
              <DiscoveryBookTile key={book.id} book={book} variant="ranking" />
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            pageHref={(targetPage) => `/discover/ranking/${type}?page=${targetPage}`}
          />
        </>
      )}

      {data && data.books.length === 0 && (
        <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            <IconBookOff aria-hidden="true" size={22} stroke={1.7} />
          </div>
          <p className="text-sm font-medium text-apple-secondary">这一页暂时没有作品</p>
        </div>
      )}
    </div>
  )
}
