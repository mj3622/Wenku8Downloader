// @vitest-environment jsdom

import { act } from 'react'
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
  updateCredentials: vi.fn(),
  resetCorruptConfig: vi.fn(),
  autoGetCookie: vi.fn(),
  getCookieProgress: vi.fn(() => () => undefined),
  selectFolder: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: mocks,
}))

import type { PublicConfigSnapshot } from '../../../shared/config-types'
import ConfigPage from './ConfigPage'
import { useConfigStore } from '../stores/configStore'

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

async function renderPage(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<ConfigPage />)
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
  mocks.updateCredentials.mockResolvedValue(structuredClone(snapshot))
  mocks.resetCorruptConfig.mockResolvedValue(structuredClone(snapshot))
  mocks.autoGetCookie.mockResolvedValue({ status: 'ok', message: 'ok' })
  mocks.getCookieProgress.mockReturnValue(() => undefined)
  mocks.selectFolder.mockResolvedValue(null)
  useConfigStore.setState({
    snapshot: null,
    loadState: 'idle',
    error: null,
  })
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

  it('shows the service error when a changed username has no password', async () => {
    mocks.updateCredentials.mockRejectedValue(new Error('用户名变更时必须提供密码'))
    await renderPage()
    const username = container.querySelector(
      'input[placeholder="轻小说文库用户名"]',
    ) as HTMLInputElement

    await change(username, 'next-user')
    await click(button('保存账号'))

    expect(mocks.updateCredentials).toHaveBeenCalledWith({ username: 'next-user' })
    expect(container.textContent).toContain('用户名变更时必须提供密码')
  })

  it('clears saved credentials after confirmation without attempting login', async () => {
    mocks.updateCredentials.mockResolvedValue(structuredClone(clearedSnapshot))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()

    await click(button('清除已保存凭证'))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.updateCredentials).toHaveBeenCalledWith({ username: '', password: '' })
    expect(mocks.autoGetCookie).not.toHaveBeenCalled()
    expect(container.textContent).toContain('账号、密码和 Cookie 已清除')
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.placeholder).toBe('请输入密码')
  })

  it('keeps saved credentials when clearing is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()

    await click(button('清除已保存凭证'))

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
