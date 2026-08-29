import type { SearchResult } from '../api/client'
import { IconChevronRight } from '@tabler/icons-react'
import BookCover from './BookCover'

type Props = {
  results: SearchResult[]
  onSelect: (id: string) => void
}

export default function SearchResultList({ results, onSelect }: Props) {
  if (results.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {results.map((item) => (
        <article
          key={item.id}
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-apple-border-subtle
                     bg-apple-card shadow-card transition-colors hover:border-apple-accent/20"
        >
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            aria-label={`通过封面查看 ${item.title} 详情`}
            className="motion-pressable block w-full cursor-pointer text-left transition-opacity hover:opacity-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/30"
          >
            <BookCover src={item.cover} title={item.title} />
          </button>
          <div className="flex flex-1 flex-col px-3 py-3">
            <h3 className="min-h-[2.5em] line-clamp-2 text-[13px] font-semibold leading-snug text-apple-heading">
              {item.title}
            </h3>
            {item.author && (
              <p className="mt-1 truncate text-xs text-apple-secondary">{item.author}</p>
            )}
            <SearchResultMetadata
              status={item.status}
              updateTime={item.updateTime}
              wordCount={item.wordCount}
              isAnimated={item.isAnimated}
            />
            <div className="flex-1" />
            <button
              onClick={() => onSelect(item.id)}
              aria-label={`查看 ${item.title} 详情`}
              className="motion-pressable mt-3 inline-flex w-full items-center justify-center gap-1 rounded-lg
                         bg-apple-accent-light py-2 text-xs font-medium text-apple-accent hover:bg-apple-accent/15"
            >
              查看详情
              <IconChevronRight aria-hidden="true" size={14} stroke={1.8} />
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function SearchResultMetadata({
  status,
  updateTime,
  wordCount,
  isAnimated,
}: Pick<SearchResult, 'status' | 'updateTime' | 'wordCount' | 'isAnimated'>) {
  const hasPrimaryRow = Boolean(status || wordCount)
  const hasSecondaryRow = Boolean(updateTime || isAnimated)

  return (
    <div className="mt-2 min-h-[3.25rem] space-y-1.5 text-xs">
      {hasPrimaryRow && (
        <div className="flex min-h-5 flex-wrap items-center gap-1.5">
          {status && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${
                status.includes('完结')
                  ? 'bg-apple-bg text-apple-secondary'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {status}
            </span>
          )}
          {wordCount && (
            <span className="text-apple-tertiary">{wordCount}</span>
          )}
        </div>
      )}
      {hasSecondaryRow && (
        <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-apple-tertiary">
          {updateTime && <span>{updateTime} 更新</span>}
          {isAnimated && (
            <span className="inline-flex rounded-full bg-apple-accent-light px-2 py-0.5 text-[11px] font-medium leading-4 text-apple-accent">
              已动画化
            </span>
          )}
        </div>
      )}
    </div>
  )
}
