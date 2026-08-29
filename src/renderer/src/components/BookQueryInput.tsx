import { useId, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'

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
    <form
      className="mb-6 flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <div className="flex-1">
        <label htmlFor={inputId} className="mb-1 block text-sm text-apple-secondary">
          {label}
        </label>
        <input
          id={inputId}
          className="w-full rounded-xl border border-apple-border-input bg-apple-card px-3 py-2
                     text-sm text-apple-heading placeholder:text-apple-tertiary
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
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="motion-pressable inline-flex shrink-0 items-center gap-1.5 rounded-[24px] bg-apple-accent px-6 py-2.5 text-[13px]
                   font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconSearch aria-hidden="true" size={16} stroke={1.8} />
        {loading ? '查询中...' : '查询'}
      </button>
    </form>
  )
}
