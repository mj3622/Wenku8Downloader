import { useEffect, useState } from 'react'
import { useConfigStore } from '../stores/configStore'
import { api } from '../api/client'
import StatusAlert from '../components/StatusAlert'
import { formatTimeAgo } from '../utils/format'

const TITLE_FORMATS = [
  { value: 'FULL', label: '完整', desc: '中文译名（日文原名）' },
  { value: 'IN', label: '原名', desc: '仅保留日文原名' },
  { value: 'OUT', label: '译名', desc: '仅保留中文译名' },
] as const

const CONFIG_TABS = [
  { key: 'login' as const, label: '登录' },
  { key: 'download' as const, label: '下载设置' },
  { key: 'proxy' as const, label: '网络代理' },
]

export default function ConfigPage() {
  const { config, fetchConfig, setConfig } = useConfigStore()
  const [tab, setTab] = useState<'login' | 'download' | 'proxy'>('login')

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  return (
    <div className="min-w-0">
      <h2 className="text-2xl font-bold text-apple-heading mb-1">配置</h2>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
      <div className="flex gap-1 mb-6 border-b border-apple-border-subtle overflow-x-auto">
        {CONFIG_TABS.map((t) => (
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
      {tab === 'proxy' && <ProxyTab config={config} onSave={setConfig} />}
    </div>
  )
}

const COOKIE_STATE_CONFIG = {
  idle:    { dot: 'bg-apple-tertiary',        text: 'text-apple-secondary', label: '未获取',   showSpinner: false },
  loading: { dot: 'bg-apple-accent animate-pulse', text: 'text-apple-secondary', label: '',    showSpinner: true },
  valid:   { dot: 'bg-green-500',              text: 'text-green-600',       label: '已就绪',  showSpinner: false },
  error:   { dot: 'bg-red-500',                text: 'text-red-500',         label: '获取失败', showSpinner: false },
} as const

const CARD_STYLE = {
  idle:    'border-apple-border-subtle bg-[#fafafa]',
  loading: 'border-apple-border-subtle bg-[#fafafa]',
  valid:   'border-green-200 bg-green-50/50',
  error:   'border-red-200 bg-red-50/50',
} as const

function CookieStatusCard({
  cookieState,
  cookieMsg,
  timeAgo,
  onRefresh,
}: {
  cookieState: 'idle' | 'loading' | 'valid' | 'error'
  cookieMsg: string
  timeAgo: string | null
  onRefresh: () => void
}) {
  const cs = COOKIE_STATE_CONFIG[cookieState]
  const cardStyle = CARD_STYLE[cookieState]

  return (
    <div className={`rounded-xl border p-5 ${cardStyle}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cs.dot}`} />
        <h3 className="text-sm font-semibold text-apple-heading">Cookie 状态</h3>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {cs.showSpinner && (
              <svg className="animate-spin h-4 w-4 text-apple-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-60" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <span className={`text-[13px] font-medium ${cs.text}`}>
              {cookieState === 'loading' ? cookieMsg : cs.label}
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
          disabled={cookieState === 'loading'}
          className="px-5 py-2 bg-apple-accent-light text-apple-accent hover:bg-apple-accent/15 disabled:opacity-40
                     rounded-[20px] text-[13px] font-medium transition-colors flex-shrink-0"
          onClick={onRefresh}
        >
          {cookieState === 'loading' ? '刷新中...' : '刷新 Cookie'}
        </button>
      </div>
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
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (config) {
      setUsername(((config.login as Record<string, string>)?.username) ?? '')
      setPassword(((config.login as Record<string, string>)?.password) ?? '')
    }
  }, [config])

  const doRefresh = async () => {
    setCookieState('loading')
    setCookieMsg('正在登录...')
    try {
      api.getCookieProgress((data) => {
        setCookieMsg(data.message)
      })
      await api.autoGetCookie()
      setCookieState('valid')
      setLastRefresh(Date.now())
      setCookieMsg('已就绪')
    } catch (e) {
      setCookieState('error')
      setCookieMsg(String(e))
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
    await doRefresh()
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
    <div className="space-y-4 w-full max-w-4xl">
      {/* 账号凭证 */}
      <div className="rounded-xl border border-apple-border-subtle bg-[#fafafa] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-apple-accent flex-shrink-0" />
          <h3 className="text-sm font-semibold text-apple-heading">账号凭证</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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

      <CookieStatusCard
        cookieState={cookieState}
        cookieMsg={cookieMsg}
        timeAgo={timeAgo}
        onRefresh={handleRefresh}
      />

      <p className="text-[12px] text-apple-tertiary text-center">
        修改账号后自动保存，Cookie 过期后点击「刷新 Cookie」重新获取
      </p>

      {alert && <StatusAlert type={alert.type} message={alert.msg} onDismiss={() => setAlert(null)} />}
    </div>
  )
}

function DownloadTab({
  config,
  onSave,
}: {
  config: Record<string, unknown> | null
  onSave: (section: string, key: string, value: unknown) => Promise<void>
}) {
  const [titleFormat, setTitleFormat] = useState('FULL')
  const [coverIndex, setCoverIndex] = useState('0')
  const [downloadPath, setDownloadPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (config) {
      setTitleFormat(((config.download as Record<string, string>)?.full_title) ?? 'FULL')
      setCoverIndex(((config.download as Record<string, string>)?.default_cover_index) ?? '0')
      setDownloadPath(((config.download as Record<string, string>)?.download_path) ?? '')
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
      if (api.target === 'electron') {
        await onSave('download', 'download_path', downloadPath)
      }
      setStatus({ type: 'success', msg: '下载设置已保存' })
    } catch (e) {
      setStatus({ type: 'error', msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 w-full max-w-4xl">
      <h3 className="text-lg font-semibold text-apple-heading">书名格式</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
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
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-24 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading
                       focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            value={coverIndex}
            onChange={(e) => setCoverIndex(e.target.value)}
          />
          <span className="text-xs text-apple-tertiary">0 表示第一张插图，1 表示第二张，依此类推</span>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-apple-heading mb-2">下载存储路径</h3>
        {api.target === 'web' ? (
          <div className="px-4 py-3 bg-apple-card border border-apple-border-subtle rounded-xl text-[12px] text-apple-secondary">
            文件由服务器数据卷持久化保存，下载完成后可在「下载历史」页面获取。
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading truncate">
                {downloadPath || (
                  <span className="text-apple-tertiary">
                    {window.electronAPI.platform === 'win32'
                      ? '%USERPROFILE%\\Downloads\\Wenku8Downloader\\'
                      : '~/Downloads/Wenku8Downloader/'}
                  </span>
                )}
              </div>
              <button
                className="flex-shrink-0 px-4 py-2 text-[12px] font-medium text-apple-accent bg-apple-accent-light
                           rounded-[20px] hover:bg-apple-accent/15 transition-colors"
                onClick={async () => {
                  try {
                    const path = await api.selectFolder()
                    if (path) setDownloadPath(path)
                  } catch {
                    setStatus({ type: 'error', msg: '选择文件夹失败' })
                  }
                }}
              >
                选择文件夹
              </button>
              {downloadPath && (
                <button
                  aria-label="清除文件夹路径"
                  className="flex-shrink-0 text-apple-tertiary hover:text-apple-secondary transition-colors text-[16px] leading-none px-1"
                  onClick={() => setDownloadPath('')}
                >
                  ×
                </button>
              )}
            </div>
            <p className="text-[12px] text-apple-tertiary mt-1.5">
              留空则使用默认路径。修改后新下载的文件将保存到新路径，已有文件不受影响。
            </p>
          </>
        )}
      </div>
      <button
        disabled={saving}
        className="w-full sm:w-auto px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40
                   rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={handleSave}
      >
        {saving ? '保存中...' : '保存下载设置'}
      </button>
      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}

function ProxyTab({
  config,
  onSave,
}: {
  config: Record<string, unknown> | null
  onSave: (section: string, key: string, value: unknown) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [replacementUrl, setReplacementUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    const proxy = config?.proxy as Record<string, unknown> | undefined
    setEnabled(proxy?.enabled === true)
    setCurrentUrl(typeof proxy?.url === 'string' ? proxy.url : '')
    setHasCredentials(proxy?.has_credentials === true)
  }, [config])

  const handleSave = async () => {
    const nextUrl = replacementUrl.trim()
    if (enabled && !nextUrl && !currentUrl) {
      setStatus({ type: 'error', msg: '启用代理前请填写代理地址' })
      return
    }

    setSaving(true)
    setStatus(null)
    try {
      if (nextUrl) await onSave('proxy', 'url', nextUrl)
      await onSave('proxy', 'enabled', enabled)
      setReplacementUrl('')
      setStatus({ type: 'success', msg: '代理设置已保存，新请求将使用该代理' })
    } catch (error) {
      setStatus({ type: 'error', msg: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const clearProxy = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await onSave('proxy', 'url', '')
      setEnabled(false)
      setCurrentUrl('')
      setHasCredentials(false)
      setReplacementUrl('')
      setStatus({ type: 'success', msg: '代理已清除' })
    } catch (error) {
      setStatus({ type: 'error', msg: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 w-full max-w-4xl">
      <div className="rounded-2xl border border-apple-border-subtle bg-apple-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-apple-heading">出站代理</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-apple-secondary">
              搜索、登录、章节与图片请求都会通过代理访问轻小说文库。
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer self-start sm:self-auto">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="w-4 h-4 accent-[#0071e3]"
            />
            <span className="text-[13px] font-medium text-apple-heading">启用代理</span>
          </label>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-4">
          <div className="rounded-xl bg-apple-bg px-4 py-3 min-w-0">
            <p className="text-[11px] text-apple-tertiary mb-1">当前代理</p>
            <p className="text-[13px] text-apple-heading break-all">
              {currentUrl || '尚未配置'}
            </p>
            {hasCredentials && (
              <span className="mt-2 inline-flex rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                已保存认证信息
              </span>
            )}
          </div>

          <div className="min-w-0">
            <label className="block text-[12px] font-medium text-apple-secondary mb-1.5">
              新代理地址
            </label>
            <input
              value={replacementUrl}
              onChange={(event) => setReplacementUrl(event.target.value)}
              placeholder="socks5://127.0.0.1:1080"
              autoComplete="off"
              className="w-full min-w-0 px-3 py-2.5 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading
                         focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-apple-tertiary">
              支持 http://、https://、socks5://、socks5h://，可使用 user:password@host:port。
              留空表示保留当前地址。
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {currentUrl && (
            <button
              disabled={saving}
              onClick={() => void clearProxy()}
              className="w-full sm:w-auto px-5 py-2.5 rounded-[22px] border border-red-200 text-[13px] font-medium text-red-500
                         hover:bg-red-50 disabled:opacity-40 transition-colors"
            >
              清除代理
            </button>
          )}
          <button
            disabled={saving}
            onClick={() => void handleSave()}
            className="w-full sm:w-auto px-6 py-2.5 rounded-[22px] bg-apple-accent text-[13px] font-medium text-white
                       hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? '保存中...' : '保存代理设置'}
          </button>
        </div>
      </div>

      {status && <StatusAlert type={status.type} message={status.msg} onDismiss={() => setStatus(null)} />}
    </div>
  )
}
