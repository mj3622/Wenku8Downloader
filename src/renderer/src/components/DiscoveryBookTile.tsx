import { Link } from 'react-router-dom'
import type { DiscoveryBook } from '../../../shared/ipc-types'
import BookCover from './BookCover'

type Props = {
  book: DiscoveryBook
}

export default function DiscoveryBookTile({ book }: Props) {
  return (
    <Link
      to={`/book/${book.id}`}
      className="group block w-[88px] min-w-0 flex-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/35"
      title={book.title}
    >
      <div className="relative">
        <BookCover
          src={book.cover}
          title={book.title}
          loading="lazy"
          showFailureText={false}
          className="h-[132px] w-full rounded-lg border border-apple-border-subtle transition-[box-shadow,border-color] duration-150 group-hover:border-apple-border-input group-hover:shadow-md"
        />
        {book.rank !== undefined && (
          <span className="absolute left-1.5 top-1.5 min-w-5 rounded-md bg-white/90 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-apple-heading shadow-sm backdrop-blur-sm">
            {book.rank}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-[1.45] text-apple-body group-hover:text-apple-accent">
        {book.title}
      </p>
    </Link>
  )
}
