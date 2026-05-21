import type { BookInfo } from '../api/client'

type Props = {
  book: BookInfo
  actions?: React.ReactNode
}

const SKIP_KEYS = new Set(['cover', '标题', '简介'])

export default function BookInfoCard({ book, actions }: Props) {
  const { basic_info } = book

  return (
    <div className="flex items-start gap-5 p-5 rounded-2xl bg-apple-card border border-apple-border-subtle shadow-card">
      {basic_info['cover'] && (
        <img
          src={basic_info['cover']}
          alt={basic_info['标题']}
          className="w-[100px] rounded-[10px] shadow-sm flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <h3 className="text-[17px] font-semibold tracking-tight mb-2 text-apple-heading">
          {basic_info['标题']}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] leading-loose">
          {Object.entries(basic_info).map(([key, value]) => {
            if (SKIP_KEYS.has(key)) return null
            return (
              <div key={key} className="flex">
                <span className="text-apple-tertiary mr-2">{key}</span>
                <span className="text-apple-body truncate">{value}</span>
              </div>
            )
          })}
        </div>
        {basic_info['简介'] && (
          <p className="text-[12px] text-apple-secondary mt-3 line-clamp-4 leading-relaxed">
            {basic_info['简介']}
          </p>
        )}
        {actions && <div className="mt-4">{actions}</div>}
      </div>
    </div>
  )
}
