import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/configStore'
import { api } from '../api/client'
import StatusAlert from '../components/StatusAlert'

const TITLE_FORMATS = [
  { value: 'FULL', label: '完整', desc: '中文译名（日文原名）' },
  { value: 'IN', label: '原名', desc: '仅保留日文原名' },
  { value: 'OUT', label: '译名', desc: '仅保留中文译名' },
] as const

export default function ConfigPage() {
  const { config, fetchConfig, setConfig } = useConfigStore()
  const [tab, setTab] = useState<'login' | 'download'>('login')

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const tabs = [
    { key: 'login' as const, label: '登录' },
    { key: 'download' as const, label: '下载设置' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold text-apple-heading mb-1">配置</h2>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
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
      {tab === 'login' && <LoginTab />}
      {tab === 'download' && <DownloadTab config={config} onSave={setConfig} />}
    </div>
  )
}

function LoginTab() {
  const { config, setConfig } = useConfigStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [cookieState, setCookieState] = useState<'idle' | 'loading' | 'valid' | 'error'>('idle')
  const [cookieMsg, setCookieMsg] = useState('')
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (config) {
      setUsername(((config.login as Record<string, string>)?.username) ?? '')
      setPassword(((config.login as Record<string, string>)?.password) ?? '')
    }
  }, [config])

  const doRefresh = async () => {
    setRefreshing(true)
    setCookieState('loading')
    setCookieMsg('正在登录...')
    try {
      api.getCookieProgress((data) => {
        setCookieMsg(data.message)
      })
      const result = await api.autoGetCookie()
      setCookieState('valid')
      setLastRefresh(Date.now())
      setCookieMsg('已就绪')
    } catch (e) {
      setCookieState('error')
      setCookieMsg(String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setAlert(null)
    try {
      await setConfig('login', 'username', username)
      await setConfig('login', 'password', password)
      setAlert({ type: 'success', msg: '账号已保存' })
    } catch (e) {
      setAlert({ type: 'error', msg: String(e) })
      setSaving(false)
      return
    }
    setSaving(false)
    // Auto refresh cookie after save
    setCookieState('loading')
    setCookieMsg('正在登录...')
    try {
      api.getCookieProgress((data) => {
        setCookieMsg(data.message)
      })
      const result = await api.autoGetCookie()
      setCookieState('valid')
      setLastRefresh(Date.now())
      setCookieMsg('已就绪')
    } catch {
      // Cookie error shown in the status section, not as alert
    }
  }

  const handleRefresh = async () => {
    if (!username) {
      setAlert({ type: 'error', msg: '请先填写并保存账号' })
      return
    }
    setAlert(null)
    await doRefresh()
  }

  const timeAgo = lastRefresh ? formatTimeAgo(lastRefresh) : null

  return (
    <div className="space-y-4 max-w-lg">
      {/* 账号凭证 */}
      <div className="rounded-xl border border-apple-border-subtle bg-[#fafafa] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-apple-accent flex-shrink-0" />
          <h3 className="text-sm font-semibold text-apple-heading">账号凭证</h3>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-[12px] font-medium text-apple-secondary mb-1.5">用户名</label>
            <input
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading
                         focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder="轻小说文库用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-apple-secondary mb-1.5">密码</label>
            <input
              type="password"
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading
                         focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <button
          disabled={saving}
          className="mt-4 w-full px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                     rounded-[20px] text-[13px] font-medium text-white transition-opacity"
          onClick={handleSave}
        >
          {saving ? '保存中...' : '保存账号'}
        </button>
        <p className="text-[12px] text-apple-tertiary mt-2">保存后自动尝试登录并获取 Cookie</p>
      </div>

      {/* Cookie 状态 */}
      <div className={`rounded-xl border p-5 ${
        cookieState === 'valid'
          ? 'border-green-200 bg-green-50/50'
          : cookieState === 'error'
            ? 'border-red-200 bg-red-50/50'
            : 'border-apple-border-subtle bg-[#fafafa]'
      }`}>
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            cookieState === 'valid' ? 'bg-green-500'
            : cookieState === 'error' ? 'bg-red-500'
            : cookieState === 'loading' ? 'bg-apple-accent animate-pulse'
            : 'bg-apple-tertiary'
          }`} />
          <h3 className="text-sm font-semibold text-apple-heading">Cookie 状态</h3>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              {cookieState === 'loading' && (
                <svg className="animate-spin h-4 w-4 text-apple-accent" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-60" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              <span className={`text-[13px] font-medium ${
                cookieState === 'valid' ? 'text-green-600'
                : cookieState === 'error' ? 'text-red-500'
                : 'text-apple-secondary'
              }`}>
                {cookieState === 'idle' && '未获取'}
                {cookieState === 'loading' && cookieMsg}
                {cookieState === 'valid' && '已就绪'}
                {cookieState === 'error' && '获取失败'}
              </span>
            </div>
            {cookieState === 'valid' && timeAgo && (
              <p className="text-[12px] text-apple-tertiary mt-1">上次刷新：{timeAgo}</p>
            )}
            {cookieState === 'error' && (
              <p className="text-[12px] text-apple-tertiary mt-1 truncate max-w-[280px]" title={cookieMsg}>{cookieMsg}</p>
            )}
          </div>
          <button
            disabled={refreshing}
            className="px-5 py-2 bg-apple-accent-light text-apple-accent hover:bg-apple-accent/15 disabled:opacity-40
                       rounded-[20px] text-[13px] font-medium transition-colors flex-shrink-0"
            onClick={handleRefresh}
          >
            {refreshing ? '刷新中...' : '刷新 Cookie'}
          </button>
        </div>
      </div>

      <p className="text-[12px] text-apple-tertiary text-center">
        修改账号后自动保存，Cookie 过期后点击「刷新 Cookie」重新获取
      </p>

      {alert && <StatusAlert type={alert.type} message={alert.msg} onDismiss={() => setAlert(null)} />}
    </div>
  )
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
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
      <div className="space-y-2">
        {TITLE_FORMATS.map((fmt) => {
          const examples: Record<string, string> = {
            FULL: '败北女角太多了！(败犬女主太多了！)',
            IN: '败犬女主太多了！',
            OUT: '败北女角太多了！',
          }
          return (
            <button
              key={fmt.value}
              type="button"
              onClick={() => setTitleFormat(fmt.value)}
              className={`w-full text-left px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                titleFormat === fmt.value
                  ? 'border-apple-accent bg-[rgba(0,113,227,0.06)]'
                  : 'border-apple-border-subtle bg-white hover:border-apple-accent/40'
              }`}
            >
              <div className={`text-sm font-semibold ${titleFormat === fmt.value ? 'text-apple-accent' : 'text-apple-heading'}`}>
                {fmt.label}
              </div>
              <div className={`text-[11px] mt-0.5 ${titleFormat === fmt.value ? 'text-apple-accent/70' : 'text-apple-tertiary'}`}>
                {examples[fmt.value]}
              </div>
            </button>
          )
        })}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-apple-heading mb-2">封面图片索引</h3>
        <div className="flex items-center gap-3">
          <input
            className="w-24 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                       focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            value={coverIndex}
            onChange={(e) => setCoverIndex(e.target.value)}
          />
          <span className="text-xs text-apple-tertiary">0 表示第一张插图，1 表示第二张，依此类推</span>
        </div>
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
