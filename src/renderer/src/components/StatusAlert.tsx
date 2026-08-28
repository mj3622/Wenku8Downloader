import { IconX } from '@tabler/icons-react'

type Props = {
  type: 'error' | 'success' | 'warning'
  message: string | null
  onDismiss?: () => void
  announce?: boolean
}

export default function StatusAlert({ type, message, onDismiss, announce = true }: Props) {
  if (!message) return null

  const styles = {
    error: 'border-red-200 bg-red-50 text-red-600',
    success: 'border-green-200 bg-green-50 text-green-600',
    warning: 'border-amber-200 bg-amber-50 text-amber-600',
  }

  return (
    <div
      className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px] ${styles[type]}`}
      role={announce ? (type === 'error' ? 'alert' : 'status') : undefined}
      aria-atomic="true"
    >
      <span className="flex-1 whitespace-pre-wrap leading-relaxed">{message}</span>
      {onDismiss && (
        <button
          type="button"
          aria-label="关闭提示"
          onClick={onDismiss}
          className="motion-pressable -mr-1 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md opacity-60 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/20"
        >
          <IconX aria-hidden="true" size={16} stroke={1.8} />
        </button>
      )}
    </div>
  )
}
