// @vitest-environment jsdom

import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateDownloadConfig: vi.fn(),
  updateLogConfig: vi.fn(),
  updateCredentials: vi.fn(),
  resetCorruptConfig: vi.fn(),
  autoGetCookie: vi.fn(),
  getCookieProgress: vi.fn((
    callback?: (data: { operationId: string; step: string; message: string }) => void,
  ) => {
    void callback
    return () => undefined
  }),
  openFolder: vi.fn(),
  openLogFolder: vi.fn(),
  selectFolder: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: mocks,
}))

import type { PublicConfigSnapshot } from '../../../shared/config-types'
import ConfigPage from './ConfigPage'
import { useConfigStore } from '../stores/configStore'
import { useLoginOperationStore } from '../stores/loginOperationStore'
import { toast, useToastStore } from '../stores/toastStore'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
const originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')

const snapshot: PublicConfigSnapshot = {
  download: {
    fullTitle: 'FULL',
    defaultCoverIndex: 0,
    downloadPath: '',
  },
  logging: {
    retentionDays: 30,
    maxFileSizeMb: 100,
    maxTotalSizeMb: 200,
  },
  account: {
    username: 'tester',
    hasPassword: true,
    hasCookies: true,
  },
  health: { state: 'ok' },
}

const recoverySnapshot: PublicConfigSnapshot = {
  ...snapshot,
  health: {
    state: 'recovery-required',
    message: '配置文件无法读取，原文件已保留',
  },
}

const clearedSnapshot: PublicConfigSnapshot = {
  ...snapshot,
  account: {
    username: '',
    hasPassword: false,
    hasCookies: false,
  },
}

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) {
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  } else {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
  if (originalElectronApi) {
    Object.defineProperty(window, 'electronAPI', originalElectronApi)
  } else {
    delete (window as Partial<Window>).electronAPI
  }
})

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function renderPage(strictMode = false): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(strictMode
      ? <StrictMode><ConfigPage /></StrictMode>
      : <ConfigPage />)
    await flush()
  })
}

function button(text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')]
    .find((element) => element.textContent?.includes(text))
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
  })
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.updateDownloadConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.updateLogConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.updateCredentials.mockResolvedValue(structuredClone(snapshot))
  mocks.resetCorruptConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.autoGetCookie.mockResolvedValue({ status: 'ok', message: 'ok' })
  mocks.getCookieProgress.mockReturnValue(() => undefined)
  mocks.openFolder.mockResolvedValue(undefined)
  mocks.openLogFolder.mockResolvedValue(undefined)
  mocks.selectFolder.mockResolvedValue(null)
  useConfigStore.setState({
    snapshot: null,
    loadState: 'idle',
    error: null,
  })
  useToastStore.getState().clear()
  useLoginOperationStore.getState().reset()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { platform: 'win32' },
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
  }
  container?.remove()
  vi.restoreAllMocks()
})

describe('ConfigPage', () => {
  it('shows saved credential status without prefilling or rendering secrets', async () => {
    await renderPage()

    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(container.textContent).toContain('已保存密码')
    expect(password.value).toBe('')
    expect(container.textContent).not.toContain('PHPSESSID')
    expect(container.textContent).not.toContain('jieqiUserInfo')
    expect(container.textContent).not.toContain('hidden-password')
  })

  it('omits the password when saving an unchanged account with an empty field', async () => {
    await renderPage()

    await click(button('保存账号'))

    expect(mocks.updateCredentials).toHaveBeenCalledTimes(1)
    expect(mocks.updateCredentials).toHaveBeenCalledWith({ username: 'tester' })
  })

  it('validates a changed username without sending an empty password', async () => {
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await change(username, 'next-user')
    await click(button('保存账号'))

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('用户名变更时必须提供密码')
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.getAttribute('aria-invalid')).toBe('true')
  })

  it('requires both a username and a password when no login information is stored', async () => {
    mocks.getConfig.mockResolvedValue(structuredClone(clearedSnapshot))
    await renderPage()

    await click(button('保存账号'))

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('请输入用户名')
    expect(container.textContent).toContain('请输入密码')
    const invalidInputs = container.querySelectorAll('input[aria-invalid="true"]')
    expect(invalidInputs).toHaveLength(2)
  })

  it('places an unsaved username warning beside the username field before refresh', async () => {
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await change(username, 'next-user')
    await click(button('刷新登录状态'))

    expect(mocks.autoGetCookie).not.toHaveBeenCalled()
    expect(username.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('用户名已修改，请先保存')
  })

  it('places an unsaved password warning beside the password field before refresh', async () => {
    await renderPage()
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await click(button('刷新登录状态'))

    expect(mocks.autoGetCookie).not.toHaveBeenCalled()
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('密码已修改，请先保存')
  })

  it('does not report login refresh success when the latest config cannot be read', async () => {
    mocks.getConfig.mockReset()
    mocks.getConfig
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockRejectedValueOnce(new Error('配置服务不可用'))
    await renderPage()

    await click(button('刷新登录状态'))

    expect(mocks.autoGetCookie).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('获取失败')
    expect(container.textContent).not.toContain('上次刷新')
    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'error', title: '登录失败' }),
    ]))
    expect(useToastStore.getState().items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '登录状态已更新' }),
    ]))
  })

  it('clears saved credentials after confirmation without attempting login', async () => {
    mocks.updateCredentials.mockResolvedValue(structuredClone(clearedSnapshot))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    await click(button('清除已保存登录信息'))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.updateCredentials).toHaveBeenCalledWith({ username: '', password: '' })
    expect(mocks.autoGetCookie).not.toHaveBeenCalled()
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'success',
      title: '登录信息已清除',
    })
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.placeholder).toBe('请输入密码')
  })

  it('shows the reconciled cookie state when saving credentials partially fails', async () => {
    let rejectSave: ((reason: Error) => void) | undefined
    mocks.getConfig
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockResolvedValue(structuredClone(clearedSnapshot))
    mocks.updateCredentials.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSave = reject
    }))
    await renderPage()

    await click(button('保存账号'))
    await act(async () => {
      useConfigStore.setState({ snapshot: structuredClone(clearedSnapshot) })
      await flush()
    })
    await act(async () => {
      rejectSave?.(new Error('账号设置已保存，但登录状态同步失败，请重新登录'))
      await flush()
    })

    expect(container.textContent).toContain('未获取')
    expect(container.textContent).not.toContain('已就绪')
    expect(useLoginOperationStore.getState()).toMatchObject({
      kind: 'idle',
      cookieState: 'idle',
      lastRefresh: null,
    })
  })

  it('shows the reconciled cookie state when clearing credentials partially fails', async () => {
    let rejectClear: ((reason: Error) => void) | undefined
    mocks.getConfig
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockResolvedValue(structuredClone(clearedSnapshot))
    mocks.updateCredentials.mockReturnValue(new Promise((_resolve, reject) => {
      rejectClear = reject
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    await click(button('清除已保存登录信息'))
    await act(async () => {
      rejectClear?.(new Error('账号设置已清除，但登录状态同步失败，请重新登录'))
      await flush()
    })

    expect(container.textContent).toContain('未获取')
    expect(container.textContent).not.toContain('已就绪')
    expect(useLoginOperationStore.getState()).toMatchObject({
      kind: 'idle',
      cookieState: 'idle',
      lastRefresh: null,
    })
  })

  it('treats a successful login response without cookies as an error', async () => {
    mocks.autoGetCookie.mockResolvedValue({ status: 'ok', message: 'ok' })
    let getConfigCalls = 0
    mocks.getConfig.mockImplementation(async () => {
      getConfigCalls += 1
      return structuredClone(getConfigCalls === 1 ? snapshot : clearedSnapshot)
    })
    await renderPage()
    expect(useConfigStore.getState().snapshot?.account.hasCookies).toBe(true)

    await click(button('刷新登录状态'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await flush()
    })

    expect(mocks.autoGetCookie).toHaveBeenCalledTimes(1)
    expect(mocks.getConfig).toHaveBeenCalledTimes(3)
    expect(useConfigStore.getState().snapshot?.account.hasCookies).toBe(false)
    expect(container.textContent).not.toContain('已就绪')
    expect(useLoginOperationStore.getState()).toMatchObject({
      kind: 'idle',
      cookieState: 'error',
    })
    expect(container.textContent).toContain('获取失败')
    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'error', title: '登录失败' }),
    ]))
    expect(useToastStore.getState().items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '登录状态已更新' }),
    ]))
    expect(useLoginOperationStore.getState()).toMatchObject({
      kind: 'idle',
      cookieState: 'error',
    })
  })

  it('ignores a stale login failure after credentials are cleared', async () => {
    let rejectLogin: ((reason: Error) => void) | undefined
    mocks.autoGetCookie.mockReturnValue(new Promise((_resolve, reject) => {
      rejectLogin = reject
    }))
    mocks.updateCredentials.mockResolvedValue(structuredClone(clearedSnapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    const refreshButton = button('刷新登录状态')
    const clearButton = button('清除已保存登录信息')
    await act(async () => {
      // Simulate two actions already queued before React commits the disabled state.
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })
    expect(mocks.updateCredentials).toHaveBeenCalledWith({ username: '', password: '' })
    await act(async () => {
      rejectLogin?.(new Error('旧登录请求失败'))
      await flush()
    })

    expect(container.textContent).toContain('未获取')
    expect(container.textContent).not.toContain('获取失败')
    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'success', title: '登录信息已清除' }),
    ]))
    expect(useToastStore.getState().items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '登录失败' }),
    ]))
  })

  it('disables all account actions while login refresh is pending', async () => {
    let resolveLogin: (() => void) | undefined
    mocks.autoGetCookie.mockReturnValue(new Promise((resolve) => {
      resolveLogin = () => resolve({ status: 'ok', message: 'ok' })
    }))
    await renderPage()
    const saveButton = button('保存账号')
    const clearButton = button('清除已保存登录信息')
    const refreshButton = button('刷新登录状态')
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await click(refreshButton)

    expect(saveButton.disabled).toBe(true)
    expect(clearButton.disabled).toBe(true)
    expect(refreshButton.disabled).toBe(true)
    expect(username.disabled).toBe(true)
    expect(password.disabled).toBe(true)
    await act(async () => {
      resolveLogin?.()
      await flush()
    })
  })

  it('leaves the loading state when a queued credential clear fails', async () => {
    let rejectLogin: ((reason: Error) => void) | undefined
    mocks.autoGetCookie.mockReturnValue(new Promise((_resolve, reject) => {
      rejectLogin = reject
    }))
    mocks.updateCredentials.mockRejectedValue(new Error('清除失败'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()
    const refreshButton = button('刷新登录状态')
    const clearButton = button('清除已保存登录信息')

    await act(async () => {
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })
    await act(async () => {
      rejectLogin?.(new Error('旧登录请求失败'))
      await flush()
    })

    expect(button('刷新登录状态').disabled).toBe(false)
    expect(container.textContent).not.toContain('正在登录')
    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'error', title: '账号保存失败' }),
    ]))
  })

  it('reports a pending account failure after switching tabs', async () => {
    let rejectSave: ((reason: Error) => void) | undefined
    mocks.updateCredentials.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSave = reject
    }))
    await renderPage()

    await click(button('保存账号'))
    await click(button('下载设置'))
    await act(async () => {
      rejectSave?.(new Error('账号服务不可用'))
      await flush()
    })

    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'error', title: '账号保存失败' }),
    ]))
  })

  it('finishes saved-account login after switching tabs', async () => {
    let resolveSave: ((value: PublicConfigSnapshot) => void) | undefined
    mocks.updateCredentials.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    await renderPage()

    const saveButton = button('保存账号')
    await click(saveButton)
    await click(button('下载设置'))
    await click(button('登录'))
    expect(saveButton.disabled).toBe(true)
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).disabled)
      .toBe(true)
    await click(button('下载设置'))
    await act(async () => {
      resolveSave?.(structuredClone(snapshot))
      await flush()
    })

    expect(mocks.autoGetCookie).toHaveBeenCalledWith(expect.stringMatching(/^login-\d+-\d+$/))
    expect(useToastStore.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: 'success', title: '账号已保存' }),
    ]))
  })

  it('shows progress only for the current login operation', async () => {
    type Progress = { operationId: string; step: string; message: string }
    let onProgress: ((progress: Progress) => void) | undefined
    const loginResolvers: Array<() => void> = []
    mocks.getCookieProgress.mockImplementation((callback) => {
      if (callback) onProgress = callback
      return () => undefined
    })
    mocks.autoGetCookie.mockImplementation(() => new Promise((resolve) => {
      loginResolvers.push(() => resolve({ status: 'ok', message: 'ok' }))
    }))
    await renderPage()

    const refreshButton = button('刷新登录状态')
    const saveButton = button('保存账号')
    await act(async () => {
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })
    const firstOperationId = mocks.autoGetCookie.mock.calls[0][0] as string
    const secondOperationId = mocks.autoGetCookie.mock.calls[1][0] as string

    await act(async () => {
      onProgress?.({ operationId: firstOperationId, step: 'done', message: '旧请求已完成' })
      await flush()
    })
    expect(container.textContent).not.toContain('旧请求已完成')
    await act(async () => {
      onProgress?.({ operationId: secondOperationId, step: 'login', message: '新请求正在登录' })
      await flush()
    })
    expect(container.textContent).toContain('新请求正在登录')

    await act(async () => {
      for (const resolveLogin of loginResolvers) resolveLogin()
      await flush()
    })
  })

  it('restores mounted state during the StrictMode effect replay', async () => {
    await renderPage(true)
    await act(async () => {
      await flush()
      await flush()
    })

    await click(button('保存账号'))

    expect(mocks.autoGetCookie).toHaveBeenCalledTimes(1)
    expect(button('保存账号').disabled).toBe(false)
    expect(button('刷新登录状态').disabled).toBe(false)
  })

  it('preserves account busy state and progress after leaving and returning to the page', async () => {
    type Progress = { operationId: string; step: string; message: string }
    let onProgress: ((progress: Progress) => void) | undefined
    let resolveSave: ((value: PublicConfigSnapshot) => void) | undefined
    let resolveLogin: (() => void) | undefined
    mocks.getCookieProgress.mockImplementation((callback) => {
      if (callback) onProgress = callback
      return () => undefined
    })
    mocks.updateCredentials.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    mocks.autoGetCookie.mockReturnValue(new Promise((resolve) => {
      resolveLogin = () => resolve({ status: 'ok', message: 'ok' })
    }))
    await renderPage()

    await click(button('保存账号'))
    await act(async () => {
      root.render(<div>检索页</div>)
      await flush()
    })
    await act(async () => {
      root.render(<ConfigPage />)
      await flush()
    })

    const remountedSave = [...container.querySelectorAll('button')].find((element) => (
      element.textContent?.includes('保存账号') || element.textContent?.includes('保存中')
    )) as HTMLButtonElement | undefined
    expect(remountedSave?.disabled).toBe(true)
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).disabled)
      .toBe(true)

    await act(async () => {
      resolveSave?.(structuredClone(snapshot))
      await flush()
    })
    const operationId = mocks.autoGetCookie.mock.calls[0][0] as string
    await act(async () => {
      onProgress?.({ operationId, step: 'login', message: '跨页面登录进度' })
      await flush()
    })
    expect(container.textContent).toContain('跨页面登录进度')

    await act(async () => {
      resolveLogin?.()
      await flush()
    })
    expect(remountedSave?.disabled).toBe(false)
  })

  it('keeps saved credentials when clearing is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()

    await click(button('清除已保存登录信息'))

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('已保存密码')
  })

  it('submits all download settings in one request', async () => {
    mocks.selectFolder.mockResolvedValue('D:\\Books')
    await renderPage()
    await click(button('下载设置'))
    await click(button('译名'))
    const coverIndex = container.querySelector(
      'input[aria-label="封面图片索引"]',
    ) as HTMLInputElement
    await change(coverIndex, '2')
    await click(button('选择文件夹'))

    await click(button('保存下载设置'))

    expect(mocks.updateDownloadConfig).toHaveBeenCalledTimes(1)
    expect(mocks.updateDownloadConfig).toHaveBeenCalledWith({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: 'D:\\Books',
    })
  })

  it('uses only Toast for transient download-save feedback', async () => {
    await renderPage()
    await click(button('下载设置'))

    await click(button('保存下载设置'))

    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'success',
      title: '下载设置已保存',
    })
    const duplicateLiveMessage = [...container.querySelectorAll('[role="status"]')]
      .some((element) => element.textContent?.includes('下载设置已保存'))
    expect(duplicateLiveMessage).toBe(false)
  })

  it('shows an accessible field error for an invalid cover index', async () => {
    await renderPage()
    await click(button('下载设置'))
    const coverIndex = container.querySelector(
      'input[aria-label="封面图片索引"]',
    ) as HTMLInputElement
    await change(coverIndex, '-1')

    await click(button('保存下载设置'))

    expect(mocks.updateDownloadConfig).not.toHaveBeenCalled()
    expect(coverIndex.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('封面图片索引必须为非负整数')
  })

  it('opens the effective download root from download settings', async () => {
    await renderPage()
    await click(button('下载设置'))

    expect(container.textContent).toContain('默认下载目录')
    await click(button('打开目录'))

    expect(mocks.openFolder).toHaveBeenCalledWith('root')
  })

  it('saves validated logging settings', async () => {
    await renderPage()
    await click(button('日志'))
    const retentionDays = container.querySelector(
      'input[aria-label="保留天数"]',
    ) as HTMLInputElement
    const maxFileSize = container.querySelector(
      'input[aria-label="单文件上限（MB）"]',
    ) as HTMLInputElement
    const maxTotalSize = container.querySelector(
      'input[aria-label="目录总上限（MB）"]',
    ) as HTMLInputElement
    await change(retentionDays, '14')
    await change(maxFileSize, '64')
    await change(maxTotalSize, '256')

    await click(button('保存日志设置'))

    expect(mocks.updateLogConfig).toHaveBeenCalledWith({
      retentionDays: 14,
      maxFileSizeMb: 64,
      maxTotalSizeMb: 256,
    })
  })

  it('rejects a total limit below twice the file limit', async () => {
    await renderPage()
    await click(button('日志'))
    const maxTotalSize = container.querySelector(
      'input[aria-label="目录总上限（MB）"]',
    ) as HTMLInputElement
    await change(maxTotalSize, '150')

    expect(container.textContent).toContain('目录总上限必须至少为单文件上限的两倍')
    expect(maxTotalSize.getAttribute('aria-invalid')).toBe('true')
    expect(button('保存日志设置').disabled).toBe(true)
    expect(mocks.updateLogConfig).not.toHaveBeenCalled()
  })

  it('associates each invalid logging value with its own field', async () => {
    await renderPage()
    await click(button('日志'))
    const retentionDays = container.querySelector(
      'input[aria-label="保留天数"]',
    ) as HTMLInputElement
    await change(retentionDays, '0')

    expect(retentionDays.getAttribute('aria-invalid')).toBe('true')
    expect(retentionDays.getAttribute('aria-describedby')).toBeTruthy()
    expect(container.textContent).toContain('保留天数必须为 1 到 365 的整数')
  })

  it('opens the log directory through the fixed API', async () => {
    await renderPage()
    await click(button('日志'))
    await click(button('打开日志目录'))

    expect(mocks.openLogFolder).toHaveBeenCalledWith()
  })

  it('renders load failures and retries explicitly', async () => {
    mocks.getConfig
      .mockRejectedValueOnce(new Error('配置服务不可用'))
      .mockResolvedValueOnce(structuredClone(snapshot))
    await renderPage()

    expect(container.textContent).toContain('配置加载失败：配置服务不可用')
    await click(button('重试'))

    expect(mocks.getConfig).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('保存账号')
  })

  it('requires confirmation before resetting a corrupt configuration', async () => {
    mocks.getConfig.mockResolvedValue(structuredClone(recoverySnapshot))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    await click(button('处理配置问题'))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.resetCorruptConfig).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('配置问题已处理')
  })

  it('shows a recovery Toast only when a persistent health problem first appears', async () => {
    mocks.getConfig.mockResolvedValue(structuredClone(recoverySnapshot))
    const warning = vi.spyOn(toast, 'warning')
    await renderPage()

    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({
      title: '配置需要处理',
    }))

    await act(async () => {
      useConfigStore.setState({ snapshot: structuredClone(recoverySnapshot) })
      await flush()
    })
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it('does not reset when recovery confirmation is cancelled', async () => {
    mocks.getConfig.mockResolvedValue(structuredClone(recoverySnapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()

    await click(button('处理配置问题'))

    expect(mocks.resetCorruptConfig).not.toHaveBeenCalled()
  })

  it('allows only one reset while recovery is pending', async () => {
    let release!: (value: PublicConfigSnapshot) => void
    mocks.resetCorruptConfig.mockReturnValue(new Promise<PublicConfigSnapshot>((resolve) => {
      release = resolve
    }))
    mocks.getConfig.mockResolvedValue(structuredClone(recoverySnapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    const resetButton = button('处理配置问题')
    await act(async () => {
      resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })

    const pendingButton = button('处理中...')
    expect(pendingButton.disabled).toBe(true)
    expect(mocks.resetCorruptConfig).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      release(structuredClone(snapshot))
      await flush()
    })
  })
})
