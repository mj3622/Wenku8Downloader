import { useRef } from 'react'
import type { SearchResult } from '../api/client'

type Props = {
  results: SearchResult[]
  onSelect: (id: string) => void
}

export default function SearchResultList({ results, onSelect }: Props) {
  if (results.length === 0) return null

  return (
    <div className="grid grid-cols-5 gap-3">
      {results.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl bg-apple-card border border-apple-border-subtle shadow-card
                     overflow-hidden flex flex-col"
        >
          <CoverImage src={item.cover} title={item.title} />
          <div className="px-3 py-2.5 flex flex-col flex-1">
            <h4 className="text-[12px] font-semibold text-apple-heading leading-snug line-clamp-2 min-h-[2.4em]">
              {item.title}
            </h4>
            {item.author && (
              <p className="text-[11px] text-apple-secondary mt-1 truncate">{item.author}</p>
            )}
            <p className="text-[10px] text-apple-tertiary mt-1 leading-relaxed">
              <span className={item.status === '已完结' ? 'text-apple-secondary' : 'text-apple-accent'}>
                {item.status}
              </span>
              {item.updateTime && (
                <>
                  <span className="mx-1">·</span>
                  <span>{item.updateTime}</span>
                </>
              )}
            </p>
            <div className="flex-1" />
            <button
              onClick={() => onSelect(item.id)}
              className="w-full mt-2 py-1.5 text-[11px] bg-apple-accent hover:opacity-90
                         text-white rounded-[8px] font-medium transition-opacity"
            >
              详情
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function CoverImage({ src, title }: { src?: string; title: string }) {
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
      <div className="w-full aspect-[2/3] bg-apple-accent-light flex items-center justify-center">
        <span className="text-apple-accent text-[28px] font-bold opacity-30">
          {title.charAt(0)}
        </span>
      </div>
    )
  }

  return (
    <div className="aspect-[2/3]">
      <img
        src={src}
        alt={title}
        className="w-full h-full object-cover bg-apple-bg"
        onError={handleError}
      />
    </div>
  )
}
