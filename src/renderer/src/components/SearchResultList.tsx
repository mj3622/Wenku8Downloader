import type { SearchResult } from '../api/client'

type Props = {
  results: SearchResult[]
  onSelect: (id: string) => void
}

export default function SearchResultList({ results, onSelect }: Props) {
  return (
    <div className="space-y-3">
      {results.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-4 p-3 rounded-lg border border-gray-800
                     hover:border-blue-500/30 hover:bg-gray-800/50 transition-colors"
        >
          {item.cover && (
            <img
              src={item.cover}
              alt={item.title}
              className="w-16 h-20 object-cover rounded flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm">{item.title}</h4>
            <div className="text-xs text-gray-500 mt-1 space-x-3">
              {item.author && <span>作者：{item.author}</span>}
              {item.status && <span>状态：{item.status}</span>}
              <span>编号：{item.id}</span>
            </div>
            {item.tags && (
              <p className="text-xs text-gray-600 mt-1">标签：{item.tags}</p>
            )}
            {item.desc && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.desc}</p>
            )}
          </div>
          <button
            className="px-3 py-1.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-500/30
                       rounded hover:bg-blue-600/30 transition-colors flex-shrink-0"
            onClick={() => onSelect(item.id)}
          >
            查看详情
          </button>
        </div>
      ))}
    </div>
  )
}
