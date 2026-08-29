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
  getLogStats: vi.fn(),
  selectFolder: vi.fn(),
  clearCache: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: mocks,
}))

import type {
  DownloadConfig,
  LogConfig,
  PublicConfigSnapshot,
} from '../../../shared/config-types'
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

async function keydown(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await flush()
  })
}

async function blur(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
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
  mocks.updateDownloadConfig.mockImplementation(async (input: DownloadConfig) => ({
    ...structuredClone(snapshot),
    download: input,
  }))
  mocks.updateLogConfig.mockImplementation(async (input: LogConfig) => ({
    ...structuredClone(snapshot),
    logging: input,
  }))
  mocks.updateCredentials.mockResolvedValue(structuredClone(snapshot))
  mocks.resetCorruptConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.autoGetCookie.mockResolvedValue({ status: 'ok', message: 'ok' })
  mocks.getCookieProgress.mockReturnValue(() => undefined)
  mocks.openFolder.mockResolvedValue(undefined)
  mocks.openLogFolder.mockResolvedValue(undefined)
  mocks.getLogStats.mockResolvedValue({ totalSizeBytes: 1.5 * 1024 * 1024 })
  mocks.selectFolder.mockResolvedValue(null)
  mocks.clearCache.mockResolvedValue({ deferred: false })
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
  it('supports semantic tabs and keyboard navigation', async () => {
    await renderPage()

    const loginTab = button('登录')
    const downloadTab = button('下载设置')
    expect(loginTab.getAttribute('role')).toBe('tab')
    expect(loginTab.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    for (const tab of [loginTab, downloadTab, button('日志')]) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId).toBeTruthy()
      expect(container.querySelector(`#${panelId}`)).not.toBeNull()
    }
    expect(container.querySelector('#config-panel-login')?.hasAttribute('hidden')).toBe(false)
    expect(container.querySelector('#config-panel-download')?.hasAttribute('hidden')).toBe(true)

    await keydown(loginTab, 'ArrowRight')

    expect(downloadTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(downloadTab)
    expect(container.querySelector('#config-panel-login')?.hasAttribute('hidden')).toBe(true)
    expect(container.querySelector('#config-panel-download')?.hasAttribute('hidden')).toBe(false)
  })

  it('shows saved credential status without prefilling or rendering secrets', async () => {
    await renderPage()

    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(container.textContent).toContain('密码（已保存）')
    expect(password.value).toBe('')
    expect(container.textContent).not.toContain('PHPSESSID')
    expect(container.textContent).not.toContain('jieqiUserInfo')
    expect(container.textContent).not.toContain('hidden-password')
  })

  it('does not write unchanged credentials when leaving the fields', async () => {
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await blur(username)

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.querySelector('#config-panel-login [role="status"]')).toBeNull()
  })

  it('validates a changed username without sending an empty password', async () => {
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await change(username, 'next-user')
    await blur(username)

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('用户名变更时必须提供密码')
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.getAttribute('aria-invalid')).toBe('true')
  })

  it('requires both a username and a password when no login information is stored', async () => {
    mocks.getConfig.mockResolvedValue(structuredClone(clearedSnapshot))
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await keydown(username, 'Enter')

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('请输入用户名')
    expect(container.textContent).toContain('请输入密码')
    const invalidInputs = container.querySelectorAll('input[aria-invalid="true"]')
    expect(invalidInputs).toHaveLength(2)
  })

  it('requires a password before automatically saving a changed username', async () => {
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await change(username, 'next-user')
    await blur(username)

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('用户名变更时必须提供密码')
  })

  it('automatically saves changed credentials when leaving the fields', async () => {
    await renderPage()
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await blur(password)

    expect(mocks.updateCredentials).toHaveBeenCalledWith({
      username: 'tester',
      password: 'new-password',
    })
    expect(mocks.autoGetCookie).toHaveBeenCalledTimes(1)
    expect(container.querySelector('#config-panel-login [role="status"]')).toBeNull()
  })

  it('does not report login refresh success when the latest config cannot be read', async () => {
    mocks.getConfig.mockReset()
    mocks.getConfig
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockRejectedValueOnce(new Error('配置服务不可用'))
    await renderPage()

    await click(button('刷新状态'))

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

    await click(button('清除登录信息'))

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
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await keydown(password, 'Enter')
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

    await click(button('清除登录信息'))
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

    await click(button('刷新状态'))
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

    const refreshButton = button('刷新状态')
    const clearButton = button('清除登录信息')
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
    const clearButton = button('清除登录信息')
    const refreshButton = button('刷新状态')
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await click(refreshButton)

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
    const refreshButton = button('刷新状态')
    const clearButton = button('清除登录信息')

    await act(async () => {
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
    })
    await act(async () => {
      rejectLogin?.(new Error('旧登录请求失败'))
      await flush()
    })

    expect(button('刷新状态').disabled).toBe(false)
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
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await keydown(password, 'Enter')
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

    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    await change(password, 'new-password')
    await keydown(password, 'Enter')
    await click(button('下载设置'))
    await click(button('登录'))
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).disabled)
      .toBe(true)
    await click(button('下载设置'))
    await act(async () => {
      resolveSave?.(structuredClone(snapshot))
      await flush()
    })

    expect(mocks.autoGetCookie).toHaveBeenCalledWith(expect.stringMatching(/^login-\d+-\d+$/))
    expect(container.querySelector('#config-panel-login [role="status"]')).toBeNull()
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

    await click(button('刷新状态'))
    const operationId = mocks.autoGetCookie.mock.calls[0][0] as string

    await act(async () => {
      onProgress?.({ operationId: 'stale-login', step: 'done', message: '旧请求已完成' })
      await flush()
    })
    expect(container.textContent).not.toContain('旧请求已完成')
    await act(async () => {
      onProgress?.({
        operationId,
        step: 'login',
        message: 'Cloudflare 可能连续显示多轮验证，请按页面提示逐步完成；全部完成后会自动登录',
      })
      await flush()
    })
    expect(container.textContent).toContain(
      'Cloudflare 可能连续显示多轮验证，请按页面提示逐步完成；全部完成后会自动登录',
    )

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
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await keydown(password, 'Enter')

    expect(mocks.autoGetCookie).toHaveBeenCalledTimes(1)
    expect(password.disabled).toBe(false)
    expect(button('刷新状态').disabled).toBe(false)
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
    const password = container.querySelector('input[type="password"]') as HTMLInputElement

    await change(password, 'new-password')
    await keydown(password, 'Enter')
    await act(async () => {
      root.render(<div>检索页</div>)
      await flush()
    })
    await act(async () => {
      root.render(<ConfigPage />)
      await flush()
    })

    expect(container.textContent).not.toContain('保存中')
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
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).disabled)
      .toBe(false)
    expect(container.textContent).not.toContain('保存中')
  })

  it('keeps saved credentials when clearing is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()

    await click(button('清除登录信息'))

    expect(mocks.updateCredentials).not.toHaveBeenCalled()
    expect(container.textContent).toContain('密码（已保存）')
  })

  it('automatically saves download setting changes', async () => {
    mocks.selectFolder.mockResolvedValue('D:\\Books')
    await renderPage()
    await click(button('下载设置'))
    await click(button('译名'))
    const coverIndex = container.querySelector(
      'input[aria-label="封面图片索引"]',
    ) as HTMLInputElement
    await change(coverIndex, '2')
    await blur(coverIndex)
    await click(button('选择文件夹'))

    expect(mocks.updateDownloadConfig).toHaveBeenCalledTimes(3)
    expect(mocks.updateDownloadConfig).toHaveBeenLastCalledWith({
      fullTitle: 'OUT',
      defaultCoverIndex: 2,
      downloadPath: 'D:\\Books',
    })
  })

  it('shows inline feedback after automatically saving download settings', async () => {
    await renderPage()
    await click(button('下载设置'))

    await click(button('译名'))

    const saveStatus = container.querySelector(
      '#config-panel-download [role="status"]',
    )
    expect(saveStatus).toBeNull()
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('shows an accessible field error for an invalid cover index', async () => {
    await renderPage()
    await click(button('下载设置'))
    const coverIndex = container.querySelector(
      'input[aria-label="封面图片索引"]',
    ) as HTMLInputElement
    await change(coverIndex, '-1')

    await blur(coverIndex)

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

  it('confirms cache clearing, disables the button in flight and reports success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveClear!: (value: { deferred: boolean }) => void
    mocks.clearCache.mockReturnValue(new Promise(resolve => {
      resolveClear = resolve
    }))
    await renderPage(true)
    await click(button('下载设置'))

    await click(button('清除缓存'))

    expect(button('正在清除…').disabled).toBe(true)
    expect(mocks.clearCache).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveClear({ deferred: false })
      await flush()
    })
    expect(useToastStore.getState().items.at(-1)).toMatchObject({
      tone: 'success',
      title: '缓存已清除',
    })
    expect(button('清除缓存').disabled).toBe(false)
  })

  it('reports deferred active-download cleanup without exposing cache settings', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.clearCache.mockResolvedValue({ deferred: true })
    await renderPage()
    await click(button('下载设置'))

    await click(button('清除缓存'))

    expect(useToastStore.getState().items.at(-1)?.message).toBe(
      '缓存已清除，正在下载的任务所使用的数据将在任务结束后自动处理',
    )
    expect(container.textContent).not.toContain('缓存上限')
    expect(container.textContent).not.toContain('缓存占用')
  })

  it('does not clear cache when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()
    await click(button('下载设置'))

    await click(button('清除缓存'))

    expect(mocks.clearCache).not.toHaveBeenCalled()
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

    await blur(maxTotalSize)

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
    await blur(maxTotalSize)
    expect(container.querySelector('#config-panel-logging [role="status"]')?.textContent)
      .toBe('未保存')
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

  it('shows the current total size of managed logs', async () => {
    await renderPage()
    expect(mocks.getLogStats).not.toHaveBeenCalled()

    await click(button('日志'))

    expect(mocks.getLogStats).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('日志仅保存在本机 · 当前占用：1.5 MB')
  })

  it('keeps logging settings usable when log size cannot be read', async () => {
    mocks.getLogStats.mockRejectedValueOnce(new Error('read failed'))
    await renderPage()

    await click(button('日志'))

    expect(container.textContent).toContain('当前占用暂时不可用')
    expect(button('打开日志目录').disabled).toBe(false)
  })

  it('renders load failures and retries explicitly', async () => {
    mocks.getConfig
      .mockRejectedValueOnce(new Error('配置服务不可用'))
      .mockResolvedValueOnce(structuredClone(snapshot))
    await renderPage()

    expect(container.textContent).toContain('配置加载失败：配置服务不可用')
    await click(button('重试'))

    expect(mocks.getConfig).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('账号登录')
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
