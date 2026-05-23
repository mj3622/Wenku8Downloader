import { useRef } from 'react'
import type { SearchResult } from '../api/client'
import { useDownloadStore } from '../stores/downloadStore'

type Props = {
  results: SearchResult[]
  onSelect: (id: string) => void
  loading?: boolean
}

export default function SearchResultList({ results, onSelect, loading = false }: Props) {
  if (results.length === 0) return null

  const tasks = useDownloadStore((s) => s.tasks)
  const downloadEpub = useDownloadStore((s) => s.downloadEpub)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {results.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl bg-apple-card border border-apple-border-subtle shadow-card
                     hover:shadow-md hover:scale-[1.02] transition-all duration-200
                     overflow-hidden cursor-pointer"
          onClick={() => onSelect(item.id)}
        >
          <CoverImage src={item.cover} title={item.title} status={item.status} />
          <div className="px-3.5 py-3">
            <h4 className="text-[13px] font-semibold text-apple-heading leading-snug line-clamp-2">
              {item.title}
            </h4>
            {item.author && (
              <p className="text-[12px] text-apple-secondary mt-1 truncate">{item.author}</p>
            )}
            <div className="mt-2">
              {tasks.some((t) => t.bookId === item.id) ? (
                <button
                  disabled
                  className="w-full py-1.5 text-[12px] bg-apple-card border border-apple-border-subtle
                             text-apple-tertiary rounded-[10px] cursor-not-allowed"
                >
                  已添加
                </button>
              ) : (
                <button
                  disabled={loading}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (loading) return
                    downloadEpub(item.id, item.title, item.cover)
                  }}
                  className="w-full py-1.5 text-[12px] bg-apple-accent hover:opacity-90 disabled:opacity-40
                             text-white rounded-[10px] font-medium transition-opacity"
                >
                  {loading ? '加载中...' : '下载'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function CoverImage({ src, title, status }: { src?: string; title: string; status?: string }) {
  const retries = useRef(0)

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (retries.current < 2) {
      retries.current += 1
      const img = e.currentTarget
      img.src = `${src}?retry=${retries.current}`
    }
  }

  if (!src) {
    return (
      <div className="relative w-full aspect-[2/3] bg-apple-accent-light flex items-center justify-center">
        <span className="text-apple-accent text-[28px] font-bold opacity-30">
          {title.charAt(0)}
        </span>
        {status && <StatusBadge status={status} />}
      </div>
    )
  }

  return (
    <div className="relative aspect-[2/3]">
      <img
        src={src}
        alt={title}
        className="w-full h-full object-contain bg-apple-bg"
        onError={handleError}
      />
      {status && <StatusBadge status={status} />}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="absolute top-2 left-2 text-[10px] bg-apple-accent text-white
                     px-2 py-0.5 rounded-[8px] font-medium">
      {status}
    </span>
  )
}
