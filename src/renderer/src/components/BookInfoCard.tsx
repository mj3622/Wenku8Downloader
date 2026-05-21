import type { BookInfo } from '../api/client'

type Props = {
  book: BookInfo
  actions?: React.ReactNode
}

const SKIP_KEYS = new Set(['cover', '标题', '简介'])

export default function BookInfoCard({ book, actions }: Props) {
  const { basic_info } = book

  return (
    <div className="flex items-start gap-6 p-4 rounded-lg border border-gray-800 bg-gray-900/50">
      {basic_info['cover'] && (
        <img
          src={basic_info['cover']}
          alt={basic_info['标题']}
          className="w-32 rounded shadow-lg flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold mb-2">{basic_info['标题']}</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {Object.entries(basic_info).map(([key, value]) => {
            if (SKIP_KEYS.has(key)) return null
            return (
              <div key={key} className="flex">
                <span className="text-gray-500 mr-2">{key}：</span>
                <span className="text-gray-300 truncate">{value}</span>
              </div>
            )
          })}
        </div>
        {basic_info['简介'] && (
          <p className="text-sm text-gray-400 mt-3 line-clamp-4">{basic_info['简介']}</p>
        )}
        {actions && <div className="mt-3">{actions}</div>}
      </div>
    </div>
  )
}
