import { Link } from 'react-router-dom'
import { IconFileUnknown } from '@tabler/icons-react'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-apple-accent-light text-apple-accent" aria-hidden="true">
          <IconFileUnknown size={22} stroke={1.8} />
        </div>
        <h1 className="text-2xl font-bold text-apple-heading">页面不存在</h1>
        <p className="mt-2 text-sm leading-6 text-apple-secondary">
          当前链接可能已失效，你可以返回发现页或重新找书
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            to="/discover"
            className="motion-pressable rounded-lg bg-apple-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
          >
            返回发现
          </Link>
          <Link
            to="/search"
            className="motion-pressable rounded-lg border border-apple-border-input px-5 py-2.5 text-sm font-medium text-apple-heading hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
          >
            前往找书
          </Link>
        </div>
      </div>
    </div>
  )
}
