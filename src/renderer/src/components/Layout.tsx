import { NavLink, Outlet } from 'react-router-dom'

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

export default function Layout() {
  return (
    <div className="flex h-screen bg-apple-bg text-apple-heading">
      <aside className="w-[220px] flex-shrink-0 flex flex-col bg-white border-r border-apple-border-medium">
        {/* Brand */}
        <div className="px-5 pt-6 pb-5">
          <h1 className="text-[17px] font-bold tracking-tight">文库下载器</h1>
          <p className="mt-0.5 text-[12px] text-apple-tertiary">Wenku8 Downloader</p>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[15px] transition-colors ${
                  isActive
                    ? 'text-apple-accent font-semibold'
                    : 'text-apple-secondary hover:bg-apple-accent-light hover:text-apple-heading'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Left border indicator */}
                  <div
                    className={`absolute left-0 h-4 w-[3px] rounded-full transition-colors ${
                      isActive ? 'bg-apple-accent' : 'bg-transparent'
                    }`}
                  />
                  {/* Icon */}
                  <span className="flex-shrink-0">{item.icon}</span>
                  {/* Label */}
                  <span className="flex-1">{item.label}</span>
                  {/* Active dot */}
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-apple-accent" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Version */}
        <div className="px-5 py-4">
          <p className="text-[12px] text-apple-tertiary">v2.0.0</p>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
