import { Link } from 'react-router-dom'
import type { DiscoveryBook } from '../../../shared/ipc-types'
import BookCover from './BookCover'

type Props = {
  book: DiscoveryBook
  variant?: 'compact' | 'ranking'
}

function compactRankClass(rank: number): string {
  if (rank === 1) return 'bg-apple-heading text-white'
  if (rank <= 3) return 'bg-white/95 text-apple-heading'
  return 'bg-white/90 text-apple-secondary'
}

export default function DiscoveryBookTile({ book, variant = 'compact' }: Props) {
  const isRanking = variant === 'ranking'

  return (
    <Link
      to={`/book/${book.id}`}
      className="group block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-apple-bg"
      title={book.title}
    >
      <div className="relative">
        <BookCover
          src={book.cover}
          title={book.title}
          loading="lazy"
          showFailureText={false}
          className="aspect-[2/3] w-full rounded-lg border border-apple-border-subtle shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow,border-color] duration-150 ease-out-emphasized group-hover:border-apple-border-input group-hover:shadow-[0_8px_20px_rgba(0,0,0,0.12)]"
        />
        {!isRanking && book.rank !== undefined && (
          <span className={`absolute left-1.5 top-1.5 min-w-5 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums shadow-sm backdrop-blur-sm ${compactRankClass(book.rank)}`}>
            {book.rank}
          </span>
        )}
      </div>
      {isRanking ? (
        <div className="mt-2.5 flex min-w-0 items-start gap-2">
          {book.rank !== undefined && (
            <span className={`min-w-7 flex-none text-[17px] font-semibold leading-5 tabular-nums ${book.rank <= 3 ? 'text-apple-accent' : 'text-apple-tertiary'}`}>
              {book.rank}
            </span>
          )}
          <p className="line-clamp-2 min-w-0 text-[13px] font-medium leading-[1.45] text-apple-body group-hover:text-apple-accent">
            {book.title}
          </p>
        </div>
      ) : (
        <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-[1.45] text-apple-body group-hover:text-apple-accent">
          {book.title}
        </p>
      )}
    </Link>
  )
}
