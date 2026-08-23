import { useEffect, useRef, useState } from 'react'
import type {
  DownloadConfig,
  LogConfig,
  TitleFormat,
  UpdateCredentialsInput,
} from '../../../shared/config-types'
import { api } from '../api/client'
import StatusAlert from '../components/StatusAlert'
import { useConfigStore } from '../stores/configStore'
import { formatTimeAgo } from '../utils/format'

const TITLE_FORMATS = [
  { value: 'FULL', label: '完整' },
  { value: 'IN', label: '原名' },
  { value: 'OUT', label: '译名' },
] as const

const CONFIG_TABS = [
  { key: 'login' as const, label: '登录' },
  { key: 'download' as const, label: '下载设置' },
  { key: 'logging' as const, label: '日志' },
]

const RECOVERY_CONFIRMATION =
  '确定要处理配置问题吗？损坏文件将保留恢复备份，已迁移的旧明文配置将被清理。'
const CLEAR_CREDENTIALS_CONFIRMATION =
  '确定要清除已保存的账号、密码和 Cookie 吗？此操作不会删除已下载文件。'

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateLogConfigFields(
  retentionDays: string,
  maxFileSizeMb: string,
  maxTotalSizeMb: string,
): { value?: LogConfig; error?: string } {
  const fields = [
    { value: retentionDays, minimum: 1, maximum: 365, label: '保留天数' },
    { value: maxFileSizeMb, minimum: 1, maximum: 1024, label: '单文件上限（MB）' },
    { value: maxTotalSizeMb, minimum: 2, maximum: 10240, label: '目录总上限（MB）' },
  ] as const
  const parsed: number[] = []
  for (const field of fields) {
    if (!/^\d+$/.test(field.value)) {
      return { error: `${field.label}必须为 ${field.minimum} 到 ${field.maximum} 的整数` }
    }
    const value = Number(field.value)
    if (value < field.minimum || value > field.maximum) {
      return { error: `${field.label}必须为 ${field.minimum} 到 ${field.maximum} 的整数` }
    }
    parsed.push(value)
  }

  const [days, fileSize, totalSize] = parsed
  if (totalSize < fileSize * 2) {
    return { error: '目录总上限必须至少为单文件上限的两倍' }
  }
  return {
    value: {
      retentionDays: days,
      maxFileSizeMb: fileSize,
      maxTotalSizeMb: totalSize,
    },
  }
}

export default function ConfigPage() {
  const {
    snapshot,
    loadState,
    error,
    fetchConfig,
    resetCorruptConfig,
  } = useConfigStore()
  const [tab, setTab] = useState<'login' | 'download' | 'logging'>('login')
  const [resetting, setResetting] = useState(false)
  const resetInFlight = useRef(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error'
    msg: string
  } | null>(null)

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  const handleReset = async () => {
    if (resetInFlight.current) return
    if (!window.confirm(RECOVERY_CONFIRMATION)) return

    resetInFlight.current = true
    setResetting(true)
    setResetStatus(null)
    try {
      await resetCorruptConfig()
      setResetStatus({ type: 'success', msg: '配置问题已处理' })
    } catch (resetError) {
      setResetStatus({ type: 'error', msg: messageFrom(resetError) })
    } finally {
      resetInFlight.current = false
      setResetting(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-apple-heading mb-1">配置</h2>
      <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />

      {loadState === 'error' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>配置加载失败：{error || '未知错误'}</p>
          <button
            className="mt-2 px-4 py-1.5 rounded-[18px] bg-red-100 hover:bg-red-200 transition-colors"
            onClick={() => void fetchConfig()}
          >
            重试
          </button>
        </div>
      )}

      {snapshot?.health.state !== 'ok' && snapshot && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>{snapshot.health.message}</p>
          {snapshot.health.state === 'recovery-required' && (
            <button
              disabled={resetting}
              className="mt-2 px-4 py-1.5 rounded-[18px] bg-amber-100 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={() => void handleReset()}
            >
              {resetting ? '处理中...' : '处理配置问题'}
            </button>
          )}
        </div>
      )}

      {resetStatus && (
        <div className="mb-4">
          <StatusAlert
            type={resetStatus.type}
            message={resetStatus.msg}
            onDismiss={() => setResetStatus(null)}
          />
        </div>
      )}

      {!snapshot && loadState === 'loading' && (
        <p className="text-sm text-apple-secondary">正在加载配置...</p>
      )}

      {snapshot && (
        <>
          <div className="flex gap-1 mb-6 border-b border-apple-border-subtle">
            {CONFIG_TABS.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`px-4 py-2 text-sm transition-colors ${
                  tab === item.key
                    ? 'border-b-2 border-apple-accent text-apple-accent font-medium'
                    : 'text-apple-secondary hover:text-apple-heading'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === 'login' && <LoginTab />}
          {tab === 'download' && <DownloadTab />}
          {tab === 'logging' && <LogTab />}
        </>
      )}
    </div>
  )
}

const COOKIE_STATE_CONFIG = {
  idle: {
    dot: 'bg-apple-tertiary',
    text: 'text-apple-secondary',
    label: '未获取',
    showSpinner: false,
  },
  loading: {
    dot: 'bg-apple-accent animate-pulse',
    text: 'text-apple-secondary',
    label: '',
    showSpinner: true,
  },
  valid: {
    dot: 'bg-green-500',
    text: 'text-green-600',
    label: '已就绪',
    showSpinner: false,
  },
  error: {
    dot: 'bg-red-500',
    text: 'text-red-500',
    label: '获取失败',
    showSpinner: false,
  },
} as const

const CARD_STYLE = {
  idle: 'border-apple-border-subtle bg-[#fafafa]',
  loading: 'border-apple-border-subtle bg-[#fafafa]',
  valid: 'border-green-200 bg-green-50/50',
  error: 'border-red-200 bg-red-50/50',
} as const

type CookieState = keyof typeof COOKIE_STATE_CONFIG

function CookieStatusCard({
  cookieState,
  cookieMsg,
  timeAgo,
  onRefresh,
}: {
  cookieState: CookieState
  cookieMsg: string
  timeAgo: string | null
  onRefresh: () => void
}) {
  const stateConfig = COOKIE_STATE_CONFIG[cookieState]

  return (
    <div className={`rounded-xl border p-5 ${CARD_STYLE[cookieState]}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateConfig.dot}`} />
        <h3 className="text-sm font-semibold text-apple-heading">Cookie 状态</h3>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            {stateConfig.showSpinner && (
              <svg className="animate-spin h-4 w-4 text-apple-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-60" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <span className={`text-[13px] font-medium ${stateConfig.text}`}>
              {cookieState === 'loading' ? cookieMsg : stateConfig.label}
            </span>
          </div>
          {cookieState === 'valid' && timeAgo && (
            <p className="text-[12px] text-apple-tertiary mt-1">上次刷新：{timeAgo}</p>
          )}
          {cookieState === 'error' && (
            <p
              className="text-[12px] text-apple-tertiary mt-1 truncate max-w-[280px]"
              title={cookieMsg}
            >
              {cookieMsg}
            </p>
          )}
        </div>
        <button
          disabled={cookieState === 'loading'}
          className="px-5 py-2 bg-apple-accent-light text-apple-accent hover:bg-apple-accent/15 disabled:opacity-40 rounded-[20px] text-[13px] font-medium transition-colors flex-shrink-0"
          onClick={onRefresh}
        >
          {cookieState === 'loading' ? '刷新中...' : '刷新 Cookie'}
        </button>
      </div>
    </div>
  )
}

function LoginTab() {
  const {
    snapshot,
    fetchConfig,
    updateCredentials,
  } = useConfigStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cookieState, setCookieState] = useState<CookieState>('idle')
  const [cookieMsg, setCookieMsg] = useState('')
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const [alert, setAlert] = useState<{
    type: 'success' | 'error'
    msg: string
  } | null>(null)

  useEffect(() => {
    if (!snapshot) return
    setUsername(snapshot.account.username)
    setPassword('')
    setCookieState(snapshot.account.hasCookies ? 'valid' : 'idle')
  }, [snapshot])

  useEffect(() => api.getCookieProgress((data) => setCookieMsg(data.message)), [])

  const doRefresh = async () => {
    setCookieState('loading')
    setCookieMsg('正在登录...')
    try {
      await api.autoGetCookie()
      await fetchConfig()
      setCookieState('valid')
      setLastRefresh(Date.now())
      setCookieMsg('已就绪')
    } catch (refreshError) {
      setCookieState('error')
      setCookieMsg(messageFrom(refreshError))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setAlert(null)
    const input: UpdateCredentialsInput = password
      ? { username, password }
      : { username }
    try {
      await updateCredentials(input)
      setPassword('')
      setAlert({ type: 'success', msg: '账号已保存' })
    } catch (saveError) {
      setAlert({ type: 'error', msg: messageFrom(saveError) })
      setSaving(false)
      return
    }
    setSaving(false)
    await doRefresh()
  }

  const handleRefresh = async () => {
    if (!snapshot?.account.username) {
      setAlert({ type: 'error', msg: '请先填写并保存账号' })
      return
    }
    if (username !== snapshot.account.username) {
      setAlert({ type: 'error', msg: '账号已修改，请先保存后再刷新' })
      return
    }
    setAlert(null)
    await doRefresh()
  }

  const handleClearCredentials = async () => {
    if (!window.confirm(CLEAR_CREDENTIALS_CONFIRMATION)) return

    setClearing(true)
    setAlert(null)
    try {
      await updateCredentials({ username: '', password: '' })
      setUsername('')
      setPassword('')
      setCookieState('idle')
      setCookieMsg('')
      setLastRefresh(null)
      setAlert({ type: 'success', msg: '账号、密码和 Cookie 已清除' })
    } catch (clearError) {
      setAlert({ type: 'error', msg: messageFrom(clearError) })
    } finally {
      setClearing(false)
    }
  }

  const timeAgo = lastRefresh ? formatTimeAgo(lastRefresh) : null
  const hasStoredCredentials = Boolean(
    snapshot?.account.username
    || snapshot?.account.hasPassword
    || snapshot?.account.hasCookies,
  )

  return (
    <div className="space-y-4 max-w-lg">
      <div className="rounded-xl border border-apple-border-subtle bg-[#fafafa] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-apple-accent flex-shrink-0" />
          <h3 className="text-sm font-semibold text-apple-heading">账号凭证</h3>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-[12px] font-medium text-apple-secondary mb-1.5">用户名</label>
            <input
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder="轻小说文库用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-apple-secondary">密码</label>
              {snapshot?.account.hasPassword && (
                <span className="text-[11px] text-green-600">已保存密码</span>
              )}
            </div>
            <input
              type="password"
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              placeholder={snapshot?.account.hasPassword ? '留空则保留已保存密码' : '请输入密码'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>
        <button
          disabled={saving || clearing}
          className="mt-4 w-full px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40 rounded-[20px] text-[13px] font-medium text-white transition-opacity"
          onClick={() => void handleSave()}
        >
          {saving ? '保存中...' : '保存账号'}
        </button>
        {hasStoredCredentials && (
          <button
            type="button"
            disabled={saving || clearing}
            className="mt-2 w-full px-6 py-2.5 border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-[20px] text-[13px] font-medium transition-colors"
            onClick={() => void handleClearCredentials()}
          >
            {clearing ? '清除中...' : '清除已保存凭证'}
          </button>
        )}
        <p className="text-[12px] text-apple-tertiary mt-2">
          保存后自动尝试登录并获取 Cookie；密码留空会保留已保存密码。
        </p>
      </div>

      <CookieStatusCard
        cookieState={cookieState}
        cookieMsg={cookieMsg}
        timeAgo={timeAgo}
        onRefresh={() => void handleRefresh()}
      />

      <p className="text-[12px] text-apple-tertiary text-center">
        Cookie 过期后点击「刷新 Cookie」重新获取
      </p>

      {alert && (
        <StatusAlert
          type={alert.type}
          message={alert.msg}
          onDismiss={() => setAlert(null)}
        />
      )}
    </div>
  )
}

function DownloadTab() {
  const { snapshot, updateDownloadConfig } = useConfigStore()
  const [titleFormat, setTitleFormat] = useState<TitleFormat>('FULL')
  const [coverIndex, setCoverIndex] = useState('0')
  const [downloadPath, setDownloadPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{
    type: 'success' | 'error'
    msg: string
  } | null>(null)

  useEffect(() => {
    if (!snapshot) return
    setTitleFormat(snapshot.download.fullTitle)
    setCoverIndex(String(snapshot.download.defaultCoverIndex))
    setDownloadPath(snapshot.download.downloadPath)
  }, [snapshot])

  const handleSave = async () => {
    if (!/^\d+$/.test(coverIndex)) {
      setStatus({ type: 'error', msg: '封面图片索引必须为非负整数' })
      return
    }
    const input: DownloadConfig = {
      fullTitle: titleFormat,
      defaultCoverIndex: Number(coverIndex),
      downloadPath,
    }
    setSaving(true)
    setStatus(null)
    try {
      await updateDownloadConfig(input)
      setStatus({ type: 'success', msg: '下载设置已保存' })
    } catch (saveError) {
      setStatus({ type: 'error', msg: messageFrom(saveError) })
    } finally {
      setSaving(false)
    }
  }

  const handleOpenDownloadFolder = async () => {
    setStatus(null)
    try {
      await api.openFolder('root')
    } catch (openError) {
      setStatus({ type: 'error', msg: messageFrom(openError) })
    }
  }

  const hasUnsavedDownloadPath = downloadPath !== snapshot?.download.downloadPath

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-lg font-semibold text-apple-heading">书名格式</h3>
      <div className="space-y-2">
        {TITLE_FORMATS.map((format) => {
          const examples: Record<TitleFormat, string> = {
            FULL: '败北女角太多了！(败犬女主太多了！)',
            IN: '败犬女主太多了！',
            OUT: '败北女角太多了！',
          }
          return (
            <button
              key={format.value}
              type="button"
              onClick={() => setTitleFormat(format.value)}
              className={`w-full text-left px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                titleFormat === format.value
                  ? 'border-apple-accent bg-[rgba(0,113,227,0.06)]'
                  : 'border-apple-border-subtle bg-white hover:border-apple-accent/40'
              }`}
            >
              <div className={`text-sm font-semibold ${
                titleFormat === format.value ? 'text-apple-accent' : 'text-apple-heading'
              }`}>
                {format.label}
              </div>
              <div className={`text-[11px] mt-0.5 ${
                titleFormat === format.value ? 'text-apple-accent/70' : 'text-apple-tertiary'
              }`}>
                {examples[format.value]}
              </div>
            </button>
          )
        })}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-apple-heading mb-2">封面图片索引</h3>
        <div className="flex items-center gap-3">
          <input
            aria-label="封面图片索引"
            className="w-24 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            value={coverIndex}
            onChange={(event) => setCoverIndex(event.target.value)}
          />
          <span className="text-xs text-apple-tertiary">0 表示第一张插图，1 表示第二张，依此类推</span>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-apple-heading mb-2">下载存储路径</h3>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading truncate">
            {downloadPath || <span className="text-apple-tertiary">默认下载目录</span>}
          </div>
          <button
            type="button"
            className="flex-shrink-0 px-4 py-2 text-[12px] font-medium text-apple-accent bg-apple-accent-light rounded-[20px] hover:bg-apple-accent/15 transition-colors"
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
          <button
            type="button"
            disabled={hasUnsavedDownloadPath}
            title={hasUnsavedDownloadPath ? '请先保存下载设置' : '打开当前下载目录'}
            className="flex-shrink-0 px-4 py-2 text-[12px] font-medium text-apple-secondary bg-apple-card border border-apple-border-subtle rounded-[20px] hover:text-apple-heading disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            onClick={() => void handleOpenDownloadFolder()}
          >
            打开目录
          </button>
          {downloadPath && (
            <button
              type="button"
              aria-label="清除文件夹路径"
              className="flex-shrink-0 text-apple-tertiary hover:text-apple-secondary transition-colors text-[16px] leading-none px-1"
              onClick={() => setDownloadPath('')}
            >
              ×
            </button>
          )}
        </div>
        <p className="text-[12px] text-apple-tertiary mt-1.5">
          留空时，开发版使用项目 downloads 目录，安装版使用系统下载目录下的 Wenku8Downloader。修改后新下载的文件将保存到新路径，已有文件不受影响。
        </p>
      </div>
      <button
        disabled={saving}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40 rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={() => void handleSave()}
      >
        {saving ? '保存中...' : '保存下载设置'}
      </button>
      {status && (
        <StatusAlert
          type={status.type}
          message={status.msg}
          onDismiss={() => setStatus(null)}
        />
      )}
    </div>
  )
}

function LogTab() {
  const { snapshot, updateLogConfig } = useConfigStore()
  const [retentionDays, setRetentionDays] = useState('30')
  const [maxFileSizeMb, setMaxFileSizeMb] = useState('100')
  const [maxTotalSizeMb, setMaxTotalSizeMb] = useState('200')
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{
    type: 'success' | 'error'
    msg: string
  } | null>(null)

  useEffect(() => {
    if (!snapshot) return
    setRetentionDays(String(snapshot.logging.retentionDays))
    setMaxFileSizeMb(String(snapshot.logging.maxFileSizeMb))
    setMaxTotalSizeMb(String(snapshot.logging.maxTotalSizeMb))
    setEdited(false)
  }, [snapshot])

  const validation = validateLogConfigFields(
    retentionDays,
    maxFileSizeMb,
    maxTotalSizeMb,
  )

  const handleSave = async () => {
    setStatus(null)
    if (!validation.value) return
    setSaving(true)
    try {
      await updateLogConfig(validation.value)
      setStatus({ type: 'success', msg: '日志设置已保存并立即生效' })
    } catch (saveError) {
      setStatus({ type: 'error', msg: messageFrom(saveError) })
    } finally {
      setSaving(false)
    }
  }

  const handleOpenDirectory = async () => {
    setStatus(null)
    try {
      await api.openLogFolder()
    } catch (openError) {
      setStatus({ type: 'error', msg: messageFrom(openError) })
    }
  }

  const fields = [
    {
      label: '保留天数',
      value: retentionDays,
      setValue: setRetentionDays,
      hint: '超过该天数的历史日志会自动删除，范围 1–365 天。',
    },
    {
      label: '单文件上限（MB）',
      value: maxFileSizeMb,
      setValue: setMaxFileSizeMb,
      hint: '单个日志文件达到上限后会在当天创建新的分段文件，范围 1–1024 MB。',
    },
    {
      label: '目录总上限（MB）',
      value: maxTotalSizeMb,
      setValue: setMaxTotalSizeMb,
      hint: '按最旧优先清理日志；必须至少为单文件上限的两倍，范围 2–10240 MB。',
    },
  ]

  return (
    <div className="space-y-4 max-w-lg">
      <div className="rounded-xl border border-apple-border-subtle bg-[#fafafa] p-4">
        <h3 className="text-sm font-semibold text-apple-heading">本地日志</h3>
        <p className="text-[12px] text-apple-tertiary mt-1">
          日志按天保存，错误会额外写入独立文件。日志只保存在本机，不会自动上传。
        </p>
        <button
          type="button"
          className="mt-3 px-4 py-2 text-[12px] font-medium text-apple-accent bg-apple-accent-light rounded-[20px] hover:bg-apple-accent/15 transition-colors"
          onClick={() => void handleOpenDirectory()}
        >
          打开日志目录
        </button>
      </div>

      {fields.map((field) => (
        <label key={field.label} className="block">
          <span className="block text-sm font-semibold text-apple-heading mb-2">
            {field.label}
          </span>
          <input
            aria-label={field.label}
            inputMode="numeric"
            className="w-40 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            value={field.value}
            onChange={(event) => {
              field.setValue(event.target.value)
              setEdited(true)
              setStatus(null)
            }}
          />
          <span className="block text-[12px] text-apple-tertiary mt-1.5">
            {field.hint}
          </span>
        </label>
      ))}

      <button
        disabled={saving || validation.value === undefined}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40 rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={() => void handleSave()}
      >
        {saving ? '保存中...' : '保存日志设置'}
      </button>
      {edited && validation.error && (
        <p role="alert" className="text-sm text-red-600">
          {validation.error}
        </p>
      )}
      {status && (
        <StatusAlert
          type={status.type}
          message={status.msg}
          onDismiss={() => setStatus(null)}
        />
      )}
    </div>
  )
}
