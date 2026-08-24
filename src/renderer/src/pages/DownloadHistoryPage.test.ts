// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { OpenFolderTarget } from '../../../shared/ipc-types'
import { api } from '../api/client'

const mocks = vi.hoisted(() => ({
  openFolder: vi.fn(),
  useDownloadStore: vi.fn(),
}))

vi.mock('../stores/downloadStore', () => ({
  useDownloadStore: mocks.useDownloadStore,
}))

vi.mock('../api/client', () => ({
  api: { openFolder: mocks.openFolder },
}))

import DownloadHistoryPage from './DownloadHistoryPage'
import { useToastStore } from '../stores/toastStore'

let mountedRoot: Root | null = null
let container: HTMLDivElement | null = null
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

beforeEach(() => {
  useToastStore.getState().clear()
})

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount())
  }
  container?.remove()
  mountedRoot = null
  container = null
  vi.clearAllMocks()
})

describe('DownloadHistoryPage', () => {
  it('keeps the renderer API folder target aligned with the IPC whitelist', () => {
    expectTypeOf(api.openFolder).toEqualTypeOf<
      (target: OpenFolderTarget) => Promise<void>
    >()
  })

  it('shows a friendly toast after a completed task folder cannot be opened', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-1-1',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
    })
    mocks.openFolder.mockRejectedValueOnce(new Error('目录不存在'))
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[title="打开所在文件夹"]',
    )
    expect(openButton).not.toBeNull()

    await act(async () => {
      openButton?.click()
      await Promise.resolve()
    })

    expect(mocks.openFolder).toHaveBeenCalledWith('novels')
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '无法打开文件夹',
      message: '目录不存在',
    })
  })

  it('shows partial-success warnings on completed tasks', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-warning',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        warning: '封面未能下载，正文已正常保存。',
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })

    expect(container.textContent).toContain('封面未能下载，正文已正常保存。')
  })

  it('never renders technical details from a failed task', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-failed',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'failed',
        progress: 0,
        error: 'Error: IPC failed at C:\\Users\\tester',
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })

    expect(container.textContent).toContain('下载未能完成，请检查网络和下载设置后重试。')
    expect(container.textContent).not.toContain('IPC')
    expect(container.textContent).not.toContain('C:\\Users')
  })
})
