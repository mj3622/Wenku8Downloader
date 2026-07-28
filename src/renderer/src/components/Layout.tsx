import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import logoUrl from '../../../../resources/icon.png'
import { api } from '../api/client'

const navItems = [
  {
    to: '/',
    label: '主页',
    icon: (
      <svg viewBox="0 0 18 18" fill="currentColor" width="20" height="20">
        <path d="M9 1.5L1.5 8.5H4V16H7.5V11H10.5V16H14V8.5H16.5L9 1.5Z" />
      </svg>
    ),
  },
  {
    to: '/search',
    label: '检索',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20" strokeLinecap="round">
        <circle cx="7.5" cy="7.5" r="5" />
        <line x1="11" y1="11" x2="16" y2="16" />
      </svg>
    ),
  },
  {
    to: '/download',
    label: '下载',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2V12M5 8L9 12L13 8" />
        <path d="M3 15V16C3 16.5523 3.44772 17 4 17H14C14.5523 17 15 16.5523 15 16V15" />
      </svg>
    ),
  },
  {
    to: '/config',
    label: '配置',
    icon: (
      <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20" strokeLinecap="round">
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 1V4M9 14V17M17 9H14M4 9H1M15 3L13 5M5 13L3 15M15 15L13 13M5 5L3 3" />
      </svg>
    ),
  },
]

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  const currentPath = location.split('?')[0]

  return (
    <div className="flex h-screen min-w-0 flex-col bg-apple-bg text-apple-heading md:flex-row">
      <aside className="flex w-full flex-shrink-0 flex-row items-center bg-white border-b border-apple-border-medium md:h-full md:w-[220px] md:flex-col md:items-stretch md:border-b-0 md:border-r">
        {/* Brand */}
        <div className="flex-shrink-0 px-3 py-2 md:px-5 md:pt-6 md:pb-5">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="文库下载器" className="w-8 h-8 md:w-10 md:h-10" />
            <div className="hidden md:block">
              <h1 className="text-[17px] font-bold tracking-tight">文库下载器</h1>
              <p className="text-[12px] text-apple-tertiary">Wenku8 Downloader</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex min-w-0 flex-1 flex-row gap-0.5 overflow-x-auto px-1 md:flex-col md:overflow-visible md:px-2">
          {navItems.map((item) => {
            const isActive = item.to === '/'
              ? currentPath === '/'
              : currentPath.startsWith(item.to)
            return (
              <Link
                key={item.to}
                href={item.to}
                className={`relative flex flex-shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors md:gap-3 md:px-3 md:py-[7px] md:text-[15px] ${
                  isActive
                    ? 'text-apple-accent font-semibold'
                    : 'text-apple-secondary hover:bg-apple-accent-light hover:text-apple-heading'
                }`}
              >
                <>
                  <div
                    className={`absolute left-0 h-4 w-[3px] rounded-full transition-colors ${
                      isActive ? 'bg-apple-accent' : 'bg-transparent'
                    }`}
                  />
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className="whitespace-nowrap md:flex-1">{item.label}</span>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-apple-accent" />}
                </>
              </Link>
            )
          })}
        </nav>

        {api.target === 'web' && (
          <button
            aria-label="退出管理后台"
            title="退出管理后台"
            className="mr-2 flex-shrink-0 rounded-lg px-2 py-2 text-[12px] text-apple-secondary hover:text-red-500 md:hidden"
            onClick={async () => {
              await api.logout()
              window.location.reload()
            }}
          >
            退出
          </button>
        )}

        {/* Version */}
        <div className="hidden px-5 py-4 space-y-3 md:block">
          {api.target === 'web' && (
            <button
              className="text-[12px] text-apple-secondary hover:text-red-500 transition-colors"
              onClick={async () => {
                await api.logout()
                window.location.reload()
              }}
            >
              退出管理后台
            </button>
          )}
          <p className="text-[12px] text-apple-tertiary">v2.0.0</p>
        </div>
      </aside>
      <main className="w-full min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  )
}
