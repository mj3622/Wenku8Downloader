import { useCallback, useEffect, useRef, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { useToastStore, type ToastItem, type ToastTone } from '../stores/toastStore'

const toneClasses: Record<ToastTone, { border: string; dot: string }> = {
  success: { border: 'border-emerald-200', dot: 'bg-emerald-500' },
  info: { border: 'border-blue-200', dot: 'bg-blue-500' },
  warning: { border: 'border-amber-200', dot: 'bg-amber-500' },
  error: { border: 'border-red-200', dot: 'bg-red-500' },
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss)
  const [paused, setPaused] = useState(false)
  const [closingVersion, setClosingVersion] = useState<number | null>(null)
  const remainingMs = useRef(item.durationMs)
  const closing = closingVersion === item.updatedAt
  const beginDismiss = useCallback(
    () => setClosingVersion(item.updatedAt),
    [item.updatedAt],
  )

  useEffect(() => {
    remainingMs.current = item.durationMs
  }, [item.durationMs, item.updatedAt])

  useEffect(() => {
    if (paused || closing) return undefined

    const startedAt = Date.now()
    const timer = window.setTimeout(beginDismiss, remainingMs.current)
    return () => {
      window.clearTimeout(timer)
      remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt))
    }
  }, [beginDismiss, closing, item.updatedAt, paused])

  return (
    <article
      className={`toast-card relative flex w-full gap-3 rounded-xl border bg-white/95 p-4 pr-11 shadow-lg backdrop-blur ${
        closing ? 'toast-card--closing pointer-events-none' : 'pointer-events-auto'
      } ${toneClasses[item.tone].border}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false)
        }
      }}
      onTransitionEnd={(event) => {
        if (closing && event.target === event.currentTarget && event.propertyName === 'opacity') {
          dismiss(item.id)
        }
      }}
    >
      <span
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${toneClasses[item.tone].dot}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-semibold text-apple-heading">{item.title}</p>
        <p className="mt-1 text-sm leading-5 text-apple-body">{item.message}</p>
        {item.action && (
          <a
            className="motion-pressable mt-2 inline-flex text-sm font-medium text-apple-accent hover:underline focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
            href={item.action.href}
            onClick={beginDismiss}
          >
            {item.action.label}
          </a>
        )}
      </div>
      <button
        type="button"
        className="motion-pressable absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-apple-secondary hover:bg-black/5 hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
        aria-label={`关闭提示：${item.title}`}
        onClick={beginDismiss}
      >
        <IconX aria-hidden="true" size={16} stroke={1.8} />
      </button>
    </article>
  )
}

export default function ToastViewport() {
  const items = useToastStore((state) => state.items)

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
      aria-label="通知"
    >
      {items.map((item) => <ToastCard key={item.id} item={item} />)}
    </div>
  )
}
