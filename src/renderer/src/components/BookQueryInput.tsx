import { useId, useState } from 'react'

type Props = {
  label: string
  help?: string
  onQuery: (bookId: string) => void
  loading?: boolean
}

export default function BookQueryInput({ label, help, onQuery, loading }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = `${inputId}-error`

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('请输入作品编号或作品链接')
      return
    }

    const match = trimmed.match(
      /^(?:https?:\/\/)?(?:www\.)?wenku8\.net\/book\/(\d{1,12})\.htm(?:[?#].*)?$/i,
    )
    const id = match ? match[1] : /^\d{1,12}$/.test(trimmed) ? trimmed : ''
    if (!id) {
      setError('请输入 1 至 12 位作品编号，或完整的 Wenku8 作品链接')
      return
    }

    setError(null)
    onQuery(id)
  }

  return (
    <div className="mb-6">
      <label htmlFor={inputId} className="block text-[12px] text-apple-secondary mb-1">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          className="w-full px-4 py-2.5 bg-apple-card border border-apple-border-input rounded-xl
                     text-[13px] text-apple-heading placeholder:text-apple-tertiary
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10
                     transition-colors"
          placeholder={help}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button
          disabled={loading}
          className="shrink-0 px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                     rounded-[24px] text-[13px] font-medium text-white transition-opacity"
          onClick={handleSubmit}
        >
          {loading ? '查询中...' : '查询'}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
