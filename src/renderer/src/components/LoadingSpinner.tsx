import { IconLoader2 } from '@tabler/icons-react'

type Props = {
  text?: string
}

export default function LoadingSpinner({ text = '加载中...' }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 text-apple-secondary py-20"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <IconLoader2 aria-hidden="true" className="motion-spinner h-8 w-8 animate-spin" stroke={1.8} />
      <span className="text-sm">{text}</span>
    </div>
  )
}
