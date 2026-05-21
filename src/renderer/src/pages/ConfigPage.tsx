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
      <h2 className="text-2xl font-bold text-apple-heading mb-4">配置</h2>
      <div className="flex gap-1 mb-6 border-b border-apple-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'border-b-2 border-apple-accent text-apple-accent font-medium'
                : 'text-apple-secondary hover:text-apple-heading'
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
      <h3 className="text-lg font-semibold text-apple-heading">账号信息</h3>
      <p className="text-sm text-apple-secondary">填写账号后点击保存，自动尝试刷新 Cookie。</p>
      <div>
        <label className="block text-sm text-apple-secondary mb-1">用户名</label>
        <input
          className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
          placeholder="请输入轻小说文库用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm text-apple-secondary mb-1">密码</label>
        <input
          type="password"
          className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="border-t border-apple-border-subtle pt-4">
        <h3 className="text-sm font-semibold text-apple-heading mb-2">代理设置（可选）</h3>
        <p className="text-xs text-apple-tertiary mb-3">
          仅当网络被完全封禁导致连接报错时才需填写，留空默认直连。
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-apple-secondary mb-1">HTTP 代理</label>
            <input
              className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                         focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder="例如：http://127.0.0.1:7897"
              value={proxyHttp}
              onChange={(e) => setProxyHttp(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-apple-secondary mb-1">HTTPS 代理</label>
            <input
              className="w-full px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                         focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder="例如：http://127.0.0.1:7897"
              value={proxyHttps}
              onChange={(e) => setProxyHttps(e.target.value)}
            />
          </div>
        </div>
      </div>
      <button
        disabled={saving}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
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
      <h3 className="text-lg font-semibold text-apple-heading">自动获取 (推荐)</h3>
      <p className="text-sm text-apple-secondary">
        点击下方按钮将启动真实 Chrome 浏览器自动完成登录，可靠绕过 Cloudflare，并获取 cf_clearance。
      </p>
      <p className="text-xs text-apple-tertiary">
        点击后屏幕上会弹出浏览器窗口，自动操作完成后会自动关闭，无需手动干预。
      </p>
      <button
        disabled={loading}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
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
      <h3 className="text-lg font-semibold text-apple-heading">书名格式</h3>
      <select
        className="px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading w-32
                   focus:outline-none focus:border-apple-accent/30"
        value={titleFormat}
        onChange={(e) => setTitleFormat(e.target.value)}
      >
        <option value="FULL">FULL</option>
        <option value="IN">IN</option>
        <option value="OUT">OUT</option>
      </select>
      <div className="p-3 rounded-xl border border-apple-border-subtle text-xs text-apple-secondary space-y-1 bg-apple-bg">
        <p>以「败北女角太多了！(败犬女主太多了！)」为例：</p>
        <p><strong className="text-apple-heading">FULL</strong> = 败北女角太多了！(败犬女主太多了！)</p>
        <p><strong className="text-apple-heading">IN</strong> = 败犬女主太多了！</p>
        <p><strong className="text-apple-heading">OUT</strong> = 败北女角太多了！</p>
      </div>
      <div className="border-t border-apple-border-subtle pt-4">
        <h3 className="text-sm font-semibold text-apple-heading mb-2">封面图片索引</h3>
        <input
          className="w-24 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
          value={coverIndex}
          onChange={(e) => setCoverIndex(e.target.value)}
        />
        <p className="text-xs text-apple-tertiary mt-1">0 表示第一张插图，1 表示第二张，依此类推</p>
      </div>
      <button
        disabled={saving}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={handleSave}
      >
        {saving ? '保存中...' : '保存下载设置'}
      </button>
      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}
