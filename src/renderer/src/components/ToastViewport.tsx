import { useEffect, useRef, useState } from 'react'
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
  const remainingMs = useRef(item.durationMs)

  useEffect(() => {
    remainingMs.current = item.durationMs
  }, [item.durationMs, item.updatedAt])

  useEffect(() => {
    if (paused) return undefined

    const startedAt = Date.now()
    const timer = window.setTimeout(() => dismiss(item.id), remainingMs.current)
    return () => {
      window.clearTimeout(timer)
      remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt))
    }
  }, [dismiss, item.id, item.updatedAt, paused])

  return (
    <article
      className={`toast-card pointer-events-auto relative flex w-full gap-3 rounded-2xl border bg-white/95 p-4 pr-11 shadow-lg backdrop-blur ${toneClasses[item.tone].border}`}
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
            className="mt-2 inline-flex text-sm font-medium text-apple-accent hover:underline focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
            href={item.action.href}
            onClick={() => dismiss(item.id)}
          >
            {item.action.label}
          </a>
        )}
      </div>
      <button
        type="button"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-apple-secondary hover:bg-black/5 hover:text-apple-heading focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
        aria-label={`关闭提示：${item.title}`}
        onClick={() => dismiss(item.id)}
      >
        ×
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
