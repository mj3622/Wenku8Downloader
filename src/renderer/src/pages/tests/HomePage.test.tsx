// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  getAppInfo: vi.fn(async () => ({ version: '9.8.7' })),
  checkForUpdates: vi.fn(),
}))
vi.mock('../../api/client', () => ({ api: mocks }))

import HomePage from '../HomePage'
import { useToastStore } from '../../stores/toastStore'

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

beforeEach(async () => {
  vi.clearAllMocks()
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  ))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('HomePage', () => {
  it('presents the project with one primary route into discovery', () => {
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelectorAll('a[href="/discover"]')).toHaveLength(1)
    expect(container.textContent).toContain('面向 Wenku8 的桌面端开源工具')
    expect(container.textContent).toContain('v9.8.7')
  })

  it('checks for updates only after user action and shows the release state', async () => {
    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
    mocks.checkForUpdates.mockResolvedValueOnce({
      currentVersion: '9.8.7',
      latestVersion: '10.0.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/mj3622/Wenku8Downloader/releases/tag/v10.0.0',
      checkedAt: 1,
    })
    const button = [...container.querySelectorAll('button')]
      .find(element => element.textContent?.includes('检查更新'))

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(false)
    expect(container.textContent).toContain('新版本 v10.0.0 已发布')
    expect(container.textContent).toContain('查看发布页')
  })

  it('groups the project positioning, capabilities and principles', () => {
    expect(container.querySelector('#about-project-title')?.textContent).toBe('项目定位')
    expect(container.querySelector('#capabilities-title')?.textContent).toBe('核心能力')
    expect(container.querySelector('#principles-title')?.textContent).toBe('项目原则')
    expect(container.textContent).toContain('原站书架')
    expect(container.textContent).toContain('版本更新')
    expect(container.textContent).toContain('本地优先')
    expect(container.textContent).toContain('开源透明')
  })

  it('shows a safe toast when an external link cannot be opened', async () => {
    mocks.openExternal.mockRejectedValue(new Error('Error: IPC shell failure C:\\Users\\tester'))
    const link = [...container.querySelectorAll('a')]
      .find((element) => element.textContent?.includes('GitHub 仓库'))
    expect(link).toBeTruthy()

    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '无法打开链接',
    })
    expect(JSON.stringify(useToastStore.getState().items)).not.toContain('IPC')
  })
})
