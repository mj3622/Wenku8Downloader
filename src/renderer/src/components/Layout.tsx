import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/', label: '主页', icon: '🏠' },
  { to: '/config', label: '配置', icon: '⚙️' },
  { to: '/search/id', label: '编号检索', icon: '🔢' },
  { to: '/search/author', label: '作者检索', icon: '👤' },
  { to: '/search/title', label: '书名检索', icon: '📖' },
  { to: '/download/full', label: '整本下载', icon: '📚' },
  { to: '/download/divided', label: '分卷下载', icon: '📑' },
  { to: '/download/pictures', label: '图片下载', icon: '🖼️' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <aside className="w-56 flex-shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-gray-800">
          <h1 className="text-sm font-bold text-gray-200">轻小说文库下载器</h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-500'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`
              }
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
