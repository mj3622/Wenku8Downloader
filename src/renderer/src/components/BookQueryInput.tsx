import { useState } from 'react'

type Props = {
  label: string
  help?: string
  onQuery: (bookId: string) => void
  loading?: boolean
}

export default function BookQueryInput({ label, help, onQuery, loading }: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    // 从输入中提取书籍编号
    const match = trimmed.match(/wenku8\.net\/book\/(\d+)\.htm/)
    const id = match ? match[1] : /^\d+$/.test(trimmed) ? trimmed : ''
    if (id) onQuery(id)
  }

  return (
    <div className="flex items-end gap-2 mb-6">
      <div className="flex-1">
        <label className="block text-sm text-gray-400 mb-1">{label}</label>
        <input
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                     focus:outline-none focus:border-blue-500 transition-colors"
          placeholder={help}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
      </div>
      <button
        disabled={loading}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                   rounded text-sm font-medium transition-colors"
        onClick={handleSubmit}
      >
        {loading ? '查询中...' : '查询'}
      </button>
    </div>
  )
}
