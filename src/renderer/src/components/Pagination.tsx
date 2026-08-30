import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { Link } from 'react-router-dom'

type Props = {
  page: number
  totalPages: number
  pageHref: (page: number) => string
  ariaLabel?: string
}

type PageItem = number | `ellipsis-${'start' | 'end'}`

function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach(value => pages.add(value))
  if (page >= totalPages - 2) {
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach(value => pages.add(value))
  }
  const sorted = Array.from(pages).filter(value => value > 0 && value <= totalPages).sort((a, b) => a - b)
  const items: PageItem[] = []
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && value - previous > 1) {
      items.push(previous === 1 ? 'ellipsis-start' : 'ellipsis-end')
    }
    items.push(value)
  })
  return items
}

export default function Pagination({ page, totalPages, pageHref, ariaLabel = '排行榜分页' }: Props) {
  if (totalPages <= 1) return null

  const linkClass = 'motion-pressable inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-apple-border-input bg-white px-2 text-[13px] font-medium text-apple-body hover:border-apple-accent/30 hover:text-apple-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25'
  const disabledClass = 'inline-flex h-9 min-w-9 cursor-not-allowed items-center justify-center rounded-lg border border-apple-border-subtle bg-white/50 px-2 text-[13px] text-apple-tertiary'

  return (
    <nav aria-label={ariaLabel} className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link to={pageHref(page - 1)} className={linkClass} aria-label="上一页">
          <IconChevronLeft aria-hidden="true" size={17} stroke={1.8} />
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true" aria-label="上一页">
          <IconChevronLeft aria-hidden="true" size={17} stroke={1.8} />
        </span>
      )}

      {pageItems(page, totalPages).map((item) => (
        typeof item === 'number' ? (
          item === page ? (
            <span
              key={item}
              aria-current="page"
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-apple-accent px-2 text-[13px] font-semibold text-white"
            >
              {item}
            </span>
          ) : (
            <Link key={item} to={pageHref(item)} className={linkClass} aria-label={`第 ${item} 页`}>
              {item}
            </Link>
          )
        ) : (
          <span key={item} className="inline-flex h-9 min-w-5 items-center justify-center text-apple-tertiary" aria-hidden="true">
            …
          </span>
        )
      ))}

      {page < totalPages ? (
        <Link to={pageHref(page + 1)} className={linkClass} aria-label="下一页">
          <IconChevronRight aria-hidden="true" size={17} stroke={1.8} />
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true" aria-label="下一页">
          <IconChevronRight aria-hidden="true" size={17} stroke={1.8} />
        </span>
      )}
    </nav>
  )
}
