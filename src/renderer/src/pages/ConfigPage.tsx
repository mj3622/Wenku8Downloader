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
import {
  useLoginOperationStore,
  type LoginCookieState,
} from '../stores/loginOperationStore'
import { toast } from '../stores/toastStore'
import { formatTimeAgo } from '../utils/format'
import { getUserFeedback } from '../utils/userFeedback'

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
  '确定要清除已保存的登录信息吗？此操作不会删除已下载文件。'

type LogField = 'retentionDays' | 'maxFileSizeMb' | 'maxTotalSizeMb'

function validateLogConfigFields(
  retentionDays: string,
  maxFileSizeMb: string,
  maxTotalSizeMb: string,
): { value?: LogConfig; errors: Partial<Record<LogField, string>> } {
  const fields = [
    { key: 'retentionDays', value: retentionDays, minimum: 1, maximum: 365, label: '保留天数' },
    { key: 'maxFileSizeMb', value: maxFileSizeMb, minimum: 1, maximum: 1024, label: '单文件上限（MB）' },
    { key: 'maxTotalSizeMb', value: maxTotalSizeMb, minimum: 2, maximum: 10240, label: '目录总上限（MB）' },
  ] as const
  const parsed: Partial<Record<LogField, number>> = {}
  const errors: Partial<Record<LogField, string>> = {}
  for (const field of fields) {
    if (!/^\d+$/.test(field.value)) {
      errors[field.key] = `${field.label}必须为 ${field.minimum} 到 ${field.maximum} 的整数`
      continue
    }
    const value = Number(field.value)
    if (value < field.minimum || value > field.maximum) {
      errors[field.key] = `${field.label}必须为 ${field.minimum} 到 ${field.maximum} 的整数`
      continue
    }
    parsed[field.key] = value
  }

  const fileSize = parsed.maxFileSizeMb
  const totalSize = parsed.maxTotalSizeMb
  if (fileSize !== undefined && totalSize !== undefined && totalSize < fileSize * 2) {
    errors.maxTotalSizeMb = '目录总上限必须至少为单文件上限的两倍'
  }

  if (Object.keys(errors).length > 0) return { errors }

  return {
    value: {
      retentionDays: parsed.retentionDays!,
      maxFileSizeMb: parsed.maxFileSizeMb!,
      maxTotalSizeMb: parsed.maxTotalSizeMb!,
    },
    errors,
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
  const initialConfigRequest = useRef(false)
  const healthNotice = useRef<string | null>(null)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error'
    msg: string
  } | null>(null)

  useEffect(() => {
    if (initialConfigRequest.current) return
    initialConfigRequest.current = true
    if (useLoginOperationStore.getState().kind !== 'idle') return
    void fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    const health = snapshot?.health
    if (!health || health.state === 'ok') {
      healthNotice.current = null
      return
    }

    const feedback = getUserFeedback(health.message, 'config-load')
    const noticeKey = `${health.state}:${feedback.message}`
    if (healthNotice.current === noticeKey) return
    healthNotice.current = noticeKey

    const title = health.state === 'recovery-required'
      ? '配置需要处理'
      : health.state === 'read-only-newer-version'
        ? '当前配置为只读'
        : '系统安全存储不可用'
    toast.warning({ title, message: feedback.message })
  }, [snapshot])

  const handleReset = async () => {
    if (resetInFlight.current) return
    if (!window.confirm(RECOVERY_CONFIRMATION)) return

    resetInFlight.current = true
    setResetting(true)
    setResetStatus(null)
    try {
      await resetCorruptConfig()
      setResetStatus({ type: 'success', msg: '配置问题已处理' })
      toast.success({ title: '配置问题已处理', message: '现在可以继续使用应用。' })
    } catch (resetError) {
      const feedback = getUserFeedback(resetError, 'config-reset')
      setResetStatus({ type: 'error', msg: feedback.message })
      toast.error(feedback)
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
          <p>配置加载失败：{error || '暂时无法读取设置，请重试。'}</p>
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
          <p>{getUserFeedback(snapshot.health.message, 'config-load').message}</p>
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
            announce={false}
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
                type="button"
                aria-pressed={tab === item.key}
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
          <div hidden={tab !== 'login'}>
            <LoginTab />
          </div>
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

type CookieState = LoginCookieState

function CookieStatusCard({
  cookieState,
  cookieMsg,
  timeAgo,
  disabled,
  onRefresh,
}: {
  cookieState: CookieState
  cookieMsg: string
  timeAgo: string | null
  disabled: boolean
  onRefresh: () => void
}) {
  const stateConfig = COOKIE_STATE_CONFIG[cookieState]

  return (
    <div className={`rounded-xl border p-5 ${CARD_STYLE[cookieState]}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateConfig.dot}`} />
        <h3 className="text-sm font-semibold text-apple-heading">登录状态</h3>
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
          disabled={disabled || cookieState === 'loading'}
          className="px-5 py-2 bg-apple-accent-light text-apple-accent hover:bg-apple-accent/15 disabled:opacity-40 rounded-[20px] text-[13px] font-medium transition-colors flex-shrink-0"
          onClick={onRefresh}
        >
          {cookieState === 'loading' ? '刷新中...' : '刷新登录状态'}
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
  const {
    kind: accountOperation,
    cookieState,
    cookieMessage: cookieMsg,
    lastRefresh,
    begin: beginAccountOperation,
    isCurrent: isCurrentAccountOperation,
    startLogin,
    updateProgress,
    markSubscriptionError,
    setCookieResult,
    syncFromSnapshot,
    preserveResultThroughSnapshotSync,
    finish: finishAccountOperation,
  } = useLoginOperationStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const mounted = useRef(true)
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string
    password?: string
  }>({})
  const storedUsername = snapshot?.account.username
  const hasStoredPassword = snapshot?.account.hasPassword
  const hasStoredCookies = snapshot?.account.hasCookies

  useEffect(() => {
    if (storedUsername === undefined) return
    setUsername(storedUsername)
    setPassword('')
    syncFromSnapshot(Boolean(hasStoredCookies))
  }, [hasStoredCookies, hasStoredPassword, storedUsername, syncFromSnapshot])

  useEffect(() => {
    try {
      return api.getCookieProgress((data) => {
        updateProgress(data.operationId, data.message)
      })
    } catch (subscriptionError) {
      const feedback = getUserFeedback(subscriptionError, 'login')
      markSubscriptionError(feedback.message)
      toast.error(feedback)
      return undefined
    }
  }, [markSubscriptionError, updateProgress])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const doRefresh = async (showSuccess = true, operationGeneration?: number) => {
    const generation = operationGeneration ?? beginAccountOperation(
      'refreshing',
      Boolean(snapshot?.account.hasCookies),
    )
    if (!isCurrentAccountOperation(generation)) return

    const currentLoginOperationId = startLogin(generation)
    if (!currentLoginOperationId) return
    try {
      await api.autoGetCookie(currentLoginOperationId)
      if (!isCurrentAccountOperation(generation)) return
      const configLoaded = await fetchConfig({
        context: 'login',
        isCurrent: () => isCurrentAccountOperation(generation),
      })
      if (!isCurrentAccountOperation(generation)) return
      if (!configLoaded) {
        setCookieResult(
          generation,
          'error',
          '登录可能已完成，但无法读取最新状态，请重试。',
        )
        return
      }
      const refreshedSnapshot = await api.getConfig('login')
      if (!isCurrentAccountOperation(generation)) return
      if (!refreshedSnapshot.account.hasCookies) {
        const feedback = getUserFeedback(
          new Error('登录完成后未检测到有效登录状态，请重试。'),
          'login',
        )
        if (isCurrentAccountOperation(generation)) {
          setCookieResult(generation, 'error', feedback.message)
          preserveResultThroughSnapshotSync(generation)
        }
        toast.error(feedback)
        return
      }
      setCookieResult(generation, 'valid', '已就绪', Date.now())
      if (showSuccess) {
        toast.success({ title: '登录状态已更新', message: '现在可以继续检索和下载。' })
      }
    } catch (refreshError) {
      if (!isCurrentAccountOperation(generation)) return
      const feedback = getUserFeedback(refreshError, 'login')
      setCookieResult(generation, 'error', feedback.message)
      toast.error(feedback)
    } finally {
      finishAccountOperation(generation)
    }
  }

  const handleSave = async () => {
    const normalizedUsername = username.trim()
    const nextErrors: typeof fieldErrors = {}
    if (!normalizedUsername) nextErrors.username = '请输入用户名'
    else if (normalizedUsername.length > 256) nextErrors.username = '用户名不能超过 256 个字符'
    if (password.length > 4096) nextErrors.password = '密码内容过长，请重新输入'
    else if (!password && !snapshot?.account.hasPassword) {
      nextErrors.password = '请输入密码'
    } else if (
      !password
      && snapshot
      && normalizedUsername !== snapshot.account.username
    ) {
      nextErrors.password = '用户名变更时必须提供密码'
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }

    const generation = beginAccountOperation('saving', Boolean(snapshot?.account.hasCookies))
    setFieldErrors({})
    const input: UpdateCredentialsInput = password
      ? { username: normalizedUsername, password }
      : { username: normalizedUsername }
    try {
      await updateCredentials(input, {
        isCurrent: () => isCurrentAccountOperation(generation),
      })
      if (!isCurrentAccountOperation(generation)) return
      if (mounted.current) setPassword('')
      toast.success({ title: '账号已保存', message: '正在更新登录状态。' })
      await doRefresh(false, generation)
    } catch (saveError) {
      if (!isCurrentAccountOperation(generation)) return
      const feedback = getUserFeedback(saveError, 'account-save')
      toast.error(feedback)
    } finally {
      finishAccountOperation(generation)
    }
  }

  const handleRefresh = async () => {
    const normalizedUsername = username.trim()
    const nextErrors: typeof fieldErrors = {}
    if (!normalizedUsername || !snapshot?.account.username) {
      nextErrors.username = normalizedUsername ? '请先保存用户名' : '请输入用户名'
    } else if (normalizedUsername !== snapshot.account.username) {
      nextErrors.username = '用户名已修改，请先保存'
    }
    if (password) nextErrors.password = '密码已修改，请先保存'
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    await doRefresh()
  }

  const handleClearCredentials = async () => {
    if (!window.confirm(CLEAR_CREDENTIALS_CONFIRMATION)) return

    const generation = beginAccountOperation('clearing', Boolean(snapshot?.account.hasCookies))
    try {
      await updateCredentials({ username: '', password: '' }, {
        isCurrent: () => isCurrentAccountOperation(generation),
      })
      if (!isCurrentAccountOperation(generation)) return
      if (mounted.current) {
        setUsername('')
        setPassword('')
        setFieldErrors({})
      }
      setCookieResult(generation, 'idle', '', null)
      toast.success({ title: '登录信息已清除', message: '已保存的账号和登录状态均已移除。' })
    } catch (clearError) {
      if (!isCurrentAccountOperation(generation)) return
      const feedback = getUserFeedback(clearError, 'account-save')
      toast.error(feedback)
    } finally {
      finishAccountOperation(generation)
    }
  }

  const timeAgo = lastRefresh ? formatTimeAgo(lastRefresh) : null
  const hasStoredCredentials = Boolean(
    snapshot?.account.username
    || snapshot?.account.hasPassword
    || snapshot?.account.hasCookies,
  )
  const saving = accountOperation === 'saving'
  const clearing = accountOperation === 'clearing'
  const accountBusy = accountOperation !== 'idle'

  return (
    <div className="space-y-4 max-w-lg">
      <div className="rounded-xl border border-apple-border-subtle bg-[#fafafa] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-apple-accent flex-shrink-0" />
          <h3 className="text-sm font-semibold text-apple-heading">登录信息</h3>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="config-username" className="block text-[12px] font-medium text-apple-secondary mb-1.5">用户名</label>
            <input
              id="config-username"
              disabled={accountBusy}
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              placeholder="轻小说文库用户名"
              maxLength={257}
              value={username}
              aria-invalid={fieldErrors.username ? 'true' : undefined}
              aria-describedby={fieldErrors.username ? 'config-username-error' : undefined}
              onChange={(event) => {
                setUsername(event.target.value)
                if (fieldErrors.username) {
                  setFieldErrors((current) => ({ ...current, username: undefined }))
                }
              }}
            />
            {fieldErrors.username && (
              <p id="config-username-error" role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors.username}
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="config-password" className="block text-[12px] font-medium text-apple-secondary">密码</label>
              {snapshot?.account.hasPassword && (
                <span className="text-[11px] text-green-600">已保存密码</span>
              )}
            </div>
            <input
              id="config-password"
              type="password"
              disabled={accountBusy}
              maxLength={4097}
              className="w-full px-3 py-2 bg-white border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              placeholder={snapshot?.account.hasPassword ? '留空则保留已保存密码' : '请输入密码'}
              value={password}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={fieldErrors.password ? 'config-password-error' : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
                if (fieldErrors.password) {
                  setFieldErrors((current) => ({ ...current, password: undefined }))
                }
              }}
            />
            {fieldErrors.password && (
              <p id="config-password-error" role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>
        </div>
        <button
          disabled={accountBusy}
          className="mt-4 w-full px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40 rounded-[20px] text-[13px] font-medium text-white transition-opacity"
          onClick={() => void handleSave()}
        >
          {saving ? '保存中...' : '保存账号'}
        </button>
        {hasStoredCredentials && (
          <button
            type="button"
            disabled={accountBusy}
            className="mt-2 w-full px-6 py-2.5 border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-[20px] text-[13px] font-medium transition-colors"
            onClick={() => void handleClearCredentials()}
          >
            {clearing ? '清除中...' : '清除已保存登录信息'}
          </button>
        )}
        <p className="text-[12px] text-apple-tertiary mt-2">
          保存后会自动尝试登录；密码留空会保留已保存密码。
        </p>
      </div>

      <CookieStatusCard
        cookieState={cookieState}
        cookieMsg={cookieMsg}
        timeAgo={timeAgo}
        disabled={saving || clearing}
        onRefresh={() => void handleRefresh()}
      />

      <p className="text-[12px] text-apple-tertiary text-center">
        登录状态失效后，点击「刷新登录状态」重新登录
      </p>

    </div>
  )
}

function DownloadTab() {
  const { snapshot, updateDownloadConfig } = useConfigStore()
  const [titleFormat, setTitleFormat] = useState<TitleFormat>('FULL')
  const [coverIndex, setCoverIndex] = useState('0')
  const [coverIndexError, setCoverIndexError] = useState<string | null>(null)
  const [downloadPath, setDownloadPath] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!snapshot) return
    setTitleFormat(snapshot.download.fullTitle)
    setCoverIndex(String(snapshot.download.defaultCoverIndex))
    setCoverIndexError(null)
    setDownloadPath(snapshot.download.downloadPath)
  }, [snapshot])

  const handleSave = async () => {
    const parsedCoverIndex = Number(coverIndex)
    if (!/^\d+$/.test(coverIndex) || !Number.isSafeInteger(parsedCoverIndex)) {
      setCoverIndexError('封面图片索引必须为非负整数')
      return
    }
    const input: DownloadConfig = {
      fullTitle: titleFormat,
      defaultCoverIndex: parsedCoverIndex,
      downloadPath,
    }
    setSaving(true)
    setCoverIndexError(null)
    try {
      await updateDownloadConfig(input)
      toast.success({ title: '下载设置已保存', message: '新的下载将使用当前设置。' })
    } catch (saveError) {
      const feedback = getUserFeedback(saveError, 'config-save')
      toast.error(feedback)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenDownloadFolder = async () => {
    try {
      await api.openFolder('root')
    } catch (openError) {
      toast.error(getUserFeedback(openError, 'open-folder'))
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
              aria-pressed={titleFormat === format.value}
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
            aria-invalid={coverIndexError ? 'true' : undefined}
            aria-describedby={coverIndexError ? 'cover-index-error' : undefined}
            className="w-24 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
            value={coverIndex}
            onChange={(event) => {
              setCoverIndex(event.target.value)
              if (coverIndexError) setCoverIndexError(null)
            }}
          />
          <span className="text-xs text-apple-tertiary">0 表示第一张插图，1 表示第二张，依此类推</span>
        </div>
        {coverIndexError && (
          <p id="cover-index-error" role="alert" className="mt-1.5 text-xs text-red-600">
            {coverIndexError}
          </p>
        )}
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
              } catch (selectError) {
                toast.error(getUserFeedback(selectError, 'select-folder'))
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
    if (!validation.value) return
    setSaving(true)
    try {
      await updateLogConfig(validation.value)
      toast.success({ title: '日志设置已保存', message: '新的日志限制已立即生效。' })
    } catch (saveError) {
      const feedback = getUserFeedback(saveError, 'log-save')
      toast.error(feedback)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenDirectory = async () => {
    try {
      await api.openLogFolder()
    } catch (openError) {
      toast.error(getUserFeedback(openError, 'open-log-folder'))
    }
  }

  const fields = [
    {
      key: 'retentionDays' as const,
      label: '保留天数',
      value: retentionDays,
      setValue: setRetentionDays,
      hint: '超过该天数的历史日志会自动删除，范围 1–365 天。',
    },
    {
      key: 'maxFileSizeMb' as const,
      label: '单文件上限（MB）',
      value: maxFileSizeMb,
      setValue: setMaxFileSizeMb,
      hint: '单个日志文件达到上限后会在当天创建新的分段文件，范围 1–1024 MB。',
    },
    {
      key: 'maxTotalSizeMb' as const,
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

      {fields.map((field) => {
        const fieldError = edited ? validation.errors[field.key] : undefined
        const errorId = `log-${field.key}-error`
        return (
          <label key={field.key} className="block">
            <span className="block text-sm font-semibold text-apple-heading mb-2">
              {field.label}
            </span>
            <input
              aria-label={field.label}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              inputMode="numeric"
              className="w-40 px-3 py-2 bg-apple-card border border-apple-border-input rounded-xl text-sm text-apple-heading focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10 transition-colors"
              value={field.value}
              onChange={(event) => {
                field.setValue(event.target.value)
                setEdited(true)
              }}
            />
            <span className="block text-[12px] text-apple-tertiary mt-1.5">
              {field.hint}
            </span>
            {fieldError && (
              <span id={errorId} role="alert" className="mt-1 block text-sm text-red-600">
                {fieldError}
              </span>
            )}
          </label>
        )
      })}

      <button
        disabled={saving || validation.value === undefined}
        className="px-6 py-2.5 bg-apple-accent hover:opacity-90 disabled:opacity-40 rounded-[24px] text-[13px] font-medium text-white transition-opacity"
        onClick={() => void handleSave()}
      >
        {saving ? '保存中...' : '保存日志设置'}
      </button>
    </div>
  )
}
