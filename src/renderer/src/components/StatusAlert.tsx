type Props = {
  type: 'error' | 'success' | 'warning'
  message: string | null
  onDismiss?: () => void
}

export default function StatusAlert({ type, message, onDismiss }: Props) {
  if (!message) return null

  const styles = {
    error: 'border-red-500/30 bg-red-900/20 text-red-400',
    success: 'border-green-500/30 bg-green-900/20 text-green-400',
    warning: 'border-yellow-500/30 bg-yellow-900/20 text-yellow-400',
  }

  return (
    <div className={`flex items-start gap-3 p-3 rounded border text-sm ${styles[type]} mb-4`}>
      <span className="flex-1 whitespace-pre-wrap">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-50 hover:opacity-100">&times;</button>
      )}
    </div>
  )
}
