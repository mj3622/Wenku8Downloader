import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import {
  IconDots,
  IconFolderOpen,
  IconFolderPlus,
  IconLoader2,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
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
  '确定要处理配置问题吗？损坏文件将保留恢复备份，已迁移的旧明文配置将被清理'
const CLEAR_CREDENTIALS_CONFIRMATION =
  '确定要清除已保存的登录信息吗？此操作不会删除已下载文件'
const CLEAR_CACHE_CONFIRMATION =
  '清除作品缓存？已下载的 EPUB 和插图不会被删除。'

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
        : '本地敏感信息存储不可用'
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
      toast.success({ title: '配置问题已处理', message: '现在可以继续使用应用' })
    } catch (resetError) {
      const feedback = getUserFeedback(resetError, 'config-reset')
      setResetStatus({ type: 'error', msg: feedback.message })
      toast.error(feedback)
    } finally {
      resetInFlight.current = false
      setResetting(false)
    }
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentKey: typeof CONFIG_TABS[number]['key'],
  ) => {
    const currentIndex = CONFIG_TABS.findIndex((item) => item.key === currentKey)
    let nextIndex = currentIndex

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % CONFIG_TABS.length
    else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + CONFIG_TABS.length) % CONFIG_TABS.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = CONFIG_TABS.length - 1
    else return

    event.preventDefault()
    const nextTab = CONFIG_TABS[nextIndex].key
    setTab(nextTab)
    document.getElementById(`config-tab-${nextTab}`)?.focus()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-apple-heading mb-5">配置</h1>

      {loadState === 'error' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>配置加载失败：{error || '暂时无法读取设置，请重试'}</p>
          <button
            className="motion-pressable mt-2 rounded-lg bg-red-100 px-4 py-1.5 hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
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
              className="motion-pressable mt-2 rounded-lg bg-amber-100 px-4 py-1.5 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:bg-amber-50 disabled:text-amber-400"
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
          <div
            role="tablist"
            aria-label="配置分类"
            className="flex gap-1 mb-6 border-b border-apple-border-subtle"
          >
            {CONFIG_TABS.map((item) => (
              <button
                key={item.key}
                id={`config-tab-${item.key}`}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                aria-controls={`config-panel-${item.key}`}
                tabIndex={tab === item.key ? 0 : -1}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => handleTabKeyDown(event, item.key)}
                className={`border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30 focus-visible:ring-inset ${
                  tab === item.key
                    ? 'border-apple-accent font-medium text-apple-accent'
                    : 'border-transparent text-apple-secondary hover:text-apple-heading'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            id="config-panel-login"
            role="tabpanel"
            aria-labelledby="config-tab-login"
            hidden={tab !== 'login'}
          >
            <LoginTab />
          </div>
          <div
            id="config-panel-download"
            role="tabpanel"
            aria-labelledby="config-tab-download"
            hidden={tab !== 'download'}
          >
            <DownloadTab />
          </div>
          <div
            id="config-panel-logging"
            role="tabpanel"
            aria-labelledby="config-tab-logging"
            hidden={tab !== 'logging'}
          >
            <LogTab active={tab === 'logging'} />
          </div>
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
    dot: 'bg-apple-accent',
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

type CookieState = LoginCookieState
type SaveState = 'saved' | 'editing' | 'saving' | 'error'

const SAVE_STATE_CONFIG = {
  editing: { label: '未保存', className: 'text-amber-600' },
  error: { label: '保存失败', className: 'text-red-600' },
} as const

function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state === 'saved' || state === 'saving') return null
  const config = SAVE_STATE_CONFIG[state]
  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-sm font-medium ${config.className}`}
    >
      {config.label}
    </span>
  )
}

function CookieStatusCard({
  cookieState,
  cookieMsg,
  disabled,
  onRefresh,
}: {
  cookieState: CookieState
  cookieMsg: string
  disabled: boolean
  onRefresh: () => void
}) {
  const stateConfig = COOKIE_STATE_CONFIG[cookieState]

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2" title={cookieState === 'error' ? cookieMsg : undefined}>
        {stateConfig.showSpinner ? (
          <IconLoader2 aria-hidden="true" className="motion-spinner h-4 w-4 animate-spin text-apple-accent" stroke={1.8} />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateConfig.dot}`} />
        )}
        <span className={`text-sm font-semibold ${stateConfig.text}`}>
          {cookieState === 'loading' ? cookieMsg : stateConfig.label}
        </span>
      </div>
      <button
        disabled={disabled || cookieState === 'loading'}
        className="motion-pressable inline-flex items-center gap-1.5 rounded-lg border border-apple-border-subtle bg-white px-3 py-1.5 text-sm font-medium text-apple-accent hover:border-apple-accent/30 hover:bg-apple-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25 disabled:cursor-not-allowed disabled:text-apple-tertiary"
        onClick={onRefresh}
      >
        {cookieState !== 'loading' && (
          <IconRefresh aria-hidden="true" size={15} stroke={1.8} />
        )}
        {cookieState === 'loading' ? '刷新中...' : '刷新状态'}
      </button>
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
  const accountMenuRef = useRef<HTMLDetailsElement>(null)
  const [credentialSaveState, setCredentialSaveState] = useState<SaveState>('saved')
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
          '登录可能已完成，但无法读取最新状态，请重试',
        )
        return
      }
      const refreshedSnapshot = await api.getConfig('login')
      if (!isCurrentAccountOperation(generation)) return
      if (!refreshedSnapshot.account.hasCookies) {
        const feedback = getUserFeedback(
          new Error('登录完成后未检测到有效登录状态，请重试'),
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
        toast.success({ title: '登录状态已更新', message: '现在可以继续检索和下载' })
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
    if (accountOperation !== 'idle') return

    const normalizedUsername = username.trim()
    const credentialsUnchanged = normalizedUsername === snapshot?.account.username && !password
    if (credentialsUnchanged && snapshot?.account.hasPassword) {
      setCredentialSaveState('saved')
      return
    }

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
      setCredentialSaveState('editing')
      return
    }

    setCredentialSaveState('saving')
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
      setCredentialSaveState('saved')
      await doRefresh(false, generation)
    } catch (saveError) {
      if (!isCurrentAccountOperation(generation)) return
      const feedback = getUserFeedback(saveError, 'account-save')
      setCredentialSaveState('error')
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
    if (accountMenuRef.current) accountMenuRef.current.open = false
    if (!window.confirm(CLEAR_CREDENTIALS_CONFIRMATION)) return

    setCredentialSaveState('saving')
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
      setCredentialSaveState('saved')
      toast.success({ title: '登录信息已清除', message: '已保存的账号和登录状态均已移除' })
    } catch (clearError) {
      if (!isCurrentAccountOperation(generation)) return
      const feedback = getUserFeedback(clearError, 'account-save')
      setCredentialSaveState('error')
      toast.error(feedback)
    } finally {
      finishAccountOperation(generation)
    }
  }

  const hasStoredCredentials = Boolean(
    snapshot?.account.username
    || snapshot?.account.hasPassword
    || snapshot?.account.hasCookies,
  )
  const saving = accountOperation === 'saving'
  const clearing = accountOperation === 'clearing'
  const accountBusy = accountOperation !== 'idle'
  const effectiveSaveState = saving || clearing ? 'saving' : credentialSaveState

  const handleCredentialsBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof HTMLElement && nextTarget.closest('[data-account-menu]')) return
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    void handleSave()
  }

  const handleCredentialKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void handleSave()
  }

  return (
    <div className="max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-apple-border-subtle bg-apple-card">
        <section>
          <div className="flex flex-col gap-4 border-b border-apple-border-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-apple-heading">账号登录</h2>
              <SaveStateIndicator state={effectiveSaveState} />
            </div>
            <div className="flex items-center gap-2">
              <CookieStatusCard
                cookieState={cookieState}
                cookieMsg={cookieMsg}
                disabled={saving || clearing || credentialSaveState === 'editing'}
                onRefresh={() => void handleRefresh()}
              />
              {hasStoredCredentials && (
                <details ref={accountMenuRef} data-account-menu className="relative">
                  <summary
                    aria-label="更多账号操作"
                    className="motion-pressable flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-apple-secondary hover:bg-apple-accent-light hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25 [&::-webkit-details-marker]:hidden"
                  >
                    <IconDots aria-hidden="true" size={18} stroke={1.8} />
                  </summary>
                  <div className="motion-popover absolute right-0 top-10 z-10 min-w-40 rounded-lg border border-apple-border-subtle bg-white p-1 shadow-lg">
                    <button
                      type="button"
                      disabled={accountBusy}
                      className="motion-pressable w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:text-red-300"
                      onClick={() => void handleClearCredentials()}
                    >
                      {clearing ? '清除中...' : '清除登录信息'}
                    </button>
                  </div>
                </details>
              )}
            </div>
          </div>

          <div className="px-5 py-5 lg:px-6" onBlur={handleCredentialsBlur}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="config-username" className="mb-2 block text-sm font-medium text-apple-heading">用户名</label>
                <input
                  id="config-username"
                  disabled={accountBusy}
                  className="w-full rounded-lg border border-apple-border-input bg-white px-3 py-2 text-sm text-apple-heading transition-colors focus:outline-none focus:border-apple-accent/40 focus:ring-2 focus:ring-apple-accent/15 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-apple-secondary"
                  placeholder="轻小说文库用户名"
                  maxLength={257}
                  value={username}
                  aria-invalid={fieldErrors.username ? 'true' : undefined}
                  aria-describedby={fieldErrors.username ? 'config-username-error' : undefined}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setCredentialSaveState('editing')
                    if (fieldErrors.username) {
                      setFieldErrors((current) => ({ ...current, username: undefined }))
                    }
                  }}
                  onKeyDown={handleCredentialKeyDown}
                />
                {fieldErrors.username && (
                  <p id="config-username-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.username}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="config-password" className="block text-sm font-medium text-apple-heading">
                    密码{snapshot?.account.hasPassword ? '（已保存）' : ''}
                  </label>
                </div>
                <input
                  id="config-password"
                  type="password"
                  disabled={accountBusy}
                  maxLength={4097}
                  className="w-full rounded-lg border border-apple-border-input bg-white px-3 py-2 text-sm text-apple-heading transition-colors focus:outline-none focus:border-apple-accent/40 focus:ring-2 focus:ring-apple-accent/15 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-apple-secondary"
                  placeholder={snapshot?.account.hasPassword ? '留空不修改' : '请输入密码'}
                  value={password}
                  aria-invalid={fieldErrors.password ? 'true' : undefined}
                  aria-describedby={fieldErrors.password ? 'config-password-error' : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setCredentialSaveState('editing')
                    if (fieldErrors.password) {
                      setFieldErrors((current) => ({ ...current, password: undefined }))
                    }
                  }}
                  onKeyDown={handleCredentialKeyDown}
                />
                {fieldErrors.password && (
                  <p id="config-password-error" role="alert" className="mt-1 text-xs text-red-600">
                    {fieldErrors.password}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
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
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [clearingCache, setClearingCache] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!snapshot) return
    setTitleFormat(snapshot.download.fullTitle)
    setCoverIndex(String(snapshot.download.defaultCoverIndex))
    setCoverIndexError(null)
    setDownloadPath(snapshot.download.downloadPath)
  }, [snapshot])

  const saveDownloadConfig = async (nextConfig: DownloadConfig) => {
    if (saving) return
    if (!/^\d+$/.test(String(nextConfig.defaultCoverIndex))
      || !Number.isSafeInteger(nextConfig.defaultCoverIndex)) {
      setCoverIndexError('封面图片索引必须为非负整数')
      setSaveState('editing')
      return
    }
    if (snapshot
      && nextConfig.fullTitle === snapshot.download.fullTitle
      && nextConfig.defaultCoverIndex === snapshot.download.defaultCoverIndex
      && nextConfig.downloadPath === snapshot.download.downloadPath) {
      setSaveState('saved')
      return
    }
    setSaving(true)
    setSaveState('saving')
    setCoverIndexError(null)
    try {
      await updateDownloadConfig(nextConfig)
      setSaveState('saved')
    } catch (saveError) {
      const feedback = getUserFeedback(saveError, 'config-save')
      setSaveState('error')
      toast.error(feedback)
    } finally {
      setSaving(false)
    }
  }

  const currentDownloadConfig = (): DownloadConfig | null => {
    const parsedCoverIndex = Number(coverIndex)
    if (!/^\d+$/.test(coverIndex) || !Number.isSafeInteger(parsedCoverIndex)) {
      setCoverIndexError('封面图片索引必须为非负整数')
      setSaveState('editing')
      return null
    }
    return {
      fullTitle: titleFormat,
      defaultCoverIndex: parsedCoverIndex,
      downloadPath,
    }
  }

  const handleCoverIndexSave = () => {
    const nextConfig = currentDownloadConfig()
    if (nextConfig) void saveDownloadConfig(nextConfig)
  }

  const handleOpenDownloadFolder = async () => {
    try {
      await api.openFolder('root')
    } catch (openError) {
      toast.error(getUserFeedback(openError, 'open-folder'))
    }
  }

  const handleClearCache = async () => {
    if (clearingCache || !window.confirm(CLEAR_CACHE_CONFIRMATION)) return
    setClearingCache(true)
    try {
      const result = await api.clearCache()
      toast.success({
        title: '缓存已清除',
        message: result.deferred
          ? '缓存已清除，正在下载的任务所使用的数据将在任务结束后自动处理'
          : '作品缓存已清除，已下载内容保持不变',
      })
    } catch (clearError) {
      toast.error(getUserFeedback(clearError, 'cache-clear'))
    } finally {
      if (mounted.current) setClearingCache(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-apple-heading">下载选项</h2>
        <SaveStateIndicator state={saving ? 'saving' : saveState} />
      </div>
      <h3 className="text-sm font-semibold text-apple-heading">书名格式</h3>
      <div className="grid gap-3 sm:grid-cols-3">
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
              data-download-action
              disabled={saving}
              aria-pressed={titleFormat === format.value}
              onClick={() => {
                setTitleFormat(format.value)
                void saveDownloadConfig({
                  fullTitle: format.value,
                  defaultCoverIndex: Number(coverIndex),
                  downloadPath,
                })
              }}
              className={`motion-pressable w-full cursor-pointer rounded-xl border px-4 py-3 text-left ${
                titleFormat === format.value
                  ? 'border-apple-accent bg-apple-accent-light'
                  : 'border-apple-border-subtle bg-white hover:border-apple-accent/40'
              }`}
            >
              <div className={`text-sm font-semibold ${
                titleFormat === format.value ? 'text-apple-accent' : 'text-apple-heading'
              }`}>
                {format.label}
              </div>
              <div className={`mt-0.5 text-xs ${
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
            disabled={saving}
            className="w-24 rounded-lg border border-apple-border-input bg-apple-card px-3 py-2 text-sm text-apple-heading transition-colors focus:outline-none focus:border-apple-accent/40 focus:ring-2 focus:ring-apple-accent/15"
            value={coverIndex}
            onChange={(event) => {
              setCoverIndex(event.target.value)
              setSaveState('editing')
              if (coverIndexError) setCoverIndexError(null)
            }}
            onBlur={(event) => {
              if (event.relatedTarget instanceof HTMLElement
                && event.relatedTarget.closest('[data-download-action]')) return
              handleCoverIndexSave()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              handleCoverIndexSave()
            }}
          />
          <span className="text-sm text-apple-tertiary">索引从 0 开始，0 代表第一张图</span>
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
          <div className="flex-1 truncate rounded-lg border border-apple-border-input bg-apple-card px-3 py-2 text-sm text-apple-heading">
            {downloadPath || <span className="text-apple-tertiary">默认下载目录</span>}
          </div>
          <button
            type="button"
            data-download-action
            disabled={saving}
            className="motion-pressable inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-apple-accent-light px-4 py-2 text-sm font-medium text-apple-accent hover:bg-apple-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25 disabled:cursor-not-allowed disabled:text-apple-tertiary"
            onClick={async () => {
              try {
                const path = await api.selectFolder()
                if (path) {
                  setDownloadPath(path)
                  const parsedCoverIndex = Number(coverIndex)
                  await saveDownloadConfig({
                    fullTitle: titleFormat,
                    defaultCoverIndex: parsedCoverIndex,
                    downloadPath: path,
                  })
                }
              } catch (selectError) {
                toast.error(getUserFeedback(selectError, 'select-folder'))
              }
            }}
          >
            <IconFolderPlus aria-hidden="true" size={16} stroke={1.8} />
            选择文件夹
          </button>
          <button
            type="button"
            data-download-action
            disabled={saving}
            title={saving ? '保存完成后可打开目录' : '打开当前下载目录'}
            className="motion-pressable inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-apple-border-subtle bg-apple-card px-4 py-2 text-sm font-medium text-apple-secondary hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-apple-tertiary"
            onClick={() => void handleOpenDownloadFolder()}
          >
            <IconFolderOpen aria-hidden="true" size={16} stroke={1.8} />
            打开目录
          </button>
          {downloadPath && (
            <button
              type="button"
              data-download-action
              aria-label="清除文件夹路径"
              disabled={saving}
              className="motion-pressable flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-apple-tertiary hover:bg-apple-bg hover:text-apple-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/20"
              onClick={() => {
                setDownloadPath('')
                void saveDownloadConfig({
                  fullTitle: titleFormat,
                  defaultCoverIndex: Number(coverIndex),
                  downloadPath: '',
                })
              }}
            >
              <IconX aria-hidden="true" size={16} stroke={1.8} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-sm text-apple-tertiary">
          留空使用默认目录，仅影响后续下载
        </p>
      </div>
      <div className="flex items-center justify-between gap-6 border-t border-apple-border-subtle pt-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-apple-heading">缓存</h3>
          <p className="mt-1 text-sm text-apple-tertiary">
            作品内容会按更新时间自动复用；搜索结果始终实时获取。
          </p>
        </div>
        <button
          type="button"
          disabled={clearingCache}
          onClick={() => void handleClearCache()}
          className="motion-pressable inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearingCache && <IconLoader2 aria-hidden="true" size={15} className="animate-spin" />}
          {clearingCache ? '正在清除…' : '清除缓存'}
        </button>
      </div>
    </div>
  )
}

function formatLogSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function LogTab({ active }: { active: boolean }) {
  const { snapshot, updateLogConfig } = useConfigStore()
  const [retentionDays, setRetentionDays] = useState('30')
  const [maxFileSizeMb, setMaxFileSizeMb] = useState('100')
  const [maxTotalSizeMb, setMaxTotalSizeMb] = useState('200')
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [logSizeBytes, setLogSizeBytes] = useState<number | null>(null)
  const [logSizeState, setLogSizeState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!snapshot) return
    setRetentionDays(String(snapshot.logging.retentionDays))
    setMaxFileSizeMb(String(snapshot.logging.maxFileSizeMb))
    setMaxTotalSizeMb(String(snapshot.logging.maxTotalSizeMb))
    setEdited(false)
  }, [snapshot])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLogSizeState('loading')
    void api.getLogStats()
      .then((stats) => {
        if (cancelled) return
        setLogSizeBytes(stats.totalSizeBytes)
        setLogSizeState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setLogSizeBytes(null)
        setLogSizeState('error')
      })
    return () => {
      cancelled = true
    }
  }, [active, snapshot?.logging])

  const validation = validateLogConfigFields(
    retentionDays,
    maxFileSizeMb,
    maxTotalSizeMb,
  )

  const handleSave = async () => {
    if (!edited || saving) return
    if (!validation.value) {
      setSaveState('editing')
      return
    }
    setSaving(true)
    setSaveState('saving')
    try {
      await updateLogConfig(validation.value)
      setSaveState('saved')
    } catch (saveError) {
      const feedback = getUserFeedback(saveError, 'log-save')
      setSaveState('error')
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
    },
    {
      key: 'maxFileSizeMb' as const,
      label: '单文件上限（MB）',
      value: maxFileSizeMb,
      setValue: setMaxFileSizeMb,
    },
    {
      key: 'maxTotalSizeMb' as const,
      label: '目录总上限（MB）',
      value: maxTotalSizeMb,
      setValue: setMaxTotalSizeMb,
    },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-apple-border-subtle bg-apple-card p-4 sm:flex sm:items-start sm:justify-between sm:gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-apple-heading">本地日志</h2>
            <SaveStateIndicator state={saving ? 'saving' : saveState} />
          </div>
          <p className="mt-1 text-sm text-apple-tertiary">
            日志仅保存在本机
            <span aria-hidden="true"> · </span>
            <span aria-live="polite">
              {logSizeState === 'loading' && '正在计算日志占用...'}
              {logSizeState === 'ready' && logSizeBytes !== null
                && `当前占用：${formatLogSize(logSizeBytes)}`}
              {logSizeState === 'error' && '当前占用暂时不可用'}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="motion-pressable mt-3 inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-apple-accent-light px-4 py-2 text-sm font-medium text-apple-accent hover:bg-apple-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25 sm:mt-0"
          onClick={() => void handleOpenDirectory()}
        >
          <IconFolderOpen aria-hidden="true" size={16} stroke={1.8} />
          打开日志目录
        </button>
      </div>

      <div
        className="grid gap-5 md:grid-cols-3"
        onBlur={(event) => {
          if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
          void handleSave()
        }}
      >
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
                disabled={saving}
                className="w-full rounded-lg border border-apple-border-input bg-apple-card px-3 py-2 text-sm text-apple-heading transition-colors focus:outline-none focus:border-apple-accent/40 focus:ring-2 focus:ring-apple-accent/15"
                value={field.value}
                onChange={(event) => {
                  field.setValue(event.target.value)
                  setEdited(true)
                  setSaveState('editing')
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void handleSave()
                }}
              />
              {fieldError && (
                <span id={errorId} role="alert" className="mt-1 block text-sm text-red-600">
                  {fieldError}
                </span>
              )}
            </label>
          )
        })}
      </div>

    </div>
  )
}
