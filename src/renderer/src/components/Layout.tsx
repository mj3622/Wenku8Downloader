import { NavLink, Outlet } from 'react-router-dom'
import {
  IconDownload,
  IconHome,
  IconSearch,
  IconSettings,
  type Icon,
} from '@tabler/icons-react'
import logoUrl from '../../../../resources/icon.png'

const navItems: { to: string; label: string; icon: Icon }[] = [
  {
    to: '/',
    label: '主页',
    icon: IconHome,
  },
  {
    to: '/search',
    label: '检索',
    icon: IconSearch,
  },
  {
    to: '/download',
    label: '下载',
    icon: IconDownload,
  },
  {
    to: '/config',
    label: '配置',
    icon: IconSettings,
  },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-apple-bg text-apple-heading">
      <aside className="w-[220px] flex-shrink-0 flex flex-col bg-white border-r border-apple-border-medium">
        {/* Brand */}
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="" aria-hidden="true" className="w-10 h-10" />
            <div>
              <p className="whitespace-nowrap text-[15px] font-bold tracking-tight">
                轻小说文库下载器
              </p>
              <p className="text-[12px] text-apple-tertiary">Wenku8 Downloader</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {navItems.map((item) => {
            const Glyph = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25 ${
                    isActive
                      ? 'bg-apple-accent-light font-medium text-apple-accent'
                      : 'text-apple-secondary hover:bg-apple-accent-light hover:text-apple-heading'
                  }`
                }
              >
                <Glyph aria-hidden="true" className="flex-shrink-0" size={20} stroke={1.7} />
                <span className="flex-1">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Version */}
        <div className="px-5 py-4">
          <p className="text-[12px] text-apple-tertiary">v2.0.0</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
