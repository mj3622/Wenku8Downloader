import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from '../stores/toastStore'

export default function NotFoundPage() {
  useEffect(() => {
    toast.warning({
      title: '页面不存在',
      message: '当前链接可能已失效，请返回首页或重新检索作品。',
      action: { label: '返回首页', href: '#/' },
    })
  }, [])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-apple-accent-light text-xl font-semibold text-apple-accent" aria-hidden="true">
          ?
        </div>
        <h2 className="text-2xl font-bold text-apple-heading">页面不存在</h2>
        <p className="mt-2 text-sm leading-6 text-apple-secondary">
          当前链接可能已失效，你可以返回首页或重新检索作品。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            to="/"
            className="rounded-full bg-apple-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
          >
            返回首页
          </Link>
          <Link
            to="/search"
            className="rounded-full border border-apple-border-input px-5 py-2.5 text-sm font-medium text-apple-heading hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
          >
            检索作品
          </Link>
        </div>
      </div>
    </div>
  )
}
