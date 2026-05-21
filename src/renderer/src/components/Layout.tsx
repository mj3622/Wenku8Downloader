import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/', label: '主页' },
  { to: '/search', label: '检索' },
  { to: '/download', label: '下载' },
  { to: '/config', label: '配置' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-apple-bg text-apple-heading">
      <aside
        className="w-52 flex-shrink-0 flex flex-col border-r border-apple-border-medium"
        style={{
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
        }}
      >
        <nav className="flex-1 overflow-y-auto py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center mx-2 px-3 py-1.5 text-[13px] rounded-lg transition-colors ${
                  isActive
                    ? 'bg-apple-accent-light text-apple-accent font-medium'
                    : 'text-apple-secondary hover:bg-black/5 hover:text-apple-heading'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
