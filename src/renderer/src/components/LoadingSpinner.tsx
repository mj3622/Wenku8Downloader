type Props = {
  text?: string
}

export default function LoadingSpinner({ text = '加载中...' }: Props) {
  return (
    <div className="flex items-center gap-3 text-apple-secondary mb-4">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
        <circle
          className="opacity-20"
          cx="12" cy="12" r="10"
          stroke="currentColor" strokeWidth="4" fill="none"
        />
        <path
          className="opacity-60"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-[12px]">{text}</span>
    </div>
  )
}
