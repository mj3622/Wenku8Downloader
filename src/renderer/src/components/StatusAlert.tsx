type Props = {
  type: 'error' | 'success' | 'warning'
  message: string | null
  onDismiss?: () => void
}

export default function StatusAlert({ type, message, onDismiss }: Props) {
  if (!message) return null

  const styles = {
    error: 'border-red-200 bg-red-50 text-red-600',
    success: 'border-green-200 bg-green-50 text-green-600',
    warning: 'border-amber-200 bg-amber-50 text-amber-600',
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-[12px] ${styles[type]} mb-4`}
    >
      <span className="flex-1 whitespace-pre-wrap leading-relaxed">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-40 hover:opacity-100 transition-opacity text-base leading-none">
          &times;
        </button>
      )}
    </div>
  )
}
