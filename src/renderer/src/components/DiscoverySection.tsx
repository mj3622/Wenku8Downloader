import { IconChevronRight } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import type { CSSProperties } from 'react'
import type { DiscoveryBook, DiscoverySection } from '../../../shared/ipc-types'
import DiscoveryBookTile from './DiscoveryBookTile'

type Props = {
  section: DiscoverySection
}

type SectionHeaderProps = {
  section: DiscoverySection
}

const rankedSectionKeys = new Set(['daily-hot', 'monthly-hot', 'most-followed'])

type CoverGridStyle = CSSProperties & {
  '--discovery-columns-compact': number
  '--discovery-columns-wide': number
}

function balancedColumnCount(bookCount: number, maximum: number): number {
  if (bookCount <= maximum) return Math.max(1, bookCount)
  return Math.ceil(bookCount / Math.ceil(bookCount / maximum))
}

function SectionHeader({ section }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2
        id={`discovery-${section.key}`}
        className="text-[17px] font-semibold text-apple-heading"
      >
        {section.title}
      </h2>
      <Link
        to={`/discover/ranking/${section.moreRanking}?page=1`}
        className="motion-pressable inline-flex flex-none items-center gap-0.5 rounded-md px-1.5 py-1 text-[13px] font-medium text-apple-accent hover:bg-apple-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
      >
        更多
        <IconChevronRight aria-hidden="true" size={15} stroke={1.8} />
      </Link>
    </div>
  )
}

function EmptySection() {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-apple-border-input text-[12px] text-apple-tertiary">
      暂无作品
    </div>
  )
}

export function isRankedDiscoverySection(section: DiscoverySection): boolean {
  return rankedSectionKeys.has(section.key)
    || section.books.some((book) => book.rank !== undefined)
}

export function DiscoveryCoverSection({ section }: Props) {
  const gridStyle: CoverGridStyle = {
    '--discovery-columns-compact': balancedColumnCount(section.books.length, 6),
    '--discovery-columns-wide': balancedColumnCount(section.books.length, 8),
  }

  return (
    <section aria-labelledby={`discovery-${section.key}`} data-discovery-cover-section>
      <SectionHeader section={section} />
      {section.books.length > 0 ? (
        <div
          className="discovery-cover-grid flex w-full flex-wrap gap-x-3 gap-y-6"
          data-discovery-cover-grid
          style={gridStyle}
        >
          {section.books.map((book) => (
            <div key={book.id} className="min-w-0">
              <DiscoveryBookTile book={book} />
            </div>
          ))}
        </div>
      ) : (
        <EmptySection />
      )}
    </section>
  )
}

type CompactRankingLinkProps = {
  book: DiscoveryBook
  fallbackRank: number
}

function CompactRankingLink({ book, fallbackRank }: CompactRankingLinkProps) {
  const rank = book.rank ?? fallbackRank
  return (
    <Link
      to={`/book/${book.id}`}
      title={book.title}
      className="motion-pressable group grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-1.5 rounded-md px-1 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
    >
      <span className="text-center font-semibold tabular-nums text-apple-tertiary group-hover:text-apple-accent">
        {rank}
      </span>
      <span className="truncate font-medium text-apple-body group-hover:text-apple-accent">
        {book.title}
      </span>
    </Link>
  )
}

export function DiscoveryRankingSection({ section }: Props) {
  const leadingBooks = section.books.slice(0, 3)
  const remainingBooks = section.books.slice(3)

  return (
    <section
      className="min-w-0 px-3.5 py-5 min-[1100px]:px-5"
      aria-labelledby={`discovery-${section.key}`}
      data-discovery-ranking-section
    >
      <SectionHeader section={section} />
      {section.books.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            {leadingBooks.map((book) => <DiscoveryBookTile key={book.id} book={book} />)}
          </div>
          {remainingBooks.length > 0 && (
            <div className="mt-4 border-t border-apple-border-subtle pt-2">
              {remainingBooks.map((book, index) => (
                <CompactRankingLink key={book.id} book={book} fallbackRank={index + 4} />
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptySection />
      )}
    </section>
  )
}
