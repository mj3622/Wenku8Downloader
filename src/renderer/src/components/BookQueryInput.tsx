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
    const match = trimmed.match(/wenku8\.net\/book\/(\d+)\.htm/)
    const id = match ? match[1] : /^\d+$/.test(trimmed) ? trimmed : ''
    if (id) onQuery(id)
  }

  return (
    <div className="flex items-end gap-3 mb-6">
      <div className="flex-1">
        <label className="block text-[12px] text-apple-secondary mb-1">{label}</label>
        <input
          className="w-full px-4 py-2.5 bg-apple-card border border-apple-border-input rounded-xl
                     text-[13px] text-apple-heading placeholder:text-apple-tertiary
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10
                     transition-colors"
          placeholder={help}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
      </div>
      <button
        disabled={loading}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={handleSubmit}
      >
        {loading ? '查询中...' : '查询'}
      </button>
    </div>
  )
}
