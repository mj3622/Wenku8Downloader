import { useState } from 'react'
import { useConfigStore } from '../stores/configStore'

export default function ConfigPage() {
  const [tab, setTab] = useState<'account' | 'cookie' | 'download'>('account')

  const tabs = [
    { key: 'account' as const, label: '账号' },
    { key: 'cookie' as const, label: 'Cookie' },
    { key: 'download' as const, label: '下载设置' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">配置</h2>
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'account' && <AccountTab />}
      {tab === 'cookie' && <CookieTab />}
      {tab === 'download' && <DownloadTab />}
    </div>
  )
}

function AccountTab() {
  const { config, setConfig } = useConfigStore()
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">账号信息</h3>
      <div>
        <label className="block text-sm text-gray-400 mb-1">用户名</label>
        <input
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
          placeholder="请输入轻小说文库用户名"
          defaultValue={(config?.login as Record<string, string>)?.username ?? ''}
        />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">密码</label>
        <input
          type="password"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
          placeholder="请输入密码"
          defaultValue={(config?.login as Record<string, string>)?.password ?? ''}
        />
      </div>
      <button
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
        onClick={() => setSaved(true)}
      >
        保存账号
      </button>
      {saved && <p className="text-green-400 text-sm">保存成功</p>}
    </div>
  )
}

function CookieTab() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">自动获取 Cookie</h3>
      <p className="text-sm text-gray-500">点击下方按钮将自动完成浏览器登录获取 Cookie。</p>
      <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors">
        一键获取 / 刷新 Cookie
      </button>
    </div>
  )
}

function DownloadTab() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">下载设置</h3>
      <div>
        <label className="block text-sm text-gray-400 mb-1">书名格式</label>
        <select className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
          <option>FULL</option>
          <option>IN</option>
          <option>OUT</option>
        </select>
      </div>
      <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors">
        保存设置
      </button>
    </div>
  )
}
