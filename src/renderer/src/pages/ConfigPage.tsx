import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/configStore'
import { api } from '../api/client'
import StatusAlert from '../components/StatusAlert'

export default function ConfigPage() {
  const { config, fetchConfig, setConfig } = useConfigStore()
  const [tab, setTab] = useState<'account' | 'cookie' | 'download'>('account')

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

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
      {tab === 'account' && <AccountTab config={config} onSave={setConfig} />}
      {tab === 'cookie' && <CookieTab />}
      {tab === 'download' && <DownloadTab config={config} onSave={setConfig} />}
    </div>
  )
}

function AccountTab({
  config,
  onSave,
}: {
  config: Record<string, unknown> | null
  onSave: (section: string, key: string, value: string) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [proxyHttp, setProxyHttp] = useState('')
  const [proxyHttps, setProxyHttps] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (config) {
      setUsername(((config.login as Record<string, string>)?.username) ?? '')
      setPassword(((config.login as Record<string, string>)?.password) ?? '')
      setProxyHttp(((config.proxy as Record<string, string>)?.http) ?? '')
      setProxyHttps(((config.proxy as Record<string, string>)?.https) ?? '')
    }
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await onSave('login', 'username', username)
      await onSave('login', 'password', password)
      await onSave('proxy', 'http', proxyHttp)
      await onSave('proxy', 'https', proxyHttps)
      setStatus({ type: 'success', msg: '账号与代理配置已保存' })
    } catch (e) {
      setStatus({ type: 'error', msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-lg font-semibold">账号信息</h3>
      <p className="text-sm text-gray-500">填写账号后点击保存，自动尝试刷新 Cookie。</p>
      <div>
        <label className="block text-sm text-gray-400 mb-1">用户名</label>
        <input
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                     focus:outline-none focus:border-blue-500"
          placeholder="请输入轻小说文库用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">密码</label>
        <input
          type="password"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                     focus:outline-none focus:border-blue-500"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="border-t border-gray-800 pt-4">
        <h3 className="text-sm font-semibold mb-2">代理设置（可选）</h3>
        <p className="text-xs text-gray-500 mb-3">
          仅当网络被完全封禁导致连接报错时才需填写，留空默认直连。
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">HTTP 代理</label>
            <input
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                         focus:outline-none focus:border-blue-500"
              placeholder="例如：http://127.0.0.1:7897"
              value={proxyHttp}
              onChange={(e) => setProxyHttp(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">HTTPS 代理</label>
            <input
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                         focus:outline-none focus:border-blue-500"
              placeholder="例如：http://127.0.0.1:7897"
              value={proxyHttps}
              onChange={(e) => setProxyHttps(e.target.value)}
            />
          </div>
        </div>
      </div>
      <button
        disabled={saving}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                   rounded text-sm font-medium transition-colors"
        onClick={handleSave}
      >
        {saving ? '保存中...' : '保存账号与代理'}
      </button>
      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}

function CookieTab() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const handleAutoGet = async () => {
    setLoading(true)
    setStatus(null)
    try {
      await api.autoGetCookie()
      setStatus({ type: 'success', msg: 'Cookie 自动获取成功！已写入配置并立即生效。' })
    } catch (e) {
      setStatus({ type: 'error', msg: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-lg font-semibold">自动获取 (推荐)</h3>
      <p className="text-sm text-gray-500">
        点击下方按钮将启动真实 Chrome 浏览器自动完成登录，可靠绕过 Cloudflare，并获取 cf_clearance。
      </p>
      <p className="text-xs text-gray-600">
        点击后屏幕上会弹出浏览器窗口，自动操作完成后会自动关闭，无需手动干预。
      </p>
      <button
        disabled={loading}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                   rounded text-sm font-medium transition-colors"
        onClick={handleAutoGet}
      >
        {loading ? '获取中（10~30 秒）...' : '一键获取 / 刷新 Cookie'}
      </button>
      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}

function DownloadTab({
  config,
  onSave,
}: {
  config: Record<string, unknown> | null
  onSave: (section: string, key: string, value: string) => Promise<void>
}) {
  const [titleFormat, setTitleFormat] = useState('FULL')
  const [coverIndex, setCoverIndex] = useState('0')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (config) {
      setTitleFormat(((config.download as Record<string, string>)?.full_title) ?? 'FULL')
      setCoverIndex(((config.download as Record<string, string>)?.default_cover_index) ?? '0')
    }
  }, [config])

  const handleSave = async () => {
    if (!/^\d+$/.test(coverIndex)) {
      setStatus({ type: 'error', msg: '封面图片索引必须为整数' })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      await onSave('download', 'full_title', titleFormat)
      await onSave('download', 'default_cover_index', coverIndex)
      setStatus({ type: 'success', msg: '下载设置已保存' })
    } catch (e) {
      setStatus({ type: 'error', msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-lg font-semibold">书名格式</h3>
      <select
        className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm w-32"
        value={titleFormat}
        onChange={(e) => setTitleFormat(e.target.value)}
      >
        <option value="FULL">FULL</option>
        <option value="IN">IN</option>
        <option value="OUT">OUT</option>
      </select>
      <div className="p-3 rounded border border-gray-800 text-xs text-gray-500 space-y-1">
        <p>以「败北女角太多了！(败犬女主太多了！)」为例：</p>
        <p><strong>FULL</strong> = 败北女角太多了！(败犬女主太多了！)</p>
        <p><strong>IN</strong> = 败犬女主太多了！</p>
        <p><strong>OUT</strong> = 败北女角太多了！</p>
      </div>
      <div className="border-t border-gray-800 pt-4">
        <h3 className="text-sm font-semibold mb-2">封面图片索引</h3>
        <input
          className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                     focus:outline-none focus:border-blue-500"
          value={coverIndex}
          onChange={(e) => setCoverIndex(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1">0 表示第一张插图，1 表示第二张，依此类推</p>
      </div>
      <button
        disabled={saving}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                   rounded text-sm font-medium transition-colors"
        onClick={handleSave}
      >
        {saving ? '保存中...' : '保存下载设置'}
      </button>
      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}
