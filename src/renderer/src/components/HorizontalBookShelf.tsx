import { useEffect, useRef } from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import type { DiscoverySection } from '../../../shared/ipc-types'
import DiscoveryBookTile from './DiscoveryBookTile'

type Props = {
  section: DiscoverySection
}

export default function HorizontalBookShelf({ section }: Props) {
  const shelfRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const shelf = shelfRef.current
    if (!shelf) return

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const maxScrollLeft = Math.max(0, shelf.scrollWidth - shelf.clientWidth)
      const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, shelf.scrollLeft + event.deltaY))
      if (Math.abs(nextScrollLeft - shelf.scrollLeft) < 1) return
      event.preventDefault()
      shelf.scrollLeft = nextScrollLeft
    }

    shelf.addEventListener('wheel', handleWheel, { passive: false })
    return () => shelf.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <section aria-labelledby={`discovery-${section.key}`}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id={`discovery-${section.key}`} className="text-[17px] font-semibold text-apple-heading">
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
      <div
        ref={shelfRef}
        data-horizontal-shelf
        tabIndex={0}
        aria-label={`${section.title}，可横向滚动`}
        className="horizontal-book-shelf -mx-1 flex gap-3 overflow-x-auto px-1 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20"
      >
        {section.books.map((book) => <DiscoveryBookTile key={book.id} book={book} />)}
      </div>
    </section>
  )
}
