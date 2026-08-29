import { useEffect } from 'react'
import { IconBookOff, IconRefresh } from '@tabler/icons-react'
import HorizontalBookShelf from '../components/HorizontalBookShelf'
import StatusAlert from '../components/StatusAlert'
import { useDiscoveryStore } from '../stores/discoveryStore'

function DiscoverySkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="正在加载发现内容">
      {[0, 1, 2].map((section) => (
        <div key={section}>
          <div className="mb-3 h-5 w-28 animate-pulse rounded bg-black/[0.07] motion-reduce:animate-none" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4, 5, 6].map((book) => (
              <div key={book} className="w-[88px] flex-none">
                <div className="h-[132px] animate-pulse rounded-lg bg-black/[0.06] motion-reduce:animate-none" />
                <div className="mt-2 h-3 w-16 animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DiscoverPage() {
  const {
    home,
    homeLoading,
    homeRefreshing,
    homeError,
    loadHome,
  } = useDiscoveryStore()

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  return (
    <div className="mx-auto max-w-6xl pb-4">
      <div className="mb-7 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-apple-heading">发现</h1>
        <button
          type="button"
          aria-label="刷新发现内容"
          title="刷新"
          disabled={homeLoading || homeRefreshing}
          onClick={() => void loadHome(true)}
          className="motion-pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-apple-border-input bg-white text-apple-secondary hover:border-apple-accent/30 hover:text-apple-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
        >
          <IconRefresh
            aria-hidden="true"
            size={18}
            stroke={1.8}
            className={homeRefreshing ? 'motion-spinner animate-spin motion-reduce:animate-none' : ''}
          />
        </button>
      </div>

      {!home && homeLoading && <DiscoverySkeleton />}

      {!home && homeError && (
        <div>
          <StatusAlert type="error" message={homeError} announce={false} />
          <button
            type="button"
            onClick={() => void loadHome(true)}
            className="motion-pressable rounded-lg bg-apple-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
          >
            重试
          </button>
        </div>
      )}

      {home && home.sections.length > 0 && (
        <div className="space-y-8">
          {home.sections.map((section) => (
            <HorizontalBookShelf key={section.key} section={section} />
          ))}
        </div>
      )}

      {home && home.sections.length === 0 && (
        <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent">
            <IconBookOff aria-hidden="true" size={22} stroke={1.7} />
          </div>
          <p className="text-sm font-medium text-apple-secondary">暂时没有可展示的发现内容</p>
        </div>
      )}
    </div>
  )
}
